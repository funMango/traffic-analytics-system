'use strict';

const { execute } = require('../db');

const POLL_INTERVAL_MS   = parseInt(process.env.POLL_INTERVAL_MS || '60000', 10);
const UPDATE_INTERVAL_MS = 15 * 60 * 1000;  // 15분 슬롯
const NULL_THRESHOLD     = 2;               // 2×15분 = 30분 초과 시 NULL 확정

let lastSeen          = null;
let currentUpdateTime = null;
let targetUpdateTime  = null;
const nullSlots       = new Map(); // Map<'YYYY-MM-DD', Set<'HH:MM'>>
let timer       = null;
let broadcastFn = null;

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function roundDownTo15Min(date) {
  const d = new Date(date);
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
  return d;
}

function dateToStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateToHHMM(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// 해당 시각을 NULL 슬롯으로 확정. 새로 추가됐으면 true 반환.
function confirmNullSlot(date, reason) {
  const dateStr = dateToStr(date);
  const hhmm    = dateToHHMM(date);
  if (!nullSlots.has(dateStr)) nullSlots.set(dateStr, new Set());
  const set = nullSlots.get(dateStr);
  if (!set.has(hhmm)) {
    set.add(hhmm);
    console.log(`[FifteenMinPoller] NULL 슬롯 확정: ${dateStr} ${hhmm} (${reason})`);
    return true;
  }
  return false;
}

// 특정 날짜의 NULL 슬롯 배열 반환 (routes/traffic.js에서 사용)
function getNullSlotsForDate(dateStr) {
  return Array.from(nullSlots.get(dateStr) || []);
}

// ─── 초기화 ──────────────────────────────────────────────────────────────────

async function initFifteenMinUpdateTimes() {
  try {
    const result = await execute(
      `SELECT MAX(TOT_DT) AS LATEST FROM S_CRSRD_TRF_15MI`,
      {}
    );
    const latest = result.rows[0]?.LATEST;
    if (latest) {
      lastSeen          = new Date(latest);
      currentUpdateTime = roundDownTo15Min(lastSeen);
    } else {
      currentUpdateTime = roundDownTo15Min(new Date());
      lastSeen          = new Date(currentUpdateTime.getTime() - 1);
    }
    targetUpdateTime = new Date(currentUpdateTime.getTime() + UPDATE_INTERVAL_MS);
    console.log(`[FifteenMinPoller] 초기화: currentUpdateTime=${dateToHHMM(currentUpdateTime)}, target=${dateToHHMM(targetUpdateTime)}`);
  } catch (err) {
    console.error('[FifteenMinPoller] 초기화 오류:', err.message);
    currentUpdateTime = roundDownTo15Min(new Date());
    lastSeen          = new Date(currentUpdateTime.getTime() - 1);
    targetUpdateTime  = new Date(currentUpdateTime.getTime() + UPDATE_INTERVAL_MS);
  }
}

// ─── 폴링 ────────────────────────────────────────────────────────────────────

async function poll() {
  try {
    const result = await execute(
      `SELECT NODE_ID, TOT_DT, TRF_QNTY, AVG_SPD, OCPN_RATE, CLBR_TRF_QNTY, PDST_QNTY, LOS
         FROM S_CRSRD_TRF_15MI
        WHERE TOT_DT > :lastSeen
        ORDER BY TOT_DT ASC`,
      { lastSeen }
    );

    const today = dateToStr(new Date());

    if (result.rows.length > 0) {
      const latestRow     = result.rows[result.rows.length - 1];
      const latestRounded = roundDownTo15Min(new Date(latestRow.TOT_DT));

      // 수신된 슬롯 집합 (15분 단위 HH:MM)
      const receivedSlots = new Set(
        result.rows.map(r => dateToHHMM(roundDownTo15Min(new Date(r.TOT_DT))))
      );

      // target ~ latestRounded 사이 빈 슬롯 → NULL 확정 (갭 채움)
      let cur = new Date(targetUpdateTime);
      while (cur < latestRounded) {
        if (!receivedSlots.has(dateToHHMM(cur))) {
          confirmNullSlot(cur, '갭 채움');
        }
        cur = new Date(cur.getTime() + UPDATE_INTERVAL_MS);
      }

      const prevLastSeen = lastSeen;
      lastSeen          = new Date(latestRow.TOT_DT);
      currentUpdateTime = latestRounded;
      targetUpdateTime  = new Date(latestRounded.getTime() + UPDATE_INTERVAL_MS);

      console.log(`[FifteenMinPoller] 신규 데이터 ${result.rows.length}건 감지 → SSE 브로드캐스트`);

      if (broadcastFn) {
        broadcastFn('fifteen-min-traffic-update', {
          rows:      result.rows,
          nullSlots: getNullSlotsForDate(today),
        });
      }

      try {
        const directionResult = await execute(
          `SELECT NODE_ID, ACSR_ID, DRCT_CD, TOT_DT, TRF_QNTY,
                  TO_CHAR(TOT_DT, 'YYYY-MM-DD HH24:MI') AS SLOT_LABEL
             FROM S_CRSRD_DRCT_TRF_15MI
            WHERE TOT_DT > :prevLastSeen
              AND TOT_DT <= :lastSeen
              AND DRCT_CD IN ('01', '02', '03')
            ORDER BY TOT_DT ASC, DRCT_CD ASC`,
          { prevLastSeen, lastSeen }
        );
        if (directionResult.rows.length > 0 && broadcastFn) {
          broadcastFn('direction-fifteen-min-traffic-update', {
            rows: directionResult.rows,
            nullSlots: getNullSlotsForDate(today),
          });
        }
      } catch (directionErr) {
        console.error('[FifteenMinPoller] 방향별 쿼리 오류:', directionErr.message);
      }
    } else {
      // 데이터 없음: 타임아웃 체크
      const now        = Date.now();
      let newNullAdded = false;

      while (targetUpdateTime && now >= targetUpdateTime.getTime() + NULL_THRESHOLD * UPDATE_INTERVAL_MS) {
        const added = confirmNullSlot(targetUpdateTime, '타임아웃');
        if (added) newNullAdded = true;
        currentUpdateTime = new Date(targetUpdateTime);
        targetUpdateTime  = new Date(targetUpdateTime.getTime() + UPDATE_INTERVAL_MS);
      }

      if (newNullAdded && broadcastFn) {
        broadcastFn('fifteen-min-null-slots', { nullSlots: getNullSlotsForDate(today) });
      }

      console.log(`[FifteenMinPoller] 신규 데이터 없음 (lastSeen: ${lastSeen?.toISOString()})`);
    }
  } catch (err) {
    console.error('[FifteenMinPoller] 폴링 오류 (다음 인터벌에 재시도):', err.message);
  }
}

// ─── 시작/중지 ────────────────────────────────────────────────────────────────

function startFifteenMinPoller(broadcast) {
  broadcastFn = broadcast;
  timer = setInterval(poll, POLL_INTERVAL_MS);
  console.log(`[FifteenMinPoller] 폴링 시작 (간격: ${POLL_INTERVAL_MS / 1000}초)`);
  poll();
}

function stopFifteenMinPoller() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[FifteenMinPoller] 폴링 중지');
  }
}

module.exports = {
  startFifteenMinPoller,
  stopFifteenMinPoller,
  initFifteenMinUpdateTimes,
  getNullSlotsForDate,
  getTargetUpdateTime: () => targetUpdateTime,
};
