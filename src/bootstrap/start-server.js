'use strict';

require('dotenv').config();

const { createApp } = require('./create-app');
const { getConfig } = require('../platform/env/config');
const { logger } = require('../platform/logging/logger');
const { createOracleDatabaseAdapter } = require('../shared/infrastructure/db/oracle-database-adapter');
const { createPollerCoordinator } = require('../shared/infrastructure/polling/poller-coordinator');

async function startServer() {
  const { port } = getConfig();
  const database = createOracleDatabaseAdapter();
  const pollerCoordinator = createPollerCoordinator();
  const app = createApp({ database, logger });

  try {
    await database.init();
    await pollerCoordinator.init();
    pollerCoordinator.start(app.broadcast);

    const server = app.listen(port, () => {
      logger.info(`[Server] http://localhost:${port} 에서 실행 중`);
    });

    async function shutdown(signal) {
      logger.info(`\n[Server] ${signal} 수신 - 종료 중...`);
      pollerCoordinator.stop();
      app.shutdownSse();
      server.close(async () => {
        await database.close();
        process.exit(0);
      });
    }

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    return { app, server };
  } catch (err) {
    logger.error('[Server] 시작 실패:', err);
    process.exit(1);
  }
}

module.exports = {
  startServer,
};

