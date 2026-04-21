'use strict';

// ── 유효 시간 판단 임계값 ────────────────────────────────────────────────────
const VALID_HOUR_NODE_RATIO = 0.15; // 전체 교차로의 15% 이상 데이터가 있어야 유효 시간
const NIGHT_HOURS = new Set(['23', '00', '01', '02', '03', '04', '05', '06']); // 이상 집계 제외 시간대 (23:00~07:00)

const { Router } = require('express');
const fs   = require('fs');
const path = require('path');
const { execute } = require('../db');
const { getTargetUpdateTime: getHourlyTarget } = require('../services/hourly-poller');
const {
  fetchHistoricalSlots,
  buildAggregates,
  buildTodaySlot,
} = require('../services/db-traffic');

const router = Router();

// ── 유틸 ────────────────────────────────────────────────────────────────────
function padZ(n) { return String(n).padStart(2, '0'); }

function dateToStr(date) {
  return `${date.getFullYear()}-${padZ(date.getMonth() + 1)}-${padZ(date.getDate())}`;
}

// ── 마스터 데이터 (교차로 목록) ───────────────────────────────────────────
let masterCache = null;
let masterFetchedAt = 0;
const MASTER_TTL_MS = 10 * 60 * 1000;

async function getMasterData() {
  const now = Date.now();
  if (masterCache && now - masterFetchedAt < MASTER_TTL_MS) return masterCache;

  const result = await execute(
    `SELECT NODE_ID, CRSRD_NM FROM M_CRSRD_INF ORDER BY CRSRD_NM`,
    {}
  );
  masterCache = {
    intersections: result.rows.map(r => ({ nodeId: r.NODE_ID, nodeName: r.CRSRD_NM })),
  };
  masterFetchedAt = now;
  return masterCache;
}

// ── 마스터 데이터 (접근로 목록) ───────────────────────────────────────────
let approachMasterCache = null;
let approachMasterFetchedAt = 0;

async function getApproachMasterData() {
  const now = Date.now();
  if (approachMasterCache && now - approachMasterFetchedAt < MASTER_TTL_MS) return approachMasterCache;

  const result = await execute(
    `SELECT a.NODE_ID, a.ACSR_ID, a.ACSR_NM, i.CRSRD_NM
       FROM M_CRSRD_ACSR_INF a
       JOIN M_CRSRD_INF i ON i.NODE_ID = a.NODE_ID
      ORDER BY a.NODE_ID, a.ACSR_ID`,
    {}
  );

  // ─── 존재하지 않는 접근로 제외 ─────────────────────────────────────────
  const EXCLUDED_ACSR_NMS = new Set([
    '남부천신협앞-동(서향)',
    '남부천신협앞-서(동향)',
    '역곡남부역3R-북 (남향)',
    '부천여중4R-북(남향)',
  ]);

  const approaches = result.rows
    .map(r => ({ nodeId: r.NODE_ID, acsrId: r.ACSR_ID, acsrName: r.ACSR_NM, nodeName: r.CRSRD_NM }))
    .filter(ap => !EXCLUDED_ACSR_NMS.has(ap.acsrName));

  // nodeId → { nodeName, acsrIds: Set<acsrId> }
  const nodeAcsrMap = new Map();
  for (const { nodeId, acsrId, nodeName } of approaches) {
    if (!nodeAcsrMap.has(nodeId)) nodeAcsrMap.set(nodeId, { nodeName, acsrIds: new Set() });
    nodeAcsrMap.get(nodeId).acsrIds.add(acsrId);
  }

  approachMasterCache = { approaches, nodeAcsrMap };
  approachMasterFetchedAt = now;
  return approachMasterCache;
}

// ── 비율 기반 심각도 분류 헬퍼 ───────────────────────────────────────────

// missingCount / totalSlots 비율로 심각도 분류
// danger(위험) ≥70%, caution(경고) ≥50%, warn(주의) ≥30%, null(<30%)
function getSeverity(missingCount, totalSlots) {
  if (totalSlots === 0) return null;
  const r = missingCount / totalSlots;
  if (r >= 0.7) return 'danger';
  if (r >= 0.5) return 'caution';
  if (r >= 0.3) return 'warn';
  return null;
}

const SEVERITY_ORDER = { danger: 0, caution: 1, warn: 2 };

// in-place 정렬: 위험→경고→주의, missingCount 내림, 이름 오름
function sortBySeverity(items, nameKey) {
  items.sort((a, b) => {
    const sd = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sd !== 0) return sd;
    const cd = b.missingCount - a.missingCount;
    if (cd !== 0) return cd;
    return (a[nameKey] || '').localeCompare(b[nameKey] || '', 'ko');
  });
}

