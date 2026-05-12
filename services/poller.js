'use strict';

const { execute } = require('../db');

const POLL_INTERVAL_MS   = parseInt(process.env.POLL_INTERVAL_MS || '60000', 10);
const UPDATE_INTERVAL_MS = 5 * 60 * 1000;  // 5분 슬롯
const NULL_THRESHOLD     = 2;              // 2×interval = 10분 초과 시 NULL 확정

let lastSeen         = null;  // 마지막으로 받은 TOT_DT (Date)
let currentUpdateTime = null; // 현재 확정된 업데이트 시각 (Date)
let targetUpdateTime  = null; // 다음 예상 업데이트 시각 (Date)
const nullSlots       = new Map(); // Map<'YYYY-MM-DD', Set<'HH:MM'>>
let timer       = null;
let broadcastFn = null;

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function roundDownTo5Min(date) {
  const d = new Date(date);
  d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
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
    console.log(`[Poller] NULL 슬롯 확정: ${dateStr} ${hhmm} (${reason})`);
    return true;
  }
  return false;
}

// 특정 날짜의 NULL 슬롯 배열 반환 (routes/traffic.js에서 사용)
function getNullSlotsForDate(dateStr) {
  return Array.from(nullSlots.get(dateStr) || []);
}

// ─── 초기화 ──────────────────────────────────────────────────────────────────

async function initUpdateTimes() {
  try {
    const result = await execute(
      `SELECT MAX(TOT_DT) AS LATEST FROM S_CRSRD_TRF_5MI`,
      {}
    );
    const latest = result.rows[0]?.LATEST;
    if (latest) {
      lastSeen          = new Date(latest);
      currentUpdateTime = roundDownTo5Min(lastSeen);
    } else {
      currentUpdateTime = roundDownTo5Min(new Date());
      lastSeen          = new Date(currentUpdateTime.getTime() - 1);
    }
    targetUpdateTime = new Date(currentUpdateTime.getTime() + UPDATE_INTERVAL_MS);
    console.log(`[Poller] 초기화: currentUpdateTime=${dateToHHMM(currentUpdateTime)}, target=${dateToHHMM(targetUpdateTime)}`);
  } catch (err) {
    console.error('[Poller] 초기화 오류:', err.message);
    currentUpdateTime = roundDownTo5Min(new Date());
    lastSeen          = new Date(currentUpdateTime.getTime() - 1);
    targetUpdateTime  = new Date(currentUpdateTime.getTime() + UPDATE_INTERVAL_MS);
  }
}

// ─── 폴링 ────────────────────────────────────────────────────────────────────

