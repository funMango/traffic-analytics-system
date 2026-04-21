'use strict';

const { Router } = require('express');
const { execute } = require('../db');
const { getNullSlotsForDate, getTargetUpdateTime } = require('../services/poller');
const {
  getNullSlotsForDate: getHourlyNullSlots,
  getNullSlotsForMonth,
  getTargetUpdateTime: getHourlyTarget,
} = require('../services/hourly-poller');
const {
  getNullSlotsForDate: getFifteenMinNullSlots,
  getTargetUpdateTime: getFifteenMinTarget,
} = require('../services/fifteen-min-poller');
const { getTargetUpdateTime: getDailyTarget } = require('../services/daily-poller');

const router = Router();

// ── 존재하지 않는 접근로 제외 목록 ─────────────────────────────────────────
const EXCLUDED_ACSR_NMS = new Set([
  '남부천신협앞-동(서향)',
  '남부천신협앞-서(동향)',
  '역곡남부역3R-북 (남향)',
  '부천여중4R-북(남향)',
]);

// GET /api/traffic?node_id=&date=YYYY-MM-DD - 하루 교통량 (최대 288건)
router.get('/', async (req, res) => {
  const { node_id, date } = req.query;

  if (!node_id) {
    return res.status(400).json({ error: 'node_id 파라미터가 필요합니다' });
  }

  // date 미입력 시 오늘
  const dateStr = date || new Date().toISOString().slice(0, 10);

  // YYYY-MM-DD 형식 검증
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return res.status(400).json({ error: 'date 형식은 YYYY-MM-DD 이어야 합니다' });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const targetDt = getTargetUpdateTime();
    const rangeEnd = (dateStr === today && targetDt)
      ? targetDt
      : new Date(new Date(dateStr + 'T00:00:00').getTime() + 24 * 60 * 60 * 1000);
    const result = await execute(
      `SELECT TOT_DT, TRF_QNTY, AVG_SPD, OCPN_RATE, CLBR_TRF_QNTY, PDST_QNTY, LOS
         FROM S_CRSRD_TRF_5MI
        WHERE NODE_ID = :nodeId
          AND TOT_DT >= TO_DATE(:dateStr, 'YYYY-MM-DD')
          AND TOT_DT <  :rangeEnd
          AND TRF_QNTY > 0
        ORDER BY TOT_DT`,
      { nodeId: node_id, dateStr, rangeEnd }
    );
    const nullSlots = dateStr === today ? getNullSlotsForDate(dateStr) : [];
    res.json({ rows: result.rows, nullSlots });
  } catch (err) {
    console.error('[traffic] 교통량 조회 오류:', err);
    res.status(500).json({ error: '교통량 데이터 조회 실패' });
  }
});

