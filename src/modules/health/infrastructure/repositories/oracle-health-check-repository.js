'use strict';

function createOracleHealthCheckRepository({ database }) {
  return {
    async ping() {
      await database.ping();
    },
  };
}

module.exports = {
  createOracleHealthCheckRepository,
};

