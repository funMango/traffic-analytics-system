'use strict';

const { execute } = require('../db');

// ── 상수 ────────────────────────────────────────────────────────────────────
const NIGHT_HOURS_INT = new Set([23, 0, 1, 2, 3, 4, 5, 6]);

function padZ(n) { return String(n).padStart(2, '0'); }

// ── 직접 DB 쿼리 ─────────────────────────────────────────────────────────
// S_CRSRD_ACSR_TRF_1HH에서 해당 기간의 (nodeId, acsrId, date, hour) 집합 조회
// TRF_QNTY IS NULL인 레코드는 제외(결측으로 처리), 야간 시간대(23~06) 제외
// 반환: [{nodeId, acsrId, date:'YYYY-MM-DD', hour:int}]
async function fetchHistoricalSlots(dateStart, dateEnd) {
  const startDt = new Date(dateStart + 'T00:00:00');
  const endDt   = new Date(dateEnd   + 'T00:00:00');
  endDt.setDate(endDt.getDate() + 1); // 다음날 자정 (exclusive upper bound)

  const result = await execute(
    `SELECT NODE_ID, ACSR_ID,
            TO_CHAR(TRUNC(TOT_DT), 'YYYY-MM-DD')  AS DT,
            TO_NUMBER(TO_CHAR(TOT_DT, 'HH24'))    AS HH
       FROM S_CRSRD_ACSR_TRF_1HH
      WHERE TOT_DT >= :startDt
        AND TOT_DT <  :endDt
        AND TRF_QNTY IS NOT NULL
        AND TO_NUMBER(TO_CHAR(TOT_DT, 'HH24')) NOT IN (23,0,1,2,3,4,5,6)
      GROUP BY NODE_ID, ACSR_ID, TRUNC(TOT_DT), TO_CHAR(TOT_DT, 'HH24')
      ORDER BY TRUNC(TOT_DT), TO_CHAR(TOT_DT, 'HH24')`,
    { startDt, endDt }
  );

  return result.rows.map(r => ({
    nodeId: r.NODE_ID,
    acsrId: r.ACSR_ID,
    date:   r.DT,
    hour:   r.HH,
  }));
}

// ── buildAggregates ───────────────────────────────────────────────────────
// nodeAgg/dirAgg 값 타입: Set<'HH'> (어느 시간에 유효 데이터가 있었는지)
//
// slots: [{nodeId, acsrId, date:'YYYY-MM-DD', hour:int}]
// 반환:
//   nodeAgg        : Map<slotKey, Map<nodeId, Set<'HH'>>>
//   dirAgg         : Map<slotKey, Map<nodeId, Map<acsrId, Set<'HH'>>>>
//   hourlyNodeCount: Map<slotKey, Map<'HH', activeNodeCount>>
async function buildAggregates(slots) {
  const nodeAgg  = new Map();
  const dirAgg   = new Map();
  const hourlyNC = new Map(); // 중간: slotKey → Map<'HH', Set<nodeId>>
  const YIELD_EVERY = 50_000;

  for (let i = 0; i < slots.length; i++) {
    if (i > 0 && i % YIELD_EVERY === 0) await new Promise(r => setImmediate(r));
    const { nodeId, acsrId, date: slotKey, hour } = slots[i];
    const hh = padZ(hour);

    // nodeAgg: slotKey → nodeId → Set<'HH'>
    if (!nodeAgg.has(slotKey)) nodeAgg.set(slotKey, new Map());
    const slotNodes = nodeAgg.get(slotKey);
    if (!slotNodes.has(nodeId)) slotNodes.set(nodeId, new Set());
    slotNodes.get(nodeId).add(hh);

    // dirAgg: slotKey → nodeId → acsrId → Set<'HH'>
    if (!dirAgg.has(slotKey)) dirAgg.set(slotKey, new Map());
    const slotDirs = dirAgg.get(slotKey);
    if (!slotDirs.has(nodeId)) slotDirs.set(nodeId, new Map());
    const nodeMap = slotDirs.get(nodeId);
    if (!nodeMap.has(acsrId)) nodeMap.set(acsrId, new Set());
    nodeMap.get(acsrId).add(hh);

    // hourlyNC (중간: Set<nodeId> → 최종 count로 변환)
    if (!hourlyNC.has(slotKey)) hourlyNC.set(slotKey, new Map());
    const hourMap = hourlyNC.get(slotKey);
    if (!hourMap.has(hh)) hourMap.set(hh, new Set());
    hourMap.get(hh).add(nodeId);
  }

  // Set<nodeId> → size 변환
  const hourlyNodeCount = new Map();
  for (const [slotKey, hourMap] of hourlyNC) {
    const nc = new Map();
    for (const [hh, nodeSet] of hourMap) nc.set(hh, nodeSet.size);
    hourlyNodeCount.set(slotKey, nc);
  }

  return { nodeAgg, dirAgg, hourlyNodeCount };
}

// ── buildTodaySlot ────────────────────────────────────────────────────────
// anomaly-api.js의 buildTodaySlot을 이식 (acsrNodeMap 파라미터 제거)
// slots → Map<slotKey, Map<'HH', Map<nodeId, Set<acsrId>>>>
function buildTodaySlot(slots) {
  const existingBySlot = new Map();
  for (const { nodeId, acsrId, date: slotKey, hour } of slots) {
    const hh = padZ(hour);
    if (!existingBySlot.has(slotKey)) existingBySlot.set(slotKey, new Map());
    const hourMap = existingBySlot.get(slotKey);
    if (!hourMap.has(hh)) hourMap.set(hh, new Map());
    const nodeMap = hourMap.get(hh);
    if (!nodeMap.has(nodeId)) nodeMap.set(nodeId, new Set());
    nodeMap.get(nodeId).add(acsrId);
  }
  return existingBySlot;
}

module.exports = {
  fetchHistoricalSlots,
  buildAggregates,
  buildTodaySlot,
};