// GET /api/traffic/weekly?node_id=&week_start=YYYY-MM-DD - 주간 교통량 (최대 168건)
router.get('/weekly', async (req, res) => {
  const { node_id, week_start } = req.query;

  if (!node_id) {
    return res.status(400).json({ error: 'node_id 파라미터가 필요합니다' });
  }

  if (!week_start) {
    return res.status(400).json({ error: 'week_start 파라미터가 필요합니다' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(week_start)) {
    return res.status(400).json({ error: 'week_start 형식은 YYYY-MM-DD 이어야 합니다' });
  }

  // 로컬 타임존으로 파싱하여 요일 검증
  const wsDate = new Date(week_start + 'T00:00:00');
  if (wsDate.getDay() !== 0) {
    return res.status(400).json({ error: 'week_start는 일요일(Sun)이어야 합니다' });
  }

  try {
    const rangeStart = wsDate;

    // week_start + 7일
    const weekEnd = new Date(wsDate);
    weekEnd.setDate(weekEnd.getDate() + 7);

    // 내일 자정
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const fifteenMinTarget = getFifteenMinTarget();
    const rangeEnd = (() => {
      let end = weekEnd < tomorrow ? weekEnd : tomorrow;
      if (fifteenMinTarget && fifteenMinTarget < end) end = fifteenMinTarget;
      return end;
    })();

    const result = await execute(
      `SELECT TOT_DT, TRF_QNTY, AVG_SPD, OCPN_RATE, CLBR_TRF_QNTY, PDST_QNTY, LOS
         FROM S_CRSRD_TRF_15MI
        WHERE NODE_ID = :nodeId
          AND TOT_DT >= :rangeStart
          AND TOT_DT <  :rangeEnd
        ORDER BY TOT_DT`,
      { nodeId: node_id, rangeStart, rangeEnd }
    );

    // 오늘 이하 날짜만 hourly-poller에서 null slots 조회
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const nullSlots = {};
    const cur = new Date(wsDate);
    while (cur < rangeEnd) {
      const y  = cur.getFullYear();
      const mm = String(cur.getMonth() + 1).padStart(2, '0');
      const dd = String(cur.getDate()).padStart(2, '0');
      const dateStr = `${y}-${mm}-${dd}`;

      const curDay = new Date(cur);
      curDay.setHours(0, 0, 0, 0);
      if (curDay <= today) {
        const slots = getFifteenMinNullSlots(dateStr);
        if (slots.length > 0) nullSlots[dateStr] = slots;
      }
      cur.setDate(cur.getDate() + 1);
    }

    res.json({ rows: result.rows, nullSlots });
  } catch (err) {
    console.error('[traffic] 주간 교통량 조회 오류:', err);
    res.status(500).json({ error: '주간 교통량 데이터 조회 실패' });
  }
});

// GET /api/traffic/latest?node_id= - 최신 1건
router.get('/latest', async (req, res) => {
  const { node_id } = req.query;

  if (!node_id) {
    return res.status(400).json({ error: 'node_id 파라미터가 필요합니다' });
  }

  try {
    const result = await execute(
      `SELECT TOT_DT, TRF_QNTY, AVG_SPD, OCPN_RATE, CLBR_TRF_QNTY, PDST_QNTY, LOS
         FROM S_CRSRD_TRF_5MI
        WHERE NODE_ID = :nodeId
          AND ROWNUM = 1
        ORDER BY TOT_DT DESC`,
      { nodeId: node_id }
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '데이터 없음' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[traffic] 최신 데이터 조회 오류:', err);
    res.status(500).json({ error: '최신 데이터 조회 실패' });
  }
});

// GET /api/traffic/monthly?node_id=&month=YYYY-MM - 월간 교통량
router.get('/monthly', async (req, res) => {
  const { node_id, month } = req.query;

  if (!node_id) {
    return res.status(400).json({ error: 'node_id 파라미터가 필요합니다' });
  }

  if (!month) {
    return res.status(400).json({ error: 'month 파라미터가 필요합니다' });
  }

  // month 형식 검증: YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month 형식은 YYYY-MM 이어야 합니다' });
  }

  try {
    const [yearStr, monthStr] = month.split('-');
    const y = parseInt(yearStr, 10);
    const m = parseInt(monthStr, 10);

    // 해당 월 1일 00:00
    const rangeStart = new Date(y, m - 1, 1, 0, 0, 0, 0);

    // 다음 월 1일 00:00
    const rangeEnd = new Date(y, m, 1, 0, 0, 0, 0);

    const hourlyTarget = getHourlyTarget();
    const finalRangeEnd = (() => {
      let end = rangeEnd;
      if (hourlyTarget && hourlyTarget < end) end = hourlyTarget;
      return end;
    })();

    const result = await execute(
      `SELECT TOT_DT, TRF_QNTY, AVG_SPD, OCPN_RATE, CLBR_TRF_QNTY, PDST_QNTY, LOS
         FROM S_CRSRD_TRF_1HH
        WHERE NODE_ID = :nodeId
          AND TOT_DT >= :rangeStart
          AND TOT_DT <  :finalRangeEnd
        ORDER BY TOT_DT`,
      { nodeId: node_id, rangeStart, finalRangeEnd }
    );

    // 현재 월인 경우 null slots 조회 (시간단위: { 'YYYY-MM-DD': ['HH:00', ...] })
    const currentMonth = new Date().toISOString().slice(0, 7);
    const nullSlots = month === currentMonth ? getNullSlotsForMonth(month) : {};

    res.json({ rows: result.rows, nullSlots });
  } catch (err) {
    console.error('[traffic] 월간 교통량 조회 오류:', err);
    res.status(500).json({ error: '월간 교통량 데이터 조회 실패' });
  }
});

// GET /api/traffic/yearly?node_id=&year=YYYY - 연간 교통량
router.get('/yearly', async (req, res) => {
  const { node_id, year } = req.query;

  if (!node_id) return res.status(400).json({ error: 'node_id 파라미터가 필요합니다' });
  if (!year)    return res.status(400).json({ error: 'year 파라미터가 필요합니다' });
  if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'year 형식은 YYYY 이어야 합니다' });

  try {
    const y = parseInt(year, 10);
    const rangeStart   = new Date(y,     0, 1, 0, 0, 0, 0);
    const rangeEnd     = new Date(y + 1, 0, 1, 0, 0, 0, 0);
    const tomorrow     = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const dailyTarget = getDailyTarget();
    const finalRangeEnd = (() => {
      let end = rangeEnd < tomorrow ? rangeEnd : tomorrow;
      if (dailyTarget && dailyTarget < end) end = dailyTarget;
      return end;
    })();

    const result = await execute(
      `SELECT TOT_DT, TRF_QNTY, AVG_SPD, OCPN_RATE, CLBR_TRF_QNTY, PDST_QNTY, LOS
         FROM S_CRSRD_TRF_1DD
        WHERE NODE_ID = :nodeId
          AND TOT_DT >= :rangeStart
          AND TOT_DT <  :finalRangeEnd
        ORDER BY TOT_DT`,
      { nodeId: node_id, rangeStart, finalRangeEnd }
    );

    // 현재 연도면 각 월 null slots 수집
    const currentYear = String(new Date().getFullYear());
    let nullSlots = [];
    if (year === currentYear) {
      const curMonth = new Date().getMonth() + 1; // 1-indexed
      for (let m = 1; m <= curMonth; m++) {
        const monthStr = `${year}-${String(m).padStart(2, '0')}`;
        nullSlots = nullSlots.concat(getNullSlotsForMonth(monthStr));
      }
    }

    res.json({ rows: result.rows, nullSlots });
  } catch (err) {
    console.error('[traffic] 연간 교통량 조회 오류:', err);
    res.status(500).json({ error: '연간 교통량 데이터 조회 실패' });
  }
});

