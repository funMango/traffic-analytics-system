'use strict';

require('dotenv').config();
const oracledb = require('oracledb');

// Thin 모드 사용 (Oracle Client 불필요)
oracledb.initOracleClient = undefined; // Thin 모드 기본값

let pool = null;

async function initPool() {
  if (pool) return pool;

  pool = await oracledb.createPool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: `${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_SERVICE}`,
    poolMin: 2,
    poolMax: 10,
    poolIncrement: 1,
    poolTimeout: 60,
  });

  console.log('[DB] Oracle 커넥션 풀 생성 완료');
  return pool;
}

async function execute(sql, binds = [], opts = {}) {
  const conn = await pool.getConnection();
  try {
    const result = await conn.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      ...opts,
    });
    return result;
  } finally {
    await conn.close();
  }
}

async function closePool() {
  if (pool) {
    await pool.close(0);
    pool = null;
    console.log('[DB] 커넥션 풀 종료');
  }
}

module.exports = { initPool, execute, closePool };
