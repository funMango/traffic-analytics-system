'use strict';

const { BadRequestError, NotFoundError } = require('../../../../shared/domain/errors/http-errors');
const {
  requireNodeId,
  validateDate,
  validateWeekStart,
  validateMonth,
  validateYear,
  getTodayDateStr,
} = require('../../domain/validators/query-validators');
const { EXCLUDED_APPROACH_NAMES } = require('../../domain/constants/excluded-approach-names');

function isCurrentMonth(month) {
  return month === new Date().toISOString().slice(0, 7);
}

function getDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getRangeEndForDaily(dateStr, targetUpdateTime) {
  const today = getTodayDateStr();
  if (dateStr === today && targetUpdateTime) {
    return targetUpdateTime;
  }
  return new Date(new Date(`${dateStr}T00:00:00`).getTime() + 24 * 60 * 60 * 1000);
}

function getRangeEndForWeekly(weekStartDate, targetUpdateTime) {
  const weekEnd = new Date(weekStartDate);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  let rangeEnd = weekEnd < tomorrow ? weekEnd : tomorrow;
  if (targetUpdateTime && targetUpdateTime < rangeEnd) {
    rangeEnd = targetUpdateTime;
  }
  return rangeEnd;
}

function getRangeForMonth(month, targetUpdateTime) {
  const [yearStr, monthStr] = month.split('-');
  const y = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10);
  const rangeStart = new Date(y, m - 1, 1, 0, 0, 0, 0);
  let rangeEnd = new Date(y, m, 1, 0, 0, 0, 0);
  if (targetUpdateTime && targetUpdateTime < rangeEnd) {
    rangeEnd = targetUpdateTime;
  }
  return { rangeStart, rangeEnd };
}

function getRangeForYear(year, targetUpdateTime) {
  const y = parseInt(year, 10);
  const rangeStart = new Date(y, 0, 1, 0, 0, 0, 0);
  const yearEnd = new Date(y + 1, 0, 1, 0, 0, 0, 0);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  let rangeEnd = yearEnd < tomorrow ? yearEnd : tomorrow;
  if (targetUpdateTime && targetUpdateTime < rangeEnd) {
    rangeEnd = targetUpdateTime;
  }
  return { rangeStart, rangeEnd };
}

function buildWeeklyNullSlotsMap(weekStartDate, rangeEnd, statusProvider) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const nullSlots = {};
  const cur = new Date(weekStartDate);
  while (cur < rangeEnd) {
    const dateStr = getDateStr(cur);
    const curDay = new Date(cur);
    curDay.setHours(0, 0, 0, 0);

    if (curDay <= today) {
      const slots = statusProvider.getWeeklyNullSlots(dateStr);
      if (slots.length > 0) {
        nullSlots[dateStr] = slots;
      }
    }
    cur.setDate(cur.getDate() + 1);
  }
  return nullSlots;
}

function mapApproaches(rows) {
  return rows
    .filter(row => !EXCLUDED_APPROACH_NAMES.has(row.ACSR_NM))
    .map(row => ({ acsrId: row.ACSR_ID, name: row.ACSR_NM }));
}