// GET /api/traffic/approach?node_id=&date=YYYY-MM-DD - 접근로별 5분 교통량
router.get('/approach', async (req, res) => {
  const { node_id, date } = req.query;

  if (!node_id) {
    return res.status(400).json({ error: 'node_id 파라미터가 필요합니다' });
  }

  const dateStr = date || new Date().toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return res.status(400).json({ error: 'date 형식은 YYYY-MM-DD 이어야 합니다' });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const targetDt = getTargetUpdateTime();
    const rangeEnd = (dateStr === today && targetDt)
      ? targetDt
      : new Date(new Date(dateStr + 'T00:00:00').getTime() + 24 * 60 * 60 * 1000);
    const [approachResult, rowsResult] = await Promise.all([
      execute(
        `SELECT a.ACSR_ID, a.ACSR_NM, i.CRSRD_NM
           FROM M_CRSRD_ACSR_INF a
           JOIN M_CRSRD_INF i ON i.NODE_ID = a.NODE_ID
          WHERE a.NODE_ID = :nodeId
          ORDER BY a.ACSR_ID`,
        { nodeId: node_id }
      ),
      execute(
        `SELECT ACSR_ID, TOT_DT, TRF_QNTY
           FROM S_CRSRD_ACSR_TRF_5MI
          WHERE NODE_ID = :nodeId
            AND TOT_DT >= TO_DATE(:dateStr, 'YYYY-MM-DD')
            AND TOT_DT <  :rangeEnd
            AND TRF_QNTY > 0
          ORDER BY TOT_DT`,
        { nodeId: node_id, dateStr, rangeEnd }
      ),
    ]);

    const approaches = approachResult.rows
      .filter(r => !EXCLUDED_ACSR_NMS.has(r.ACSR_NM))
      .map(r => ({ acsrId: r.ACSR_ID, name: r.ACSR_NM }));

    const nullSlots = dateStr === today ? getNullSlotsForDate(dateStr) : [];

    res.json({ approaches, rows: rowsResult.rows, nullSlots });
  } catch (err) {
    console.error('[traffic] 접근로 교통량 조회 오류:', err);
    res.status(500).json({ error: '접근로 교통량 데이터 조회 실패' });
  }
});

