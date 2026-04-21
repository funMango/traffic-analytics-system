'use strict';

require('dotenv').config();
const { initPool, closePool } = require('./db');
const app = require('./app');
const { startPoller, stopPoller, initUpdateTimes } = require('./services/poller');
const { startHourlyPoller, stopHourlyPoller, initHourlyUpdateTimes } = require('./services/hourly-poller');
const { startDailyPoller, stopDailyPoller, initDailyUpdateTimes } = require('./services/daily-poller');
const { startFifteenMinPoller, stopFifteenMinPoller, initFifteenMinUpdateTimes } = require('./services/fifteen-min-poller');

const PORT = process.env.PORT || 3000;

async function main() {
  try {
    await initPool();
    await initUpdateTimes();
    startPoller(app.broadcast);
    await initHourlyUpdateTimes();
    startHourlyPoller(app.broadcast);
    await initDailyUpdateTimes();
    startDailyPoller(app.broadcast);
    await initFifteenMinUpdateTimes();
    startFifteenMinPoller(app.broadcast);

    const server = app.listen(PORT, () => {
      console.log(`[Server] http://localhost:${PORT} 에서 실행 중`);
    });

    // 정상 종료 처리
    async function shutdown(signal) {
      console.log(`\n[Server] ${signal} 수신 - 종료 중...`);
      stopPoller();
      stopHourlyPoller();
      stopDailyPoller();
      stopFifteenMinPoller();
      server.close(async () => {
        await closePool();
        process.exit(0);
      });
    }

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('[Server] 시작 실패:', err);
    process.exit(1);
  }
}

main();