async function poll() {
  try {
    const result = await execute(
      `SELECT NODE_ID, TOT_DT, TRF_QNTY, AVG_SPD, OCPN_RATE, LOS
         FROM S_CRSRD_TRF_5MI
        WHERE TOT_DT > :lastSeen
        ORDER BY TOT_DT ASC`,
      { lastSeen }
    );

    const today = dateToStr(new Date());

    if (result.rows.length > 0) {
      const latestRow     = result.rows[result.rows.length - 1];
      const latestRounded = roundDownTo5Min(new Date(latestRow.TOT_DT));

      // target 슬롯 데이터가 전부 0인지 확인
      const targetSlotKey   = dateToHHMM(targetUpdateTime);
      const targetSlotRows  = result.rows.filter(r =>
        dateToHHMM(roundDownTo5Min(new Date(r.TOT_DT))) === targetSlotKey
      );
      const targetSlotAllZero = targetSlotRows.length > 0 &&
        targetSlotRows.every(r => r.TRF_QNTY == null || r.TRF_QNTY === 0);

      if (targetSlotAllZero && latestRounded.getTime() <= targetUpdateTime.getTime()) {
        const nodeIds = [...new Set(targetSlotRows.map(r => r.NODE_ID))].join(', ');
        const now = Date.now();
        if (now >= targetUpdateTime.getTime() + NULL_THRESHOLD * UPDATE_INTERVAL_MS) {
          // 타임아웃 초과: NULL 확정 후 전진
          const added = confirmNullSlot(targetUpdateTime, '타임아웃 (0값만 수신)');
          currentUpdateTime = new Date(targetUpdateTime);
          targetUpdateTime  = new Date(targetUpdateTime.getTime() + UPDATE_INTERVAL_MS);
          if (added && broadcastFn) {
            broadcastFn('null-slots', { nullSlots: getNullSlotsForDate(today) });
          }
          console.log(`[Poller] ${targetSlotKey} 0값 타임아웃 → NULL 확정 (NODE_ID: ${nodeIds})`);
        } else {
          // 타임아웃 미초과: lastSeen 유지, 다음 poll에서 재시도
          console.log(`[Poller] ${targetSlotKey} 전부 0 → 업데이트 스킵, lastSeen 유지 (NODE_ID: ${nodeIds})`);
        }
        return;
      }

      // 수신된 슬롯 집합 (5분 단위 HH:MM) — non-zero 데이터 기준
      const receivedSlots = new Set(
        result.rows
          .filter(r => r.TRF_QNTY != null && r.TRF_QNTY > 0)
          .map(r => dateToHHMM(roundDownTo5Min(new Date(r.TOT_DT))))
      );

      // target ~ latestRounded 사이 빈 슬롯(non-zero 없음) → NULL 확정 (갭 채움)
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

      console.log(`[Poller] 신규 데이터 ${result.rows.length}건 감지 → SSE 브로드캐스트`);

      if (broadcastFn) {
        broadcastFn('traffic-update', {
          rows:      result.rows.filter(r => r.TRF_QNTY != null && r.TRF_QNTY > 0),
          nullSlots: getNullSlotsForDate(today),
        });
      }

      // 접근로별 5분 교통량 브로드캐스트
      try {
        const approachResult = await execute(
          `SELECT NODE_ID, ACSR_ID, TOT_DT, TRF_QNTY
             FROM S_CRSRD_ACSR_TRF_5MI
            WHERE TOT_DT > :prevLastSeen
              AND TOT_DT <= :lastSeen
            ORDER BY TOT_DT ASC`,
          { prevLastSeen, lastSeen }
        );
        const nonZeroApproachRows = approachResult.rows.filter(r => r.TRF_QNTY != null && r.TRF_QNTY > 0);
        if (nonZeroApproachRows.length > 0 && broadcastFn) {
          broadcastFn('approach-traffic-update', {
            rows: nonZeroApproachRows,
            nullSlots: getNullSlotsForDate(today),
          });
        }
      } catch (approachErr) {
        console.error('[Poller] 접근로 쿼리 오류:', approachErr.message);
      }

      try {
        const directionResult = await execute(
          `SELECT NODE_ID, ACSR_ID, DRCT_CD, TOT_DT, TRF_QNTY,
                  TO_CHAR(TOT_DT, 'HH24:MI') AS SLOT_LABEL
             FROM S_CRSRD_DRCT_TRF_5MI
            WHERE TOT_DT > :prevLastSeen
              AND TOT_DT <= :lastSeen
              AND DRCT_CD IN ('01', '02', '03')
            ORDER BY TOT_DT ASC, DRCT_CD ASC`,
          { prevLastSeen, lastSeen }
        );
        const directionRows = directionResult.rows.filter(r => r.TRF_QNTY != null && r.TRF_QNTY > 0);
        if (directionRows.length > 0 && broadcastFn) {
          broadcastFn('direction-traffic-update', {
            rows: directionRows,
            nullSlots: getNullSlotsForDate(today),
          });
        }
      } catch (directionErr) {
        console.error('[Poller] 방향별 쿼리 오류:', directionErr.message);
      }
    } else {
      // 데이터 없음: 타임아웃 체크
      const now         = Date.now();
      let newNullAdded  = false;

      while (targetUpdateTime && now >= targetUpdateTime.getTime() + NULL_THRESHOLD * UPDATE_INTERVAL_MS) {
        const added = confirmNullSlot(targetUpdateTime, '타임아웃');
        if (added) newNullAdded = true;
        currentUpdateTime = new Date(targetUpdateTime);
        targetUpdateTime  = new Date(targetUpdateTime.getTime() + UPDATE_INTERVAL_MS);
      }

      if (newNullAdded && broadcastFn) {
        broadcastFn('null-slots', { nullSlots: getNullSlotsForDate(today) });
      }

      console.log(`[Poller] 신규 데이터 없음 (lastSeen: ${lastSeen?.toISOString()})`);
    }
  } catch (err) {
    console.error('[Poller] 폴링 오류 (다음 인터벌에 재시도):', err.message);
  }
}

// ─── 시작/중지 ────────────────────────────────────────────────────────────────

function startPoller(broadcast) {
  broadcastFn = broadcast;
  timer = setInterval(poll, POLL_INTERVAL_MS);
  console.log(`[Poller] 폴링 시작 (간격: ${POLL_INTERVAL_MS / 1000}초)`);
  poll();
}

function stopPoller() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[Poller] 폴링 중지');
  }
}

module.exports = { startPoller, stopPoller, initUpdateTimes, getNullSlotsForDate, getTargetUpdateTime: () => targetUpdateTime };
