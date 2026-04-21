'use strict';

const { startPoller, stopPoller, initUpdateTimes } = require('../../../../services/poller');
const { startHourlyPoller, stopHourlyPoller, initHourlyUpdateTimes } = require('../../../../services/hourly-poller');
const { startDailyPoller, stopDailyPoller, initDailyUpdateTimes } = require('../../../../services/daily-poller');
const {
  startFifteenMinPoller,
  stopFifteenMinPoller,
  initFifteenMinUpdateTimes,
} = require('../../../../services/fifteen-min-poller');

function createPollerCoordinator() {
  return {
    async init() {
      await initUpdateTimes();
      await initHourlyUpdateTimes();
      await initDailyUpdateTimes();
      await initFifteenMinUpdateTimes();
    },
    start(broadcast) {
      startPoller(broadcast);
      startHourlyPoller(broadcast);
      startDailyPoller(broadcast);
      startFifteenMinPoller(broadcast);
    },
    stop() {
      stopPoller();
      stopHourlyPoller();
      stopDailyPoller();
      stopFifteenMinPoller();
    },
  };
}

module.exports = {
  createPollerCoordinator,
};

