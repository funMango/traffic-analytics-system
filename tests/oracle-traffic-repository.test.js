'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { createOracleTrafficRepository } = require('../src/modules/traffic/infrastructure/repositories/oracle-traffic-repository');

describe('oracle traffic repository direction queries', () => {
  test('selects SLOT_LABEL for every direction granularity', async () => {
    const calls = [];
    const repository = createOracleTrafficRepository({
      database: {
        execute: async (sql, binds) => {
          calls.push({ sql, binds });
          return { rows: [] };
        },
      },
    });

    await repository.findDirectionDailyTraffic('N1', 'ACSR000001', '2026-05-11', new Date('2026-05-12T00:00:00'));
    await repository.findDirectionWeeklyTraffic('N1', 'ACSR000001', new Date('2026-05-10T00:00:00'), new Date('2026-05-17T00:00:00'));
    await repository.findDirectionMonthlyTraffic('N1', 'ACSR000001', new Date('2026-05-01T00:00:00'), new Date('2026-06-01T00:00:00'));
    await repository.findDirectionYearlyTraffic('N1', 'ACSR000001', new Date('2026-01-01T00:00:00'), new Date('2027-01-01T00:00:00'));

    assert.equal(calls.length, 4);
    assert.match(calls[0].sql, /TO_CHAR\(TOT_DT, 'HH24:MI'\) AS SLOT_LABEL/);
    assert.match(calls[1].sql, /TO_CHAR\(TOT_DT, 'YYYY-MM-DD HH24:MI'\) AS SLOT_LABEL/);
    assert.match(calls[2].sql, /TO_CHAR\(TRUNC\(TOT_DT, 'HH'\), 'YYYY-MM-DD HH24:MI'\) AS SLOT_LABEL/);
    assert.match(calls[3].sql, /TO_CHAR\(TOT_DT, 'YYYY-MM-DD'\) AS SLOT_LABEL/);
    assert.ok(calls.every((call) => call.sql.includes('ACSR_ID = :acsrId')));
    assert.ok(calls.every((call) => call.binds.acsrId === 'ACSR000001'));
  });

  test('passes numeric-looking acsr_id through unchanged', async () => {
    let capturedBinds = null;
    const repository = createOracleTrafficRepository({
      database: {
        execute: async (_sql, binds) => {
          capturedBinds = binds;
          return { rows: [] };
        },
      },
    });

    await repository.findDirectionDailyTraffic('N1', '1', '2026-05-11', new Date('2026-05-12T00:00:00'));

    assert.equal(capturedBinds.acsrId, '1');
  });
});
