'use strict';

const { BadRequestError } = require('../../../../shared/domain/errors/http-errors');

function requireNodeId(nodeId) {
  if (!nodeId) {
    throw new BadRequestError('node_id 파라미터가 필요합니다');
  }
}

function requireAcsrId(acsrId) {
  if (!acsrId) {
    throw new BadRequestError('acsr_id parameter is required');
  }
}

function validateDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new BadRequestError('date 형식은 YYYY-MM-DD 이어야 합니다');
  }
}

function validateWeekStart(weekStart) {
  if (!weekStart) {
    throw new BadRequestError('week_start 파라미터가 필요합니다');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    throw new BadRequestError('week_start 형식은 YYYY-MM-DD 이어야 합니다');
  }
  const wsDate = new Date(`${weekStart}T00:00:00`);
  if (wsDate.getDay() !== 0) {
    throw new BadRequestError('week_start는 일요일(Sun)이어야 합니다');
  }
}

function validateMonth(month) {
  if (!month) {
    throw new BadRequestError('month 파라미터가 필요합니다');
  }
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new BadRequestError('month 형식은 YYYY-MM 이어야 합니다');
  }
}

function validateYear(year) {
  if (!year) {
    throw new BadRequestError('year 파라미터가 필요합니다');
  }
  if (!/^\d{4}$/.test(year)) {
    throw new BadRequestError('year 형식은 YYYY 이어야 합니다');
  }
}

function getTodayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = {
  requireNodeId,
  requireAcsrId,
  validateDate,
  validateWeekStart,
  validateMonth,
  validateYear,
  getTodayDateStr,
};
