'use strict';

const { execute } = require('../db');

const POLL_INTERVAL_MS   = parseInt(process.env.POLL_INTERVAL_MS || '60000', 10);
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;  // 1일 슬롯

let lastSeen          = null;
let currentUpdateTime = null;
let targetUpdateTime  = null;
const nullDays        = new Set(); // Set<'YYYY-MM-DD'>
let timer       = null;
let broadcastFn = null;

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function roundDownToDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateToDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// 해당 날짜를 NULL 슬롯으로 확정. 새로 추가됐으면 true 반환.
function confirmNullSlot(date, reason) {
  const dateStr = dateToDateStr(date);
  if (!nullDays.has(dateStr)) {
    nullDays.add(dateStr);
    console.log(`[DailyPoller] NULL 슬롯 확정: ${dateStr} (${reason})`);
    return true;
  }
  return false;
}

// 특정 월의 NULL 슬롯 배열 반환 (routes/traffic.js에서 사용)
function getNullSlotsForMonth(monthStr) {
  const arr = Array.from(nullDays)
    .filter(dateStr => dateStr.startsWith(monthStr))
    .sort();
  return arr;
}

function getNullDeadline(targetDt) {
  // targetDt 날짜의 다음날 06:00
  const d = new Date(targetDt);
  d.setDate(d.getDate() + 1);
  d.setHours(6, 0, 0, 0);
  return d;
}

// ─── 초기화 ──────────────────────────────────────────────────────────────────

async function initDailyUpdateTimes() {
  try {
    const result = await execute(
      `SELECT MAX(TOT_DT) AS LATEST FROM S_CRSRD_TRF_1DD`,
      {}
    );
    const latest = result.rows[0]?.LATEST;
    if (latest) {
      lastSeen          = new Date(latest);
      currentUpdateTime = roundDownToDay(lastSeen);
    } else {
      currentUpdateTime = roundDownToDay(new Date());
      lastSeen          = new Date(currentUpdateTime.getTime() - 1);
    }
    targetUpdateTime = new Date(currentUpdateTime.getTime() + UPDATE_INTERVAL_MS);
    console.log(`[DailyPoller] 초기화: currentUpdateTime=${dateToDateStr(currentUpdateTime)}, target=${dateToDateStr(targetUpdateTime)}`);
  } catch (err) {
    console.error('[DailyPoller] 초기화 오류:', err.message);
    currentUpdateTime = roundDownToDay(new Date());
    lastSeen          = new Date(currentUpdateTime.getTime() - 1);
    targetUpdateTime  = new Date(currentUpdateTime.getTime() + UPDATE_INTERVAL_MS);
  }
}

// ─── 폴링 ────────────────────────────────────────────────────────────────────

async function poll() {
  try {
    const result = await execute(
      `SELECT NODE_ID, TOT_DT, TRF_QNTY, AVG_SPD, OCPN_RATE, CLBR_TRF_QNTY, PDST_QNTY, LOS
         FROM S_CRSRD_TRF_1DD
        WHERE TOT_DT > :lastSeen
        ORDER BY TOT_DT ASC`,
      { lastSeen }
    );

    const today = dateToDateStr(new Date());

    if (result.rows.length > 0) {
      const latestRow     = result.rows[result.rows.length - 1];
      const latestRounded = roundDownToDay(new Date(latestRow.TOT_DT));

      // 수신된 슬롯 집합 (1일 단위 YYYY-MM-DD)
      const receivedSlots = new Set(
        result.rows.map(r => dateToDateStr(roundDownToDay(new Date(r.TOT_DT))))
      );

      // target ~ latestRounded 사이 빈 슬롯 → NULL 확정 (갭 채움)
      let cur = new Date(targetUpdateTime);
      while (cur < latestRounded) {
        if (!receivedSlots.has(dateToDateStr(cur))) {
          confirmNullSlot(cur, '갭 채움');
        }
        cur = new Date(cur.getTime() + UPDATE_INTERVAL_MS);
      }

      lastSeen          = new Date(latestRow.TOT_DT);
      currentUpdateTime = latestRounded;
      targetUpdateTime  = new Date(latestRounded.getTime() + UPDATE_INTERVAL_MS);

      console.log(`[DailyPoller] 신규 데이터 ${result.rows.length}건 감지 → SSE 브로드캐스트`);

      if (broadcastFn) {
        broadcastFn('daily-traffic-update', {
          rows:      result.rows,
          nullSlots: getNullSlotsForMonth(today.slice(0, 7)),
        });
      }
    } else {
      // 데이터 없음: 타임아웃 체크
      const now        = Date.now();
      let newNullAdded = false;

      while (targetUpdateTime && now >= getNullDeadline(targetUpdateTime).getTime()) {
        const added = confirmNullSlot(targetUpdateTime, '타임아웃');
        if (added) newNullAdded = true;
        currentUpdateTime = new Date(targetUpdateTime);
        targetUpdateTime  = new Date(targetUpdateTime.getTime() + UPDATE_INTERVAL_MS);
      }

      if (newNullAdded && broadcastFn) {
        const currentMonth = dateToDateStr(new Date()).slice(0, 7);
        broadcastFn('daily-null-slots', { nullSlots: getNullSlotsForMonth(currentMonth) });
      }

      console.log(`[DailyPoller] 신규 데이터 없음 (lastSeen: ${lastSeen?.toISOString()})`);
    }
  } catch (err) {
    console.error('[DailyPoller] 폴링 오류 (다음 인터벌에 재시도):', err.message);
  }
}

// ─── 시작/중지 ────────────────────────────────────────────────────────────────

function startDailyPoller(broadcast) {
  broadcastFn = broadcast;
  timer = setInterval(poll, POLL_INTERVAL_MS);
  console.log(`[DailyPoller] 폴링 시작 (간격: ${POLL_INTERVAL_MS / 1000}초)`);
  poll();
}

function stopDailyPoller() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[DailyPoller] 폴링 중지');
  }
}

module.exports = {
  startDailyPoller,
  stopDailyPoller,
  initDailyUpdateTimes,
  getNullSlotsForMonth,
  getTargetUpdateTime: () => targetUpdateTime,
};
