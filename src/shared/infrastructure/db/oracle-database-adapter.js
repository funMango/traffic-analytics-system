'use strict';

const { initPool, closePool, execute } = require('../../../../db');

function createOracleDatabaseAdapter() {
  return {
    async init() {
      await initPool();
    },
    async close() {
      await closePool();
    },
    async execute(sql, binds = [], opts = {}) {
      return execute(sql, binds, opts);
    },
    async ping() {
      await execute('SELECT 1 FROM DUAL');
    },
  };
}

module.exports = {
  createOracleDatabaseAdapter,
};