// ── 파일 캐시 (slots: DB 조회 결과 영속화) ───────────────────────────────
const CACHE_DIR = path.join(__dirname, '..', 'cache');

function loadSlotsCache(year) {
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `slots-${year}.json`), 'utf8'));
  } catch { return null; }
}

function saveSlotsCache(year, data) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, `slots-${year}.json`), JSON.stringify(data));
  } catch (err) { console.error('[home] 슬롯 캐시 저장 실패:', err.message); }
}

// ── 기간 설정 ──────────────────────────────────────────────────────────────
const TABLE_1HH   = 'S_CRSRD_ACSR_TRF_1HH';
const INTERVAL_MS = 24 * 60 * 60 * 1000;

// ── 과거 집계 캐시 (TTL 24시간) ──────────────────────────────────────────
// year → { nodeAgg: Map<slotKey, Map<nodeId, Set<'HH'>>>,
//           dirAgg:  Map<slotKey, Map<nodeId, Map<acsrId, Set<'HH'>>>>,
//           hourlyNodeCount: Map<slotKey, Map<'HH', activeNodeCount>>,
//           cachedAt }
const histAggCache    = new Map();
const histAggFetching = new Map();
const HIST_TTL_MS = 24 * 60 * 60 * 1000;

// ── 오늘 시간별 캐시 (TTL 5분) ────────────────────────────────────────────
// year → { existingBySlot: Map<slotKey, Map<'HH', Map<nodeId, Set<acsrId>>>>, cachedAt }
const todayHourlyCache    = new Map();
const todayHourlyFetching = new Map();
const TODAY_SLOT_TTL_MS = 5 * 60 * 1000;

// ── 연간 summary 캐시 (TTL 5분 - JS 연산 결과 캐싱) ─────────────────────
const summaryCache    = new Map();
const summaryFetching = new Map();
const SUMMARY_TTL_MS  = 5 * 60 * 1000;

// ── today-abnormal 캐시 ────────────────────────────────────────────────────
let todayAbnormalCache    = null;
let todayAbnormalCachedAt = 0;
const TODAY_TTL_MS        = 5 * 60 * 1000; // 5분

// ── 파라미터 유효성 검사 ──────────────────────────────────────────────────
function validateParams(query) {
  if (!query.year) return 'year 파라미터가 필요합니다';
  return null;
}

// ── 조회 범위 계산 ────────────────────────────────────────────────────────
function getYearRange(year) {
  const y = parseInt(year, 10);
  const s = new Date(y, 0, 1, 0, 0, 0, 0);
  const e = new Date(y + 1, 0, 1, 0, 0, 0, 0);

  // 오늘 데이터 포함: 내일 자정까지 쿼리 (오늘 수집분 반영)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const rangeEnd = e < tomorrow ? e : tomorrow;
  return { rangeStart: s, rangeEnd };
}

// ── 슬롯 목록 생성 (전체 년도, 미래 포함) ────────────────────────────────
function generateYearSlots(year) {
  const y = parseInt(year, 10);
  const cur = new Date(y, 0, 1, 0, 0, 0, 0);
  const end = new Date(y + 1, 0, 1, 0, 0, 0, 0);
  const slots = [];
  while (cur < end) {
    slots.push(dateToStr(new Date(cur)));
    cur.setTime(cur.getTime() + INTERVAL_MS);
  }
  return slots;
}

// ── 과거 집계 캐시 getter ────────────────────────────────────────────────
async function getHistAgg(year) {
  const cached = histAggCache.get(year);
  if (cached && Date.now() - cached.cachedAt < HIST_TTL_MS) return cached;
  if (histAggFetching.has(year)) return histAggFetching.get(year);

  const promise = (async () => {
    try {
      const { rangeStart } = getYearRange(year);
      const todayStart = new Date(dateToStr(new Date()) + 'T00:00:00');
      if (todayStart <= rangeStart) {
        const empty = { nodeAgg: new Map(), dirAgg: new Map(), hourlyNodeCount: new Map(), cachedAt: Date.now() };
        histAggCache.set(year, empty);
        return empty;
      }
      const dateStart    = dateToStr(rangeStart);
      const yearEnd      = new Date(parseInt(year, 10) + 1, 0, 1);
      const yesterday    = new Date(todayStart.getTime() - 86400000);
      const dateEnd      = dateToStr(yesterday < yearEnd ? yesterday : new Date(yearEnd.getTime() - 86400000));
      const yesterdayStr = dateToStr(yesterday);
      const currentYear  = String(new Date().getFullYear());

      // 파일 캐시 확인 (과거 연도: 영구 / 현재 연도: 어제 데이터까지 유효)
      const fc      = loadSlotsCache(year);
      const isFresh = fc && (year !== currentYear || fc.savedDate >= yesterdayStr);
      let slots;
      if (isFresh) {
        slots = fc.slots;
        console.log(`[home] getHistAgg 파일 캐시: ${year} (${slots.length}건)`);
      } else {
        console.log(`[home] getHistAgg DB 직접 조회: ${dateStart} ~ ${dateEnd}`);
        slots = await fetchHistoricalSlots(dateStart, dateEnd);
        console.log(`[home] getHistAgg DB 완료: ${slots.length}건`);
        saveSlotsCache(year, { savedDate: dateEnd, slots });
      }

      const result = { ...await buildAggregates(slots), cachedAt: Date.now() };
      histAggCache.set(year, result);
      return result;
    } catch (err) {
      console.error('[home] getHistAgg DB 오류 — 빈 집계 반환:', err.message);
      const empty = { nodeAgg: new Map(), dirAgg: new Map(), hourlyNodeCount: new Map(), cachedAt: Date.now() };
      return empty;
    } finally {
      histAggFetching.delete(year);
    }
  })();
  histAggFetching.set(year, promise);
  return promise;
}

