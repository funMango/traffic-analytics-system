'use strict';

function createGetSystemHealthUseCase({ healthCheckRepository, logger }) {
  return async function getSystemHealth() {
    const checkedAt = new Date().toISOString();

    try {
      await healthCheckRepository.ping();
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: 'healthy',
          db: 'connected',
          checkedAt,
        },
      };
    } catch (err) {
      const code = err && typeof err === 'object' ? err.code || null : null;
      const message =
        err && typeof err === 'object' && typeof err.message === 'string'
          ? err.message
          : String(err);

      logger.error('[system/health] DB check failed', { code, message });

      return {
        statusCode: 503,
        body: {
          ok: false,
          status: 'degraded',
          db: 'disconnected',
          checkedAt,
          error: 'DB_UNAVAILABLE',
        },
      };
    }
  };
}

module.exports = {
  createGetSystemHealthUseCase,
};

