'use strict';

require('dotenv').config();
const express = require('express');
const path = require('path');

const { logger: defaultLogger } = require('../platform/logging/logger');
const { createOracleDatabaseAdapter } = require('../shared/infrastructure/db/oracle-database-adapter');
const { createSseBroadcaster } = require('../shared/infrastructure/events/sse-broadcaster');

const homeRouter = require('../modules/home/presentation/home-router');

const { createIntersectionsRouter } = require('../modules/intersections/presentation/intersections-router');
const { createIntersectionsController } = require('../modules/intersections/presentation/intersections-controller');
const { createGetIntersectionsUseCase } = require('../modules/intersections/application/use-cases/get-intersections-use-case');
const { createSearchIntersectionsUseCase } = require('../modules/intersections/application/use-cases/search-intersections-use-case');
const { createOracleIntersectionRepository } = require('../modules/intersections/infrastructure/repositories/oracle-intersection-repository');

const { createTrafficRouter } = require('../modules/traffic/presentation/traffic-router');
const { createTrafficController } = require('../modules/traffic/presentation/traffic-controller');
const { createTrafficUseCases } = require('../modules/traffic/application/use-cases/traffic-use-cases');
const { createOracleTrafficRepository } = require('../modules/traffic/infrastructure/repositories/oracle-traffic-repository');
const { createTrafficStatusProvider } = require('../modules/traffic/infrastructure/providers/traffic-status-provider');

const { createHealthRouter } = require('../modules/health/presentation/health-router');
const { createHealthController } = require('../modules/health/presentation/health-controller');
const { createGetSystemHealthUseCase } = require('../modules/health/application/use-cases/get-system-health-use-case');
const { createOracleHealthCheckRepository } = require('../modules/health/infrastructure/repositories/oracle-health-check-repository');

function createIntersectionsModule({ database, logger }) {
  const repository = createOracleIntersectionRepository({ database });
  const getIntersectionsUseCase = createGetIntersectionsUseCase({ intersectionRepository: repository });
  const searchIntersectionsUseCase = createSearchIntersectionsUseCase({ intersectionRepository: repository });
  const controller = createIntersectionsController({
    getIntersectionsUseCase,
    searchIntersectionsUseCase,
    logger,
  });

  return createIntersectionsRouter({ intersectionsController: controller });
}

function createTrafficModule({ database, logger }) {
  const repository = createOracleTrafficRepository({ database });
  const statusProvider = createTrafficStatusProvider();
  const trafficUseCases = createTrafficUseCases({
    trafficRepository: repository,
    trafficStatusProvider: statusProvider,
  });
  const controller = createTrafficController({ trafficUseCases, logger });

  return createTrafficRouter({ trafficController: controller });
}

function createHealthModule({ database, logger }) {
  const repository = createOracleHealthCheckRepository({ database });
  const getSystemHealthUseCase = createGetSystemHealthUseCase({
    healthCheckRepository: repository,
    logger,
  });
  const controller = createHealthController({ getSystemHealthUseCase });
  return createHealthRouter({ healthController: controller });
}

function createApp(options = {}) {
  const logger = options.logger || defaultLogger;
  const database = options.database || createOracleDatabaseAdapter();
  const sseBroadcaster = createSseBroadcaster();
  const app = express();

  app.use(express.json());
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'home.html'));
  });
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));

  app.use('/api/intersections', createIntersectionsModule({ database, logger }));
  app.use('/api/traffic', createTrafficModule({ database, logger }));
  app.use('/api/home', homeRouter);
  app.use('/api/system', createHealthModule({ database, logger }));
  app.get('/api/sse', (req, res) => sseBroadcaster.handleConnect(req, res));

  app.broadcast = sseBroadcaster.broadcast;
  app.sseClients = sseBroadcaster.clients;
  app.shutdownSse = sseBroadcaster.shutdown;
  app.database = database;

  return app;
}

module.exports = {
  createApp,
};