// ── 오늘 시간별 캐시 getter ──────────────────────────────────────────────
async function getTodayHourly(year) {
  const cached = todayHourlyCache.get(year);
  if (cached && Date.now() - cached.cachedAt < TODAY_SLOT_TTL_MS) return cached;
  if (todayHourlyFetching.has(year)) return todayHourlyFetching.get(year);

  const promise = (async () => {
    try {
      const today  = dateToStr(new Date());
      const slots  = await fetchHistoricalSlots(today, today);
      const result = { existingBySlot: buildTodaySlot(slots), cachedAt: Date.now() };
      todayHourlyCache.set(year, result);
      return result;
    } catch (err) {
      console.error('[home] getTodayHourly DB 오류 — 빈 슬롯 반환:', err.message);
      return { existingBySlot: new Map(), cachedAt: Date.now() };
    } finally {
      todayHourlyFetching.delete(year);
    }
  })();
  todayHourlyFetching.set(year, promise);
  return promise;
}

// ── 연간 summary getter ──────────────────────────────────────────────────
async function getSummaryBoth(year) {
  const cached = summaryCache.get(year);
  if (cached && Date.now() - cached.cachedAt < SUMMARY_TTL_MS) return cached;
  if (summaryFetching.has(year)) return summaryFetching.get(year);

  const promise = (async () => {
    const t0 = Date.now();
    try {
      const { nodeAcsrMap, approaches } = await getApproachMasterData();
      const { rangeEnd } = getYearRange(year);
      const slots = generateYearSlots(year);
      const ht = getHourlyTarget();

      const [{ nodeAgg, dirAgg, hourlyNodeCount }, { existingBySlot: todaySlot }] = await Promise.all([
        getHistAgg(year),
        getTodayHourly(year),
      ]);

      const nodeSlots = computeMissingFast(slots, nodeAgg, dirAgg, todaySlot, nodeAcsrMap, approaches, rangeEnd, 'node', ht, hourlyNodeCount);
      const dirSlots  = computeMissingFast(slots, nodeAgg, dirAgg, todaySlot, nodeAcsrMap, approaches, rangeEnd, 'direction', ht, hourlyNodeCount);

      // ── detail 사전 계산 (클릭 시 즉시 반환용) ─────────────────────────
      const today      = dateToStr(new Date());
      const totalNodes = nodeAcsrMap.size;
      const nodeDetail = new Map();
      const dirDetail  = new Map();

      // 오늘 유효 시간 계산 (computeMissingFast와 동일 로직)
      const todayStartDt  = new Date(today + 'T00:00:00');
      const tomorrowDt    = new Date(todayStartDt); tomorrowDt.setDate(tomorrowDt.getDate() + 1);
      const isValidHt     = ht && ht >= todayStartDt && ht < tomorrowDt;
      const todayHourData = todaySlot.get(today) || new Map();
      const todayValidHours = isValidHt
        ? Array.from({ length: ht.getHours() + 1 }, (_, i) => padZ(i))
            .filter(h => !NIGHT_HOURS.has(h))
            .filter(h => (todayHourData.get(h)?.size ?? 0) / totalNodes >= VALID_HOUR_NODE_RATIO)
        : [];

      for (const slotKey of slots) {
        const slotTime = new Date(slotKey + 'T00:00:00');
        if (rangeEnd && slotTime >= rangeEnd) break;

        if (slotKey === today) {
          if (todayValidHours.length > 0) {
            nodeDetail.set(today, _computeDetailFromHourly(todayValidHours, todayHourData, nodeAcsrMap, approaches, 'node'));
            dirDetail.set(today,  _computeDetailFromHourly(todayValidHours, todayHourData, nodeAcsrMap, approaches, 'direction'));
          }
        } else {
          const nd = _computeDetailFromAgg(slotKey, nodeAgg, dirAgg, nodeAcsrMap, approaches, 'node', hourlyNodeCount, totalNodes);
          const dd = _computeDetailFromAgg(slotKey, nodeAgg, dirAgg, nodeAcsrMap, approaches, 'direction', hourlyNodeCount, totalNodes);
          if (nd.length > 0) nodeDetail.set(slotKey, nd);
          if (dd.length > 0) dirDetail.set(slotKey, dd);
        }
      }

      const result = { nodeSlots, dirSlots, nodeDetail, dirDetail, cachedAt: Date.now() };
      summaryCache.set(year, result);
      console.log(`[home][${year}] 히트맵 계산 완료 (${Date.now() - t0}ms)`);
      return result;
    } finally {
      summaryFetching.delete(year);
    }
  })();
  summaryFetching.set(year, promise);
  return promise;
}

