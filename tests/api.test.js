'use strict';

/**
 * API 통합 테스트 (Node.js built-in test runner)
 * DB 연결 없이도 라우터 구조 + 유효성 검사를 확인하는 단위 테스트 포함.
 *
 * DB 연결이 필요한 테스트는 환경변수 INTEGRATION=1 일 때만 실행.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// ─── 환경변수 로드 ───────────────────────────────────
require('dotenv').config();

// ─── 경량 HTTP 헬퍼 ──────────────────────────────────
function request(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const options = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── DB 모킹 ─────────────────────────────────────────
// require cache를 교체해 실제 DB 없이 라우터를 테스트
const Module = require('node:module');

const MOCK_INTERSECTIONS = [
  { NODE_ID: 'A001', CRSRD_NM: '강남교차로', SGNL_CRSRD_NM: '강남사거리' },
  { NODE_ID: 'A002', CRSRD_NM: '홍대교차로', SGNL_CRSRD_NM: '홍대삼거리' },
];

const MOCK_TRAFFIC = [
  { TOT_DT: new Date('2026-03-18T00:00:00'), TRF_QNTY: 12, AVG_SPD: 50, OCPN_RATE: 0.3, CLBR_TRF_QNTY: 11, PDST_QNTY: 2, LOS: 'A' },
  { TOT_DT: new Date('2026-03-18T00:05:00'), TRF_QNTY: 15, AVG_SPD: 48, OCPN_RATE: 0.35, CLBR_TRF_QNTY: 14, PDST_QNTY: 3, LOS: 'B' },
];

const MOCK_HOURLY_TRAFFIC = [
  { TOT_DT: new Date('2026-03-16T00:00:00'), TRF_QNTY: 80, AVG_SPD: 55, OCPN_RATE: 0.4, CLBR_TRF_QNTY: 78, PDST_QNTY: 10, LOS: 'A' },
  { TOT_DT: new Date('2026-03-16T01:00:00'), TRF_QNTY: 60, AVG_SPD: 60, OCPN_RATE: 0.3, CLBR_TRF_QNTY: 58, PDST_QNTY: 8,  LOS: 'A' },
];

// db.js 모킹
require.cache[require.resolve('../db')] = {
  id: require.resolve('../db'),
  filename: require.resolve('../db'),
  loaded: true,
  exports: {
    initPool: async () => {},
    closePool: async () => {},
    execute: async (sql, binds) => {
      // 교차로 전체 목록
      if (sql.includes('M_CRSRD_INF') && !sql.includes('LIKE')) {
        return { rows: MOCK_INTERSECTIONS };
      }
      // 교차로 검색
      if (sql.includes('LIKE')) {
        const term = (binds.term || '').toLowerCase();
        return {
          rows: MOCK_INTERSECTIONS.filter(i =>
            i.CRSRD_NM.toLowerCase().includes(term) ||
            (i.SGNL_CRSRD_NM || '').toLowerCase().includes(term)
          ),
        };
      }
      // 주간 교통량
      if (sql.includes('S_CRSRD_TRF_1HH')) {
        return { rows: MOCK_HOURLY_TRAFFIC };
      }
      // 교통량 하루
      if (sql.includes('S_CRSRD_TRF_5MI') && !sql.includes('ROWNUM')) {
        return { rows: MOCK_TRAFFIC };
      }
      // 최신 1건
      if (sql.includes('ROWNUM')) {
        return { rows: MOCK_TRAFFIC.slice(0, 1) };
      }
      return { rows: [] };
    },
  },
};

// poller 모킹 (DB 불필요)
require.cache[require.resolve('../services/poller')] = {
  id: require.resolve('../services/poller'),
  filename: require.resolve('../services/poller'),
  loaded: true,
  exports: {
    startPoller: () => {},
    stopPoller: () => {},
    initUpdateTimes: async () => {},
    getNullSlotsForDate: () => [],
  },
};

// hourly-poller 모킹 (DB 불필요)
require.cache[require.resolve('../services/hourly-poller')] = {
  id: require.resolve('../services/hourly-poller'),
  filename: require.resolve('../services/hourly-poller'),
  loaded: true,
  exports: {
    startHourlyPoller: () => {},
    stopHourlyPoller: () => {},
    initHourlyUpdateTimes: async () => {},
    getNullSlotsForDate: () => [],
    getNullSlotsForMonth: () => ({}),
    getTargetUpdateTime: () => null,
  },
};

// fifteen-min-poller 모킹 (DB 불필요)
require.cache[require.resolve('../services/fifteen-min-poller')] = {
  id: require.resolve('../services/fifteen-min-poller'),
  filename: require.resolve('../services/fifteen-min-poller'),
  loaded: true,
  exports: {
    startFifteenMinPoller: () => {},
    stopFifteenMinPoller: () => {},
    initFifteenMinUpdateTimes: async () => {},
    getNullSlotsForDate: () => [],
    getTargetUpdateTime: () => null,
  },
};

// daily-poller 모킹 (DB 불필요)
require.cache[require.resolve('../services/daily-poller')] = {
  id: require.resolve('../services/daily-poller'),
  filename: require.resolve('../services/daily-poller'),
  loaded: true,
  exports: {
    startDailyPoller: () => {},
    stopDailyPoller: () => {},
    initDailyUpdateTimes: async () => {},
    getNullSlotsForMonth: () => [],
    getTargetUpdateTime: () => null,
  },
};

const app = require('../app');

// ─── 테스트 서버 설정 ────────────────────────────────
let server;
before(() => {
  server = http.createServer(app);
  return new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
});

after(() => {
  return new Promise(resolve => server.close(resolve));
});

// ─── 테스트 ──────────────────────────────────────────
describe('GET /api/intersections', () => {
  test('전체 목록 반환', async () => {
    const { status, body } = await request(server, 'GET', '/api/intersections');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), '배열이어야 함');
    assert.equal(body.length, 2);
    assert.ok(body[0].NODE_ID, 'NODE_ID 필드 존재');
    assert.ok(body[0].CRSRD_NM, 'CRSRD_NM 필드 존재');
  });
});

describe('GET /api/intersections/search', () => {
  test('검색어 없으면 400', async () => {
    const { status } = await request(server, 'GET', '/api/intersections/search');
    assert.equal(status, 400);
  });

  test('검색어로 필터링', async () => {
    const q = encodeURIComponent('강남');
    const { status, body } = await request(server, 'GET', `/api/intersections/search?q=${q}`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 1);
    assert.equal(body[0].CRSRD_NM, '강남교차로');
  });

  test('매칭 없으면 빈 배열', async () => {
    const q = encodeURIComponent('없는교차로');
    const { status, body } = await request(server, 'GET', `/api/intersections/search?q=${q}`);
    assert.equal(status, 200);
    assert.deepEqual(body, []);
  });
});

describe('GET /api/traffic', () => {
  test('node_id 없으면 400', async () => {
    const { status } = await request(server, 'GET', '/api/traffic');
    assert.equal(status, 400);
  });

  test('날짜 형식 오류 시 400', async () => {
    const { status } = await request(server, 'GET', '/api/traffic?node_id=A001&date=20260318');
    assert.equal(status, 400);
  });

  test('교통량 { rows, nullSlots } 구조 반환', async () => {
    const { status, body } = await request(server, 'GET', '/api/traffic?node_id=A001&date=2026-03-18');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.rows), 'rows가 배열이어야 함');
    assert.ok(body.rows.length > 0);
    assert.ok('TRF_QNTY' in body.rows[0], 'TRF_QNTY 필드 존재');
    assert.ok(Array.isArray(body.nullSlots), 'nullSlots가 배열이어야 함');
  });
});

describe('GET /api/traffic/latest', () => {
  test('node_id 없으면 400', async () => {
    const { status } = await request(server, 'GET', '/api/traffic/latest');
    assert.equal(status, 400);
  });

  test('최신 1건 반환', async () => {
    const { status, body } = await request(server, 'GET', '/api/traffic/latest?node_id=A001');
    assert.equal(status, 200);
    assert.ok(!Array.isArray(body), '배열이 아닌 단일 객체');
    assert.ok('TRF_QNTY' in body);
  });
});

describe('GET /api/traffic/weekly', () => {
  test('node_id 없으면 400', async () => {
    const { status } = await request(server, 'GET', '/api/traffic/weekly');
    assert.equal(status, 400);
  });

  test('week_start 없으면 400', async () => {
    const { status } = await request(server, 'GET', '/api/traffic/weekly?node_id=A001');
    assert.equal(status, 400);
  });

  test('week_start 형식 오류 시 400', async () => {
    const { status } = await request(server, 'GET', '/api/traffic/weekly?node_id=A001&week_start=20260315');
    assert.equal(status, 400);
  });

  test('week_start가 일요일이 아니면 400', async () => {
    // 2026-03-19는 목요일
    const { status, body } = await request(server, 'GET', '/api/traffic/weekly?node_id=A001&week_start=2026-03-19');
    assert.equal(status, 400);
    assert.ok(body.error.includes('일요일'), '일요일 오류 메시지');
  });

  test('정상 응답 { rows, nullSlots } 구조 확인', async () => {
    // 2026-03-15는 일요일
    const { status, body } = await request(server, 'GET', '/api/traffic/weekly?node_id=A001&week_start=2026-03-15');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.rows), 'rows가 배열이어야 함');
    assert.ok(typeof body.nullSlots === 'object' && !Array.isArray(body.nullSlots), 'nullSlots가 객체이어야 함');
  });

  test('nullSlots 형태 { YYYY-MM-DD: [...] } 확인', async () => {
    const { status, body } = await request(server, 'GET', '/api/traffic/weekly?node_id=A001&week_start=2026-03-15');
    assert.equal(status, 200);
    for (const [key, val] of Object.entries(body.nullSlots)) {
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(key), 'key가 YYYY-MM-DD 형식');
      assert.ok(Array.isArray(val), 'value가 배열');
    }
  });
});

describe('GET /api/traffic/monthly', () => {
  test('node_id 없으면 400', async () => {
    const { status } = await request(server, 'GET', '/api/traffic/monthly');
    assert.equal(status, 400);
  });

  test('month 없으면 400', async () => {
    const { status } = await request(server, 'GET', '/api/traffic/monthly?node_id=A001');
    assert.equal(status, 400);
  });

  test('month 형식 오류 시 400', async () => {
    const { status } = await request(server, 'GET', '/api/traffic/monthly?node_id=A001&month=202603');
    assert.equal(status, 400);
  });

  test('정상 응답 { rows, nullSlots } 구조 확인', async () => {
    const { status, body } = await request(server, 'GET', '/api/traffic/monthly?node_id=A001&month=2026-03');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.rows), 'rows가 배열이어야 함');
    assert.ok(typeof body.nullSlots === 'object' && !Array.isArray(body.nullSlots), 'nullSlots가 객체이어야 함');
  });
});

describe('GET /api/traffic/yearly', () => {
  test('node_id 없으면 400', async () => {
    const { status } = await request(server, 'GET', '/api/traffic/yearly');
    assert.equal(status, 400);
  });

  test('year 없으면 400', async () => {
    const { status } = await request(server, 'GET', '/api/traffic/yearly?node_id=A001');
    assert.equal(status, 400);
  });

  test('year 형식 오류 시 400', async () => {
    const { status } = await request(server, 'GET', '/api/traffic/yearly?node_id=A001&year=26');
    assert.equal(status, 400);
  });

  test('정상 응답 { rows, nullSlots } 구조 확인', async () => {
    const { status, body } = await request(server, 'GET', '/api/traffic/yearly?node_id=A001&year=2026');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.rows), 'rows가 배열이어야 함');
    assert.ok(Array.isArray(body.nullSlots), 'nullSlots가 배열이어야 함');
  });
});

describe('GET /api/sse', () => {
  test('SSE 헤더 반환', async () => {
    return new Promise((resolve, reject) => {
      const { port } = server.address();
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/api/sse',
        method: 'GET',
      }, res => {
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['content-type'], 'text/event-stream');
        req.destroy();
        resolve();
      });
      req.on('error', err => {
        // ECONNRESET은 정상 (강제 종료)
        if (err.code === 'ECONNRESET') resolve();
        else reject(err);
      });
      req.end();
    });
  });
});