function createTrafficUseCases({ trafficRepository, trafficStatusProvider }) {
  return {
    async getTraffic(query) {
      const nodeId = query.node_id;
      requireNodeId(nodeId);

      const dateStr = query.date || getTodayDateStr();
      validateDate(dateStr);

      const rangeEnd = getRangeEndForDaily(dateStr, trafficStatusProvider.getCurrent5MinTarget());
      const rows = await trafficRepository.findDailyTraffic(nodeId, dateStr, rangeEnd);
      const nullSlots = dateStr === getTodayDateStr()
        ? trafficStatusProvider.getDailyNullSlots(dateStr)
        : [];
      return { rows, nullSlots };
    },

    async getWeeklyTraffic(query) {
      const nodeId = query.node_id;
      const weekStart = query.week_start;
      requireNodeId(nodeId);
      validateWeekStart(weekStart);

      const weekStartDate = new Date(`${weekStart}T00:00:00`);
      const rangeEnd = getRangeEndForWeekly(weekStartDate, trafficStatusProvider.getCurrent15MinTarget());
      const rows = await trafficRepository.findWeeklyTraffic(nodeId, weekStartDate, rangeEnd);
      const nullSlots = buildWeeklyNullSlotsMap(weekStartDate, rangeEnd, trafficStatusProvider);
      return { rows, nullSlots };
    },

    async getLatestTraffic(query) {
      const nodeId = query.node_id;
      requireNodeId(nodeId);

      const rows = await trafficRepository.findLatestTraffic(nodeId);
      if (rows.length === 0) {
        throw new NotFoundError('데이터가 없습니다');
      }
      return rows[0];
    },

    async getMonthlyTraffic(query) {
      const nodeId = query.node_id;
      const month = query.month;
      requireNodeId(nodeId);
      validateMonth(month);

      const { rangeStart, rangeEnd } = getRangeForMonth(month, trafficStatusProvider.getCurrentHourlyTarget());
      const rows = await trafficRepository.findMonthlyTraffic(nodeId, rangeStart, rangeEnd);
      const nullSlots = isCurrentMonth(month)
        ? trafficStatusProvider.getMonthlyNullSlots(month)
        : {};
      return { rows, nullSlots };
    },

    async getYearlyTraffic(query) {
      const nodeId = query.node_id;
      const year = query.year;
      requireNodeId(nodeId);
      validateYear(year);

      const { rangeStart, rangeEnd } = getRangeForYear(year, trafficStatusProvider.getCurrentDailyTarget());
      const rows = await trafficRepository.findYearlyTraffic(nodeId, rangeStart, rangeEnd);
      const nullSlots = trafficStatusProvider.getYearlyNullSlots(year);
      return { rows, nullSlots };
    },

    async getApproachTraffic(query) {
      const nodeId = query.node_id;
      requireNodeId(nodeId);

      const dateStr = query.date || getTodayDateStr();
      validateDate(dateStr);

      const rangeEnd = getRangeEndForDaily(dateStr, trafficStatusProvider.getCurrent5MinTarget());
      const [approachesRows, rows] = await Promise.all([
        trafficRepository.findApproaches(nodeId),
        trafficRepository.findApproachDailyTraffic(nodeId, dateStr, rangeEnd),
      ]);

      const approaches = mapApproaches(approachesRows);
      const nullSlots = dateStr === getTodayDateStr()
        ? trafficStatusProvider.getDailyNullSlots(dateStr)
        : [];

      return { approaches, rows, nullSlots };
    },

    async getApproachWeeklyTraffic(query) {
      const nodeId = query.node_id;
      const weekStart = query.week_start;
      requireNodeId(nodeId);
      validateWeekStart(weekStart);

      const weekStartDate = new Date(`${weekStart}T00:00:00`);
      const rangeEnd = getRangeEndForWeekly(weekStartDate, trafficStatusProvider.getCurrent15MinTarget());

      const [approachesRows, rows] = await Promise.all([
        trafficRepository.findApproaches(nodeId),
        trafficRepository.findApproachWeeklyTraffic(nodeId, weekStartDate, rangeEnd),
      ]);

      return {
        approaches: mapApproaches(approachesRows),
        rows,
        nullSlots: buildWeeklyNullSlotsMap(weekStartDate, rangeEnd, trafficStatusProvider),
      };
    },

    async getApproachMonthlyTraffic(query) {
      const nodeId = query.node_id;
      const month = query.month;
      requireNodeId(nodeId);
      validateMonth(month);

      const { rangeStart, rangeEnd } = getRangeForMonth(month, trafficStatusProvider.getCurrentHourlyTarget());
      const [approachesRows, rows] = await Promise.all([
        trafficRepository.findApproaches(nodeId),
        trafficRepository.findApproachMonthlyTraffic(nodeId, rangeStart, rangeEnd),
      ]);

      return {
        approaches: mapApproaches(approachesRows),
        rows,
        nullSlots: isCurrentMonth(month)
          ? trafficStatusProvider.getMonthlyNullSlots(month)
          : {},
      };
    },

    async getApproachYearlyTraffic(query) {
      const nodeId = query.node_id;
      const year = query.year;
      requireNodeId(nodeId);
      validateYear(year);

      const { rangeStart, rangeEnd } = getRangeForYear(year, trafficStatusProvider.getCurrentDailyTarget());
      const [approachesRows, rows] = await Promise.all([
        trafficRepository.findApproaches(nodeId),
        trafficRepository.findApproachYearlyTraffic(nodeId, rangeStart, rangeEnd),
      ]);

      return {
        approaches: mapApproaches(approachesRows),
        rows,
        nullSlots: trafficStatusProvider.getYearlyNullSlots(year),
      };
    },
  };
}

module.exports = {
  createTrafficUseCases,
};