// ── 결측 계산 (과거=집계, 오늘=시간별 분기) ─────────────────────────────
function computeMissingFast(slots, nodeAgg, dirAgg, todaySlot, nodeAcsrMap, approaches, rangeEnd, type, hourlyTarget, hourlyNodeCount) {
  const today = dateToStr(new Date());
  const todayStart = new Date(today + 'T00:00:00');
  const tomorrow = new Date(todayStart);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isValidTarget = hourlyTarget && hourlyTarget >= todayStart && hourlyTarget < tomorrow;
  const todayEnd = isValidTarget ? hourlyTarget : tomorrow;

  return slots.map(slotKey => {
    const slotTime = new Date(slotKey + 'T00:00:00');
    if (rangeEnd && slotTime >= rangeEnd)
      return { slotKey, count: 0, preview: [], hasMore: false, future: true };

    if (slotKey === today) {
      // 오늘: 완료된 시간별 데이터 사용
      const endH = todayEnd.getHours();
      const completedHours = isValidTarget
        ? Array.from({ length: endH + 1 }, (_, i) => padZ(i)).filter(h => !NIGHT_HOURS.has(h))
        : [];
      if (completedHours.length === 0)
        return { slotKey, count: 0, preview: [], hasMore: false, future: false };
      const hourData = todaySlot.get(slotKey) || new Map();
      return _computeSlotFromHourly(slotKey, completedHours, hourData, nodeAcsrMap, approaches, type);
    }

    // 과거: 집계 데이터 사용 (결측 비율 30% 이상)
    return _computeSlotFromAgg(slotKey, nodeAgg, dirAgg, nodeAcsrMap, approaches, type, hourlyNodeCount, nodeAcsrMap.size);
  });
}

// ── 오늘 슬롯: 시간별 데이터로 결측 계산 ────────────────────────────────
function _computeSlotFromHourly(slotKey, completedHours, hourData, nodeAcsrMap, approaches, type) {
  const totalNodes = nodeAcsrMap.size;

  // 유효 시간 필터: 전체 교차로의 VALID_HOUR_NODE_RATIO 이상 활성인 시간만
  const validHours = completedHours.filter(h =>
    (hourData.get(h)?.size ?? 0) / totalNodes >= VALID_HOUR_NODE_RATIO
  );
  if (validHours.length === 0)
    return { slotKey, count: 0, preview: [], hasMore: false, future: false };

  if (type === 'node') {
    const preview = [];
    let count = 0;
    for (const [nodeId, { nodeName }] of nodeAcsrMap) {
      let missingCount = 0;
      for (const h of validHours) {
        if ((hourData.get(h)?.get(nodeId)?.size ?? 0) === 0) missingCount++;
      }
      if (validHours.length > 0 && missingCount / validHours.length >= 0.3) {
        count++;
        if (preview.length < 3) preview.push(nodeName);
      }
    }
    return { slotKey, count, preview, hasMore: count > 3, future: false };
  } else {
    // 이상 교차로 집합 구성 (결측 비율 30% 이상)
    const missingNodeIds = new Set();
    for (const [nodeId] of nodeAcsrMap) {
      let missingCount = 0;
      for (const h of validHours) {
        if ((hourData.get(h)?.get(nodeId)?.size ?? 0) === 0) missingCount++;
      }
      if (validHours.length > 0 && missingCount / validHours.length >= 0.3) missingNodeIds.add(nodeId);
    }
    const preview = [];
    let count = 0;
    for (const { nodeId, acsrId, nodeName, acsrName } of approaches) {
      if (missingNodeIds.has(nodeId)) continue;
      let missingCount = 0;
      for (const h of validHours) {
        if (!(hourData.get(h)?.get(nodeId)?.has(acsrId))) missingCount++;
      }
      if (validHours.length > 0 && missingCount / validHours.length >= 0.3) {
        count++;
        if (preview.length < 3) preview.push(`${nodeName}-${acsrName}`);
      }
    }
    return { slotKey, count, preview, hasMore: count > 3, future: false };
  }
}