// GET /api/traffic/approach/weekly?node_id=&week_start=YYYY-MM-DD - 접근로별 15분 교통량 (주간)
router.get('/approach/weekly', async (req, res) => {
  const { node_id, week_start } = req.query;

  if (!node_id) return res.status(400).json({ error: 'node_id 파라미터가 필요합니다' });
  if (!week_start) return res.status(400).json({ error: 'week_start 파라미터가 필요합니다' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week_start)) return res.status(400).json({ error: 'week_start 형식은 YYYY-MM-DD 이어야 합니다' });

  const wsDate = new Date(week_start + 'T00:00:00');
  if (wsDate.getDay() !== 0) return res.status(400).json({ error: 'week_start는 일요일(Sun)이어야 합니다' });

  try {
    const weekEnd = new Date(wsDate);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const fifteenMinTarget = getFifteenMinTarget();
    const rangeEnd = (() => {
      let end = weekEnd < tomorrow ? weekEnd : tomorrow;
      if (fifteenMinTarget && fifteenMinTarget < end) end = fifteenMinTarget;
      return end;
    })();

    const [approachResult, rowsResult] = await Promise.all([
      execute(
        `SELECT a.ACSR_ID, a.ACSR_NM, i.CRSRD_NM FROM M_CRSRD_ACSR_INF a JOIN M_CRSRD_INF i ON i.NODE_ID = a.NODE_ID WHERE a.NODE_ID = :nodeId ORDER BY a.ACSR_ID`,
        { nodeId: node_id }
      ),
      execute(
        `SELECT ACSR_ID, TOT_DT, TRF_QNTY
           FROM S_CRSRD_ACSR_TRF_15MI
          WHERE NODE_ID = :nodeId
            AND TOT_DT >= :rangeStart
            AND TOT_DT <  :rangeEnd
          ORDER BY TOT_DT`,
        { nodeId: node_id, rangeStart: wsDate, rangeEnd }
      ),
    ]);

    const approaches = approachResult.rows
      .filter(r => !EXCLUDED_ACSR_NMS.has(r.ACSR_NM))
      .map(r => ({ acsrId: r.ACSR_ID, name: r.ACSR_NM }));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nullSlots = {};
    const cur = new Date(wsDate);
    while (cur < rangeEnd) {
      const y  = cur.getFullYear();
      const mm = String(cur.getMonth() + 1).padStart(2, '0');
      const dd = String(cur.getDate()).padStart(2, '0');
      const dateStr = `${y}-${mm}-${dd}`;
      const curDay = new Date(cur);
      curDay.setHours(0, 0, 0, 0);
      if (curDay <= today) {
        const slots = getFifteenMinNullSlots(dateStr);
        if (slots.length > 0) nullSlots[dateStr] = slots;
      }
      cur.setDate(cur.getDate() + 1);
    }

    res.json({ approaches, rows: rowsResult.rows, nullSlots });
  } catch (err) {
    console.error('[traffic] 접근로 주간 교통량 조회 오류:', err);
    res.status(500).json({ error: '접근로 주간 교통량 데이터 조회 실패' });
  }
});

