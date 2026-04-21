'use strict';

const ANOMALY_API_BASE = process.env.ANOMALY_API_URL || 'http://localhost:8000';
const NIGHT_HOURS_INT  = new Set([23, 0, 1, 2, 3, 4, 5, 6]); // hour(int) 기준
const FETCH_TIMEOUT_MS = 60 * 1000; // 60초 타임아웃

let cachedNodeIds = [];

// ─── 타임아웃 fetch 래퍼 ─────────────────────────────────────────────────────

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// ─── 교차로 목록 ────────────────────────────────────────────────────────────

// GET /intersections → 교차로 ID 목록 캐시
// 응답: { count: N, items: [{ node_id, name }, ...] }
async function fetchNodeIds() {
  const res = await fetchWithTimeout(`${ANOMALY_API_BASE}/intersections`);
  if (!res.ok) throw new Error(`fetchNodeIds HTTP ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data) ? data : (data.items ?? []);
  cachedNodeIds = items.map(d => d.node_id);
  return cachedNodeIds;
}

function getCachedNodeIds() { return cachedNodeIds; }

// ─── API 호출 ────────────────────────────────────────────────────────────────

// POST /corrected-traffic → slots 배열 반환 (소범위 동기용)
async function fetchSlots(dateStart, dateEnd) {
  const nodeIds = cachedNodeIds.length ? cachedNodeIds : await fetchNodeIds();
  const res = await fetchWithTimeout(`${ANOMALY_API_BASE}/corrected-traffic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node_ids: nodeIds, date_start: dateStart, date_end: dateEnd }),
  });
  if (!res.ok) throw new Error(`fetchSlots HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body?.slots)) {
    console.error('[anomaly-api] /corrected-traffic 응답 최상위 키:', Object.keys(body ?? {}));
  }
  return body.slots ?? [];
}

// POST /jobs + GET /jobs/{job_id} 폴링 → slots 배열 반환 (대용량 비동기용)
const JOB_POLL_MS    = 3000;           // 3초 간격 폴링
const JOB_TIMEOUT_MS = 10 * 60 * 1000; // 최대 10분 대기

// 동일 날짜 범위에 대한 중복 job 생성 방지 (in-flight 공유)
const jobInFlight = new Map(); // `${dateStart}|${dateEnd}` → Promise<slots>

async function fetchSlotsViaJob(dateStart, dateEnd) {
  const key = `${dateStart}|${dateEnd}`;
  if (jobInFlight.has(key)) return jobInFlight.get(key);

  const promise = _fetchSlotsViaJob(dateStart, dateEnd);
  jobInFlight.set(key, promise);
  promise.finally(() => jobInFlight.delete(key));
  return promise;
}

async function _fetchSlotsViaJob(dateStart, dateEnd) {
  const nodeIds = cachedNodeIds.length ? cachedNodeIds : await fetchNodeIds();

  // 1) 잡 생성
  const createRes = await fetchWithTimeout(`${ANOMALY_API_BASE}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node_ids: nodeIds, date_start: dateStart, date_end: dateEnd }),
  });
  if (!createRes.ok) throw new Error(`jobs create HTTP ${createRes.status}`);
  const created = await createRes.json();
  const jobId = created.job_id ?? created.id ?? created.jobId;
  if (!jobId) {
    console.error('[anomaly-api] /jobs 응답 구조:', JSON.stringify(created).slice(0, 200));
    throw new Error('/jobs 응답에 job_id 없음');
  }
  console.log(`[anomaly-api] job 생성: ${jobId} (${dateStart} ~ ${dateEnd})`);

  // 2) 완료까지 폴링
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, JOB_POLL_MS));
    const pollRes = await fetchWithTimeout(`${ANOMALY_API_BASE}/jobs/${jobId}`);
    if (!pollRes.ok) throw new Error(`jobs poll HTTP ${pollRes.status}`);
    const job = await pollRes.json();

    if (job.status === 'done') {
      const slots = job.result?.slots ?? job.slots ?? [];
      console.log(`[anomaly-api] job 완료: ${jobId} → ${slots.length}건`);
      return slots;
    }
    if (job.status === 'failed') throw new Error(`job ${jobId} failed: ${job.error}`);
    if (job.progress != null) console.log(`[anomaly-api] job ${jobId} 진행: ${job.progress}`);
    // pending / running → 계속 폴링
  }
  throw new Error(`job ${jobId} 10분 초과`);
}

// ─── 역방향 맵 ───────────────────────────────────────────────────────────────

// approach_id(int) → node_id(string) 역방향 맵 빌드
// approaches: [{ nodeId, acsrId, ... }]  (home.js의 getApproachMasterData() 결과)
function buildAcsrNodeMap(approaches) {
  const map = new Map();
  for (const { nodeId, acsrId } of approaches) map.set(acsrId, nodeId);
  return map;
}

// ─── 집계 빌더 ───────────────────────────────────────────────────────────────