// ── 과거 슬롯: 집계 데이터로 결측 계산 ──────────────────────────────────
function _computeSlotFromAgg(slotKey, nodeAgg, dirAgg, nodeAcsrMap, approaches, type, hourlyNodeCount, totalNodes) {
  // 유효 시간 배열: 전체 교차로의 VALID_HOUR_NODE_RATIO 이상 활성인 시간
  const slotHourCount = (hourlyNodeCount ?? new Map()).get(slotKey) ?? new Map();
  const validHoursArray = [];
  for (const [hour, activeNodes] of slotHourCount) {
    if (activeNodes / totalNodes >= VALID_HOUR_NODE_RATIO) validHoursArray.push(hour);
  }
  if (validHoursArray.length === 0)
    return { slotKey, count: 0, preview: [], hasMore: false, future: false };

  const slotNodeAgg = nodeAgg.get(slotKey) || new Map();

  if (type === 'node') {
    const preview = [];
    let count = 0;
    for (const [nodeId, { nodeName }] of nodeAcsrMap) {
      const activeHourSet = slotNodeAgg.get(nodeId) ?? new Set();
      let missingCount = 0;
      for (const h of validHoursArray) {
        if (!activeHourSet.has(h)) missingCount++;
      }
      if (validHoursArray.length > 0 && missingCount / validHoursArray.length >= 0.3) {
        count++;
        if (preview.length < 3) preview.push(nodeName);
      }
    }
    return { slotKey, count, preview, hasMore: count > 3, future: false };
  } else {
    // 이상 교차로 집합 구성
    const missingNodeIds = new Set();
    for (const [nodeId] of nodeAcsrMap) {
      const activeHourSet = slotNodeAgg.get(nodeId) ?? new Set();
      let missingCount = 0;
      for (const h of validHoursArray) {
        if (!activeHourSet.has(h)) missingCount++;
      }
      if (validHoursArray.length > 0 && missingCount / validHoursArray.length >= 0.3) missingNodeIds.add(nodeId);
    }
    const slotDirAgg = dirAgg.get(slotKey) || new Map();
    const preview = [];
    let count = 0;
    for (const { nodeId, acsrId, nodeName, acsrName } of approaches) {
      if (missingNodeIds.has(nodeId)) continue;
      const activeHourSet = slotDirAgg.get(nodeId)?.get(acsrId) ?? new Set();
      let missingCount = 0;
      for (const h of validHoursArray) {
        if (!activeHourSet.has(h)) missingCount++;
      }
      if (validHoursArray.length > 0 && missingCount / validHoursArray.length >= 0.3) {
        count++;
        if (preview.length < 3) preview.push(`${nodeName}-${acsrName}`);
      }
    }
    return { slotKey, count, preview, hasMore: count > 3, future: false };
  }
}

// ── detail 사전 계산: 집계 데이터 기반 (과거 슬롯) ────────────────────────
function _computeDetailFromAgg(slotKey, nodeAgg, dirAgg, nodeAcsrMap, approaches, type, hourlyNodeCount, totalNodes) {
  const slotHourCount = (hourlyNodeCount ?? new Map()).get(slotKey) ?? new Map();
  const validHoursArray = [];
  for (const [hour, activeNodes] of slotHourCount) {
    if (activeNodes / totalNodes >= VALID_HOUR_NODE_RATIO) validHoursArray.push(hour);
  }
  if (validHoursArray.length === 0) return [];

  const slotNodeAgg = nodeAgg.get(slotKey) || new Map();
  const items = [];

  if (type === 'node') {
    for (const [nodeId, { nodeName }] of nodeAcsrMap) {
      const activeHourSet = slotNodeAgg.get(nodeId) ?? new Set();
      let missingCount = 0;
      for (const h of validHoursArray) {
        if (!activeHourSet.has(h)) missingCount++;
      }
      const severity = getSeverity(missingCount, validHoursArray.length);
      if (severity !== null) items.push({ nodeId, nodeName, missingCount, severity });
    }
  } else {
    const missingNodeIds = new Set();
    for (const [nodeId] of nodeAcsrMap) {
      const activeHourSet = slotNodeAgg.get(nodeId) ?? new Set();
      let missingCount = 0;
      for (const h of validHoursArray) {
        if (!activeHourSet.has(h)) missingCount++;
      }
      if (getSeverity(missingCount, validHoursArray.length) !== null) missingNodeIds.add(nodeId);
    }
    const slotDirAgg = dirAgg.get(slotKey) || new Map();
    for (const { nodeId, acsrId, nodeName, acsrName } of approaches) {
      if (missingNodeIds.has(nodeId)) continue;
      const activeHourSet = slotDirAgg.get(nodeId)?.get(acsrId) ?? new Set();
      let missingCount = 0;
      for (const h of validHoursArray) {
        if (!activeHourSet.has(h)) missingCount++;
      }
      const severity = getSeverity(missingCount, validHoursArray.length);
      if (severity !== null) items.push({ nodeId, nodeName, acsrId, acsrName, missingCount, severity });
    }
  }

  sortBySeverity(items, 'nodeName');
  return items;
}

