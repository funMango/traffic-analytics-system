'use strict';

const { execute } = require('../db');

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '60000', 10);
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;  // 1시간 슬롯

let lastSeen = null;
let currentUpdateTime = null;
let targetUpdateTime = null;
const nullSlots = new Map(); // Map<'YYYY-MM-DD', Set<'HH:00'>>
let timer = null;
let broadcastFn = null;

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function roundDownToHour(date) {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d;
}

function dateToStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateToHHMM(date) {
  return `${String(date.getHours()).padStart(2, '0')}:00`;
}

// 특정 날짜의 NULL 슬롯 배열 반환 (routes/traffic.js에서 사용)
function getNullSlotsForDate(dateStr) {
  return Array.from(nullSlots.get(dateStr) || []);
}

// 특정 월의 NULL 슬롯 객체 반환 { 'YYYY-MM-DD': ['HH:00', ...] }
function getNullSlotsForMonth(monthStr) {
  const obj = {};
  for (const [dateStr, set] of nullSlots.entries()) {
    if (dateStr.startsWith(monthStr)) {
      obj[dateStr] = Array.from(set);
    }
  }
  return obj;
}

// ─── 초기화 ──────────────────────────────────────────────────────────────────

async function initHourlyUpdateTimes() {
  try {
    const result = await execute(
      `SELECT MAX(TOT_DT) AS LATEST FROM S_CRSRD_ACSR_TRF_1HH`,
      {}
    );
    const latest = result.rows[0]?.LATEST;
    if (latest) {
      lastSeen = new Date(latest);
      currentUpdateTime = roundDownToHour(lastSeen);
    } else {
      currentUpdateTime = roundDownToHour(new Date());
      lastSeen = new Date(currentUpdateTime.getTime() - 1);
    }
    targetUpdateTime = new Date(currentUpdateTime.getTime() + UPDATE_INTERVAL_MS);
    console.log(`[HourlyPoller] 초기화: currentUpdateTime=${dateToHHMM(currentUpdateTime)}, target=${dateToHHMM(targetUpdateTime)}`);
  } catch (err) {
    console.error('[HourlyPoller] 초기화 오류:', err.message);
    currentUpdateTime = roundDownToHour(new Date());
    lastSeen = new Date(currentUpdateTime.getTime() - 1);
    targetUpdateTime = new Date(currentUpdateTime.getTime() + UPDATE_INTERVAL_MS);
  }
}

// ─── 폴링 ────────────────────────────────────────────────────────────────────

async function poll() {
  try {
    const acsrResult = await execute(
      `SELECT DISTINCT TOT_DT
         FROM S_CRSRD_ACSR_TRF_1HH
        WHERE TOT_DT > :lastSeen
        ORDER BY TOT_DT ASC`,
      { lastSeen }
    );

    const today = dateToStr(new Date());

    if (acsrResult.rows.length > 0) {
      const latestRow = acsrResult.rows[acsrResult.rows.length - 1];
      const latestRounded = roundDownToHour(new Date(latestRow.TOT_DT));

      const prevLastSeen = lastSeen;

      lastSeen = new Date(latestRow.TOT_DT);
      currentUpdateTime = latestRounded;
      targetUpdateTime = new Date(latestRounded.getTime() + UPDATE_INTERVAL_MS);

      try {
        const trfResult = await execute(
          `SELECT NODE_ID, TOT_DT, TRF_QNTY, AVG_SPD, OCPN_RATE, CLBR_TRF_QNTY, PDST_QNTY, LOS
             FROM S_CRSRD_TRF_1HH
            WHERE TOT_DT > :prevLastSeen
              AND TOT_DT <= :lastSeen
            ORDER BY TOT_DT ASC`,
          { prevLastSeen, lastSeen }
        );

        console.log(`[HourlyPoller] 신규 시간 슬롯(ACSR 기준) 감지 → SSE 브로드캐스트 (교차로 ${trfResult.rows.length}건)`);

        if (broadcastFn && trfResult.rows.length > 0) {
          broadcastFn('hourly-traffic-update', {
            rows: trfResult.rows,
            nullSlots: getNullSlotsForDate(today),
          });
        }
      } catch (trfErr) {
        console.error('[HourlyPoller] 교차로 쿼리 오류:', trfErr.message);
      }
    } else {
      console.log(`[HourlyPoller] 신규 데이터 없음 (lastSeen: ${lastSeen?.toISOString()})`);
    }

    // ── DB 직접 조회 기반 결측 슬롯 갱신 ───────────────────────────────────
    // 현재 시간까지 데이터가 전혀 없는 시간대(어느 교차로도 데이터 없음)를 결측으로 판단
    try {
      const presenceResult = await execute(
        `SELECT TO_CHAR(TOT_DT, 'HH24') AS HH,
                COUNT(DISTINCT NODE_ID)  AS NODE_CNT
           FROM S_CRSRD_ACSR_TRF_1HH
          WHERE TRUNC(TOT_DT) = TRUNC(:today)
          GROUP BY TO_CHAR(TOT_DT, 'HH24')`,
        { today: new Date() }
      );
      const presence = new Map(presenceResult.rows.map(r => [r.HH, r.NODE_CNT]));
      const nowHour  = new Date().getHours();
      const newSet   = new Set();
      for (let h = 0; h <= nowHour; h++) {
        const hStr = String(h).padStart(2, '0');
        if ((presence.get(hStr) ?? 0) === 0) newSet.add(`${hStr}:00`);
      }
      const prev    = nullSlots.get(today);
      const changed = !prev || prev.size !== newSet.size || [...newSet].some(s => !prev.has(s));
      nullSlots.set(today, newSet);
      if (changed) {
        console.log(`[HourlyPoller] 결측 갱신: ${today} → ${newSet.size}개`);
        broadcastFn?.('hourly-null-slots', { nullSlots: getNullSlotsForDate(today) });
      }
    } catch (e) {
      console.error('[HourlyPoller] 결측 조회 실패 (기존 유지):', e.message);
    }
  } catch (err) {
    console.error('[HourlyPoller] 폴링 오류 (다음 인터벌에 재시도):', err.message);
  }
}

// ─── 시작/중지 ────────────────────────────────────────────────────────────────

function startHourlyPoller(broadcast) {
  broadcastFn = broadcast;
  timer = setInterval(poll, POLL_INTERVAL_MS);
  console.log(`[HourlyPoller] 폴링 시작 (간격: ${POLL_INTERVAL_MS / 1000}초)`);
  poll();
}

function stopHourlyPoller() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[HourlyPoller] 폴링 중지');
  }
}

module.exports = {
  startHourlyPoller,
  stopHourlyPoller,
  initHourlyUpdateTimes,
  getNullSlotsForDate,
  getNullSlotsForMonth,
  getTargetUpdateTime: () => targetUpdateTime,
};