// slots 배열 → home.js가 필요로 하는 3가지 집계 맵 (야간 시간대 제외)
// 반환:
//   nodeAgg     : Map<slotKey, Map<nodeId, activeHours>>
//   dirAgg      : Map<slotKey, Map<nodeId, Map<acsrId, activeHours>>>
//   hourlyNodeCount : Map<slotKey, Map<'HH', activeNodeCount>>
function buildAggregates(slots, acsrNodeMap) {
  // 중간 맵: Map<slotKey, Map<'HH', Map<nodeId, Set<acsrId>>>>
  const bySlotHourNode = new Map();

  for (const item of slots) {
    const h = item.hour; // int
    if (NIGHT_HOURS_INT.has(h)) continue;
    const slotKey = item.date;                   // 'YYYY-MM-DD'
    const hour    = String(h).padStart(2, '0');  // 'HH'
    const acsrId  = item.approach_id;
    const nodeId  = acsrNodeMap.get(acsrId);
    if (!nodeId) continue; // 마스터에 없는 접근로 무시

    if (!bySlotHourNode.has(slotKey)) bySlotHourNode.set(slotKey, new Map());
    const hourMap = bySlotHourNode.get(slotKey);
    if (!hourMap.has(hour)) hourMap.set(hour, new Map());
    const nodeMap = hourMap.get(hour);
    if (!nodeMap.has(nodeId)) nodeMap.set(nodeId, new Set());
    nodeMap.get(nodeId).add(acsrId);
  }

  const nodeAgg  = new Map();
  const dirAgg   = new Map();
  const hourlyNC = new Map();

  for (const [slotKey, hourMap] of bySlotHourNode) {
    if (!nodeAgg.has(slotKey))  nodeAgg.set(slotKey, new Map());
    if (!dirAgg.has(slotKey))   dirAgg.set(slotKey, new Map());
    if (!hourlyNC.has(slotKey)) hourlyNC.set(slotKey, new Map());

    const slotNodes = nodeAgg.get(slotKey);
    const slotDirs  = dirAgg.get(slotKey);
    const slotNC    = hourlyNC.get(slotKey);

    for (const [hour, nodeMap] of hourMap) {
      slotNC.set(hour, nodeMap.size); // 해당 시간대 활성 교차로 수
      for (const [nodeId, acsrSet] of nodeMap) {
        slotNodes.set(nodeId, (slotNodes.get(nodeId) ?? 0) + 1);
        if (!slotDirs.has(nodeId)) slotDirs.set(nodeId, new Map());
        const dMap = slotDirs.get(nodeId);
        for (const acsrId of acsrSet) {
          dMap.set(acsrId, (dMap.get(acsrId) ?? 0) + 1);
        }
      }
    }
  }
  return { nodeAgg, dirAgg, hourlyNodeCount: hourlyNC };
}

// slots 배열 → home.js todayHourly 포맷
// 반환: Map<slotKey, Map<'HH', Map<nodeId, Set<acsrId>>>>
function buildTodaySlot(slots, acsrNodeMap) {
  const existingBySlot = new Map();
  for (const item of slots) {
    const slotKey = item.date;
    const hour    = String(item.hour).padStart(2, '0');
    const acsrId  = item.approach_id;
    const nodeId  = acsrNodeMap.get(acsrId);
    if (!nodeId) continue;

    if (!existingBySlot.has(slotKey)) existingBySlot.set(slotKey, new Map());
    const hourMap = existingBySlot.get(slotKey);
    if (!hourMap.has(hour)) hourMap.set(hour, new Map());
    const nodeMap = hourMap.get(hour);
    if (!nodeMap.has(nodeId)) nodeMap.set(nodeId, new Set());
    nodeMap.get(nodeId).add(acsrId);
  }
  return existingBySlot;
}

// ─── hourly-poller 전용 ──────────────────────────────────────────────────────

// 전체 노드에서 데이터가 전무한 시간대 → Set<'HH:00'>
// "어느 노드도 해당 시간에 데이터 없음" = 시스템 전체 결측
async function getMissingHourlySlots(dateStr, acsrNodeMap) {
  const nodeIds = cachedNodeIds.length ? cachedNodeIds : await fetchNodeIds();
  if (nodeIds.length === 0) return new Set();

  const slots    = await fetchSlotsViaJob(dateStr, dateStr);
  const presence = new Map(); // Map<'HH', Set<nodeId>>
  for (const item of slots) {
    const hour   = String(item.hour).padStart(2, '0');
    const nodeId = acsrNodeMap.get(item.approach_id);
    if (!nodeId) continue;
    if (!presence.has(hour)) presence.set(hour, new Set());
    presence.get(hour).add(nodeId);
  }

  const nowHour = new Date().getHours();
  const missing = new Set();
  for (let h = 0; h <= nowHour; h++) {
    const hStr = String(h).padStart(2, '0');
    if ((presence.get(hStr)?.size ?? 0) === 0) missing.add(`${hStr}:00`);
  }
  return missing;
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  fetchNodeIds,
  getCachedNodeIds,
  fetchSlots,
  fetchSlotsViaJob,
  buildAcsrNodeMap,
  buildAggregates,
  buildTodaySlot,
  getMissingHourlySlots,
};