// ── detail 사전 계산: 시간별 데이터 기반 (오늘 슬롯) ─────────────────────
function _computeDetailFromHourly(validHours, hourData, nodeAcsrMap, approaches, type) {
  if (validHours.length === 0) return [];
  const items = [];

  if (type === 'node') {
    for (const [nodeId, { nodeName }] of nodeAcsrMap) {
      let missingCount = 0;
      for (const h of validHours) {
        if ((hourData.get(h)?.get(nodeId)?.size ?? 0) === 0) missingCount++;
      }
      const severity = getSeverity(missingCount, validHours.length);
      if (severity !== null) items.push({ nodeId, nodeName, missingCount, severity });
    }
  } else {
    const missingNodeIds = new Set();
    for (const [nodeId] of nodeAcsrMap) {
      let missingCount = 0;
      for (const h of validHours) {
        if ((hourData.get(h)?.get(nodeId)?.size ?? 0) === 0) missingCount++;
      }
      if (getSeverity(missingCount, validHours.length) !== null) missingNodeIds.add(nodeId);
    }
    for (const { nodeId, acsrId, nodeName, acsrName } of approaches) {
      if (missingNodeIds.has(nodeId)) continue;
      let missingCount = 0;
      for (const h of validHours) {
        if (!(hourData.get(h)?.get(nodeId)?.has(acsrId))) missingCount++;
      }
      const severity = getSeverity(missingCount, validHours.length);
      if (severity !== null) items.push({ nodeId, nodeName, acsrId, acsrName, missingCount, severity });
    }
  }

  sortBySeverity(items, 'nodeName');
  return items;
}

// ── Routes ────────────────────────────────────────────────────────────────

// GET /api/home/missing/summary?year=YYYY&type=node|direction
router.get('/missing/summary', async (req, res) => {
  const errMsg = validateParams(req.query);
  if (errMsg) return res.status(400).json({ error: errMsg });

  const type = req.query.type || 'node';
  if (!['node', 'direction'].includes(type)) {
    return res.status(400).json({ error: 'type은 node|direction 중 하나여야 합니다' });
  }

  // 캐시 히트 → 즉시 반환
  const cached = summaryCache.get(req.query.year);
  if (cached) {
    const slots = type === 'node' ? cached.nodeSlots : cached.dirSlots;
    return res.json({ slots });
  }

  // 캐시 미스 → 배경 계산 트리거 후 빈 데이터 즉시 반환 (폴링으로 채워짐)
  getSummaryBoth(req.query.year).catch(err =>
    console.error('[home] summary background error:', err.message)
  );
  return res.json({ slots: [] });
});