// GET /api/traffic/approach/monthly?node_id=&month=YYYY-MM - 접근로별 1시간 교통량 (월간)
router.get('/approach/monthly', async (req, res) => {
  const { node_id, month } = req.query;

  if (!node_id) return res.status(400).json({ error: 'node_id 파라미터가 필요합니다' });
  if (!month) return res.status(400).json({ error: 'month 파라미터가 필요합니다' });
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month 형식은 YYYY-MM 이어야 합니다' });

  try {
    const [yearStr, monthStr] = month.split('-');
    const y = parseInt(yearStr, 10);
    const m = parseInt(monthStr, 10);

    const rangeStart = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const rangeEnd   = new Date(y, m, 1, 0, 0, 0, 0);
    const hourlyTarget = getHourlyTarget();
    const finalRangeEnd = (() => {
      let end = rangeEnd;
      if (hourlyTarget && hourlyTarget < end) end = hourlyTarget;
      return end;
    })();

    const [approachResult, rowsResult] = await Promise.all([
      execute(
        `SELECT a.ACSR_ID, a.ACSR_NM, i.CRSRD_NM FROM M_CRSRD_ACSR_INF a JOIN M_CRSRD_INF i ON i.NODE_ID = a.NODE_ID WHERE a.NODE_ID = :nodeId ORDER BY a.ACSR_ID`,
        { nodeId: node_id }
      ),
      execute(
        `SELECT ACSR_ID, TOT_DT, TRF_QNTY
           FROM S_CRSRD_ACSR_TRF_1HH
          WHERE NODE_ID = :nodeId
            AND TOT_DT >= :rangeStart
            AND TOT_DT <  :finalRangeEnd
          ORDER BY TOT_DT`,
        { nodeId: node_id, rangeStart, finalRangeEnd }
      ),
    ]);

    const approaches = approachResult.rows
      .filter(r => !EXCLUDED_ACSR_NMS.has(r.ACSR_NM))
      .map(r => ({ acsrId: r.ACSR_ID, name: r.ACSR_NM }));
    const currentMonth = new Date().toISOString().slice(0, 7);
    const nullSlots = month === currentMonth ? getNullSlotsForMonth(month) : {};

    res.json({ approaches, rows: rowsResult.rows, nullSlots });
  } catch (err) {
    console.error('[traffic] 접근로 월간 교통량 조회 오류:', err);
    res.status(500).json({ error: '접근로 월간 교통량 데이터 조회 실패' });
  }
});

// GET /api/traffic/approach/yearly?node_id=&year=YYYY - 접근로별 1일 교통량 (연간)
router.get('/approach/yearly', async (req, res) => {
  const { node_id, year } = req.query;

  if (!node_id) return res.status(400).json({ error: 'node_id 파라미터가 필요합니다' });
  if (!year)    return res.status(400).json({ error: 'year 파라미터가 필요합니다' });
  if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'year 형식은 YYYY 이어야 합니다' });

  try {
    const y = parseInt(year, 10);
    const rangeStart    = new Date(y,     0, 1, 0, 0, 0, 0);
    const rangeEnd      = new Date(y + 1, 0, 1, 0, 0, 0, 0);
    const tomorrow      = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const dailyTarget = getDailyTarget();
    const finalRangeEnd = (() => {
      let end = rangeEnd < tomorrow ? rangeEnd : tomorrow;
      if (dailyTarget && dailyTarget < end) end = dailyTarget;
      return end;
    })();

    const [approachResult, rowsResult] = await Promise.all([
      execute(
        `SELECT a.ACSR_ID, a.ACSR_NM, i.CRSRD_NM FROM M_CRSRD_ACSR_INF a JOIN M_CRSRD_INF i ON i.NODE_ID = a.NODE_ID WHERE a.NODE_ID = :nodeId ORDER BY a.ACSR_ID`,
        { nodeId: node_id }
      ),
      execute(
        `SELECT ACSR_ID, TOT_DT, TRF_QNTY
           FROM S_CRSRD_ACSR_TRF_1DD
          WHERE NODE_ID = :nodeId
            AND TOT_DT >= :rangeStart
            AND TOT_DT <  :finalRangeEnd
          ORDER BY TOT_DT`,
        { nodeId: node_id, rangeStart, finalRangeEnd }
      ),
    ]);

    const approaches = approachResult.rows
      .filter(r => !EXCLUDED_ACSR_NMS.has(r.ACSR_NM))
      .map(r => ({ acsrId: r.ACSR_ID, name: r.ACSR_NM }));

    const currentYear = String(new Date().getFullYear());
    let nullSlots = [];
    if (year === currentYear) {
      const curMonth = new Date().getMonth() + 1;
      for (let mo = 1; mo <= curMonth; mo++) {
        const monthStr = `${year}-${String(mo).padStart(2, '0')}`;
        nullSlots = nullSlots.concat(getNullSlotsForMonth(monthStr));
      }
    }

    res.json({ approaches, rows: rowsResult.rows, nullSlots });
  } catch (err) {
    console.error('[traffic] 접근로 연간 교통량 조회 오류:', err);
    res.status(500).json({ error: '접근로 연간 교통량 데이터 조회 실패' });
  }
});

module.exports = router;
