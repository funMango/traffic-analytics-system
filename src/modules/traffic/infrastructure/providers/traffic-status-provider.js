'use strict';

const {
  getNullSlotsForDate: get5MinNullSlotsForDate,
  getTargetUpdateTime: get5MinTargetUpdateTime,
} = require('../../../../../services/poller');
const {
  getNullSlotsForDate: get15MinNullSlotsForDate,
  getNullSlotsForMonth,
  getTargetUpdateTime: getHourlyTargetUpdateTime,
} = require('../../../../../services/hourly-poller');
const {
  getTargetUpdateTime: get15MinTargetUpdateTime,
} = require('../../../../../services/fifteen-min-poller');
const {
  getTargetUpdateTime: getDailyTargetUpdateTime,
} = require('../../../../../services/daily-poller');

function createTrafficStatusProvider() {
  return {
    getCurrent5MinTarget() {
      return get5MinTargetUpdateTime();
    },
    getCurrent15MinTarget() {
      return get15MinTargetUpdateTime();
    },
    getCurrentHourlyTarget() {
      return getHourlyTargetUpdateTime();
    },
    getCurrentDailyTarget() {
      return getDailyTargetUpdateTime();
    },
    getDailyNullSlots(dateStr) {
      return get5MinNullSlotsForDate(dateStr);
    },
    getWeeklyNullSlots(dateStr) {
      return get15MinNullSlotsForDate(dateStr);
    },
    getMonthlyNullSlots(month) {
      return getNullSlotsForMonth(month);
    },
    getYearlyNullSlots(year) {
      const currentYear = String(new Date().getFullYear());
      if (year !== currentYear) return [];

      const curMonth = new Date().getMonth() + 1;
      let nullSlots = [];
      for (let m = 1; m <= curMonth; m++) {
        const monthStr = `${year}-${String(m).padStart(2, '0')}`;
        nullSlots = nullSlots.concat(getNullSlotsForMonth(monthStr));
      }
      return nullSlots;
    },
  };
}

module.exports = {
  createTrafficStatusProvider,
};