// GET /api/home/today-abnormal
router.get('/today-abnormal', async (req, res) => {
  // 5분 캐시 (매 폴링마다 DB 조회 방지)
  if (todayAbnormalCache && Date.now() - todayAbnormalCachedAt < TODAY_TTL_MS) {
    return res.json(todayAbnormalCache);
  }

  try {
    const year = String(new Date().getFullYear());

    // todayHourlyCache 미스 → 배경 계산 트리거 후 빈 데이터 즉시 반환 (폴링으로 채워짐)
    const hourlyEntry = todayHourlyCache.get(year);
    if (!hourlyEntry) {
      getTodayHourly(year).catch(() => {});
      return res.json({ count: 0, directionCount: 0, nodes: [], directions: [] });
    }

    const { existingBySlot } = hourlyEntry;
    const { intersections } = await getMasterData();
    const { nodeAcsrMap, approaches } = await getApproachMasterData();
    const today = dateToStr(new Date());

    const todayStart = new Date(today + 'T00:00:00');
    const tomorrow = new Date(todayStart);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const target = getHourlyTarget();
    const todayEnd = (target && target >= todayStart && target < tomorrow) ? target : tomorrow;

    const hourData = existingBySlot.get(today) || new Map();

    // 완료된 시간 슬롯: 업데이트 시간 H:00 → 00~H시 포함(H+1개), 야간 시간대 제외
    const isValidTarget = target && target >= todayStart && target < tomorrow;
    const endH = todayEnd.getHours();
    const rawHours = isValidTarget
      ? Array.from({ length: endH + 1 }, (_, i) => padZ(i)).filter(h => !NIGHT_HOURS.has(h))
      : [];

    // 유효 시간 필터: 전체 교차로의 VALID_HOUR_NODE_RATIO 이상 활성인 시간만
    const totalNodes = nodeAcsrMap.size;
    const completedHours = rawHours.filter(h =>
      (hourData.get(h)?.size ?? 0) / totalNodes >= VALID_HOUR_NODE_RATIO
    );

    if (completedHours.length === 0) {
      const payload = { count: 0, directionCount: 0, nodes: [], directions: [] };
      todayAbnormalCache    = payload;
      todayAbnormalCachedAt = Date.now();
      return res.json(payload);
    }

    // 1차: 교차로 이상 집합 (결측 비율 30% 이상인 교차로)
    const fullyMissingNodes = new Map(); // nodeId → { missingCount, effectiveValid }
    for (const [nodeId] of nodeAcsrMap) {
      let missingCount = 0;
      for (const h of completedHours) {
        if ((hourData.get(h)?.get(nodeId)?.size ?? 0) === 0) missingCount++;
      }
      if (completedHours.length > 0 && getSeverity(missingCount, completedHours.length) !== null) {
        fullyMissingNodes.set(nodeId, { missingCount, effectiveValid: completedHours.length });
      }
    }

    // 2차: 방향 이상 (이상교차로 제외, 결측 비율 30% 이상인 방향)
    const partialMissingDirs = new Map(); // `${nodeId}_${acsrId}` → { missingCount, effectiveValid }
    for (const [nodeId, { acsrIds: masterAcsrSet }] of nodeAcsrMap) {
      if (fullyMissingNodes.has(nodeId)) continue; // 이상교차로 제외
      for (const acsrId of masterAcsrSet) {
        let missingCount = 0;
        for (const h of completedHours) {
          if (!(hourData.get(h)?.get(nodeId)?.has(acsrId))) missingCount++;
        }
        if (completedHours.length > 0 && getSeverity(missingCount, completedHours.length) !== null) {
          partialMissingDirs.set(`${nodeId}_${acsrId}`, { missingCount, effectiveValid: completedHours.length });
        }
      }
    }

    const abnormalList = intersections
      .filter(({ nodeId }) => fullyMissingNodes.has(nodeId))
      .map(({ nodeId, nodeName }) => {
        const { missingCount, effectiveValid } = fullyMissingNodes.get(nodeId);
        return { nodeId, nodeName, missingCount, severity: getSeverity(missingCount, effectiveValid) };
      });
    sortBySeverity(abnormalList, 'nodeName');

    // 방향 결측 목록 생성 (교차로 완전 결측 제외)
    const approachMap = new Map();
    for (const a of approaches) approachMap.set(`${a.nodeId}_${a.acsrId}`, a);
    const directionsList = [];
    for (const [key, { missingCount, effectiveValid }] of partialMissingDirs) {
      const a = approachMap.get(key);
      if (a) directionsList.push({
        nodeId: a.nodeId, nodeName: a.nodeName, acsrId: a.acsrId, acsrName: a.acsrName,
        missingCount, severity: getSeverity(missingCount, effectiveValid),
      });
    }
    sortBySeverity(directionsList, 'nodeName');

    const payload = {
      count: fullyMissingNodes.size,
      directionCount: partialMissingDirs.size,
      nodes: abnormalList,
      directions: directionsList,
    };
    todayAbnormalCache    = payload;
    todayAbnormalCachedAt = Date.now();
    res.json(payload);
  } catch (err) {
    console.error('[home] today-abnormal 조회 오류:', err);
    res.status(500).json({ error: '이상 교차로 조회 실패' });
  }
});

// GET /api/home/missing/detail?year=YYYY&slot=YYYY-MM-DD&type=node|direction
router.get('/missing/detail', async (req, res) => {
  const { year, slot, type = 'node' } = req.query;
  if (!year) return res.status(400).json({ error: 'year 파라미터가 필요합니다' });
  if (!slot) return res.status(400).json({ error: 'slot 파라미터가 필요합니다' });
  if (!['node', 'direction'].includes(type)) {
    return res.status(400).json({ error: 'type은 node|direction 중 하나여야 합니다' });
  }

  // 사전 계산된 캐시 확인 (빠른 경로)
  const sc = summaryCache.get(year);
  if (sc) {
    const detailMap = type === 'node' ? sc.nodeDetail : sc.dirDetail;
    if (detailMap) {
      return res.json({ slotKey: slot, items: detailMap.get(slot) ?? [] });
    }
  }

  try {
    const { nodeAcsrMap, approaches } = await getApproachMasterData();

    const slotStart = new Date(slot + 'T00:00:00');
    const slotEnd   = new Date(slotStart.getTime() + INTERVAL_MS);

    const acsrResult = await execute(
      `SELECT DISTINCT NODE_ID, ACSR_ID, TO_CHAR(TOT_DT, 'HH24') AS SLOT_HOUR
         FROM ${TABLE_1HH}
        WHERE TOT_DT >= :slotStart AND TOT_DT < :slotEnd`,
      { slotStart, slotEnd }
    );

    // Map<hour, Map<nodeId, Set<acsrId>>>
    const hourMap = new Map();
    for (const r of acsrResult.rows) {
      if (!hourMap.has(r.SLOT_HOUR)) hourMap.set(r.SLOT_HOUR, new Map());
      const nodeMap = hourMap.get(r.SLOT_HOUR);
      if (!nodeMap.has(r.NODE_ID)) nodeMap.set(r.NODE_ID, new Set());
      nodeMap.get(r.NODE_ID).add(r.ACSR_ID);
    }

    // completedHours 결정: 오늘이면 hourlyTarget 기준, 과거면 0~23
    // 유효 시간 필터 적용: 전체 교차로의 VALID_HOUR_NODE_RATIO 이상 활성인 시간만
    const today = dateToStr(new Date());
    const totalNodes = nodeAcsrMap.size;
    let completedHours;
    if (slot === today) {
      const target = getHourlyTarget();
      const todayStart = slotStart;
      const tomorrow = new Date(todayStart.getTime() + INTERVAL_MS);
      const isValidTarget = target && target >= todayStart && target < tomorrow;
      const todayEnd = isValidTarget ? target : tomorrow;
      const endH = todayEnd.getHours();
      const rawHours = isValidTarget
        ? Array.from({ length: endH + 1 }, (_, i) => padZ(i)).filter(h => !NIGHT_HOURS.has(h))
        : [];
      completedHours = rawHours.filter(h =>
        (hourMap.get(h)?.size ?? 0) / totalNodes >= VALID_HOUR_NODE_RATIO
      );
    } else {
      const allHours = Array.from({ length: 24 }, (_, i) => padZ(i)).filter(h => !NIGHT_HOURS.has(h));
      completedHours = allHours.filter(h =>
        (hourMap.get(h)?.size ?? 0) / totalNodes >= VALID_HOUR_NODE_RATIO
      );
    }

    if (completedHours.length === 0) {
      return res.json({ slotKey: slot, items: [] });
    }

    const items = [];

    if (type === 'node') {
      for (const [nodeId, { nodeName }] of nodeAcsrMap) {
        let missingCount = 0;
        for (const h of completedHours) {
          const nodeMap = hourMap.get(h) || new Map();
          if ((nodeMap.get(nodeId) || new Set()).size === 0) missingCount++;
        }
        const severity = getSeverity(missingCount, completedHours.length);
        if (severity !== null) items.push({ nodeId, nodeName, missingCount, severity });
      }
    } else {
      // 이상교차로 집합 구성 (결측 비율 30% 이상)
      const missingNodeIds = new Set();
      for (const [nodeId] of nodeAcsrMap) {
        let missingCount = 0;
        for (const h of completedHours) {
          const nodeMap = hourMap.get(h) || new Map();
          if ((nodeMap.get(nodeId) || new Set()).size === 0) missingCount++;
        }
        if (completedHours.length > 0 && getSeverity(missingCount, completedHours.length) !== null) missingNodeIds.add(nodeId);
      }

      // 이상교차로 제외 후 결측 비율 30% 이상인 방향 목록
      for (const { nodeId, acsrId, nodeName, acsrName } of approaches) {
        if (missingNodeIds.has(nodeId)) continue;
        let missingCount = 0;
        for (const h of completedHours) {
          const nodeMap = hourMap.get(h) || new Map();
          if (!(nodeMap.get(nodeId) || new Set()).has(acsrId)) missingCount++;
        }
        const severity = getSeverity(missingCount, completedHours.length);
        if (severity !== null) items.push({ nodeId, nodeName, acsrId, acsrName, missingCount, severity });
      }
    }

    sortBySeverity(items, 'nodeName');
    res.json({ slotKey: slot, items });
  } catch (err) {
    console.error('[home] detail 조회 오류:', err);
    res.status(500).json({ error: '결측 상세 조회 실패' });
  }
});

// ── 서버 시작 시 현재 연도 캐시 워밍 ────────────────────────────────────
// 첫 사용자 접근 전에 미리 DB 조회 + 계산을 완료해 둠
setImmediate(() => {
  const year = String(new Date().getFullYear());
  Promise.all([getHistAgg(year), getTodayHourly(year)])
    .then(() => getSummaryBoth(year))
    .catch(err => console.error('[home] 시작 캐시 워밍 오류:', err));
});

module.exports = router;
