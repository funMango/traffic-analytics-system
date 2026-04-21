'use strict';

/**
 * hourly-poller.js 단위 테스트 (Node.js built-in test runner)
 *
 * - DB / 서버 없이 NULL 슬롯 감지 시나리오 7가지를 자동 검증
 * - require.cache 모킹으로 DB 의존 제거
 * - Date 오버라이드로 시간 경과 시뮬레이션
 *
 * 실행: node --test tests/hourly-poller.test.js
 */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── 시간 조작 헬퍼 ──────────────────────────────────────────
const OriginalDate = global.Date;

function setFakeTime(ms) {
  global.Date = class FakeDate extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) super(ms);
      else super(...args);
    }
    static now() { return ms; }
  };
}

function restoreTime() {
  global.Date = OriginalDate;
}

// ─── hourly-poller 재로드 헬퍼 ────────────────────────────────
const POLLER_PATH = require.resolve('../services/hourly-poller');
const DB_PATH     = require.resolve('../db');

function loadFreshPoller(mockExecute) {
  require.cache[DB_PATH] = {
    id: DB_PATH,
    filename: DB_PATH,
    loaded: true,
    exports: {
      initPool:  async () => {},
      closePool: async () => {},
      execute:   mockExecute,
    },
  };

  delete require.cache[POLLER_PATH];
  return require(POLLER_PATH);
}

function flushAsync() {
  return new Promise(resolve => setImmediate(resolve));
}

afterEach(() => {
  restoreTime();
  delete require.cache[POLLER_PATH];
});

// ─── 기준 시각 ───────────────────────────────────────────────
// 2026-01-01 10:00:00 로컬 (정시 경계)
const T0   = new OriginalDate(2026, 0, 1, 10, 0, 0, 0).getTime();
const HOUR = 3_600_000;

// ═══════════════════════════════════════════════════════════════
describe('hourly-poller NULL 슬롯 감지', () => {

  // ── 테스트 1: initHourlyUpdateTimes — DB 최신값 있음 ──────────
  test('initHourlyUpdateTimes — DB 최신값 있음 → target=11:00로 동작', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: new OriginalDate(T0) }] };
      return { rows: [] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initHourlyUpdateTimes();

    // T0+3h: target=11:00, 11:00+2h=13:00 <= 13:00 → NULL 확정
    setFakeTime(T0 + 3 * HOUR);
    poller.startHourlyPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopHourlyPoller();

    const nullBroadcast = broadcasts.find(b => b.event === 'hourly-null-slots');
    assert.ok(nullBroadcast, 'hourly-null-slots broadcast 발생해야 함');
    assert.ok(nullBroadcast.payload.nullSlots.includes('11:00'), '11:00 NULL 확정');
  });

  // ── 테스트 2: initHourlyUpdateTimes — DB 비어있음 ──────────────
  test('initHourlyUpdateTimes — DB 비어있음 → 현재 시각 기반 초기화, 이후 동작 정상', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: null }] };
      return { rows: [] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initHourlyUpdateTimes(); // LATEST=null → roundDownToHour(new Date()) = 10:00, target=11:00

    // T0+3h: target=11:00, 11:00+2h=13:00 <= 13:00 → NULL 확정
    setFakeTime(T0 + 3 * HOUR);
    poller.startHourlyPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopHourlyPoller();

    const nullBroadcast = broadcasts.find(b => b.event === 'hourly-null-slots');
    assert.ok(nullBroadcast, 'hourly-null-slots broadcast 발생해야 함');
    assert.ok(nullBroadcast.payload.nullSlots.includes('11:00'), '11:00 NULL 확정');
  });

  // ── 테스트 3: 타임아웃 미달 (2h59m) → null 없음 ──────────────
  test('타임아웃 미달 (2h59m) → hourly-null-slots broadcast 없음', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: new OriginalDate(T0) }] };
      return { rows: [] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initHourlyUpdateTimes();

    // T0+2h59m: target=11:00, 11:00+2h=13:00 > 12:59 → 조건 불만족
    setFakeTime(T0 + 3 * HOUR - 1);
    poller.startHourlyPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopHourlyPoller();

    assert.equal(broadcasts.length, 0, '2h59m → broadcast 없어야 함');
  });

  // ── 테스트 4: 타임아웃 초과 (3h) → 11:00 null 확정 ───────────
  test('타임아웃 초과 (3h) → hourly-null-slots broadcast 1회, nullSlots=[11:00]', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: new OriginalDate(T0) }] };
      return { rows: [] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initHourlyUpdateTimes();

    // T0+3h: target=11:00, 11:00+2h=13:00 <= 13:00 → NULL 11:00
    //        target=12:00, 12:00+2h=14:00 > 13:00 → 중지
    setFakeTime(T0 + 3 * HOUR);
    poller.startHourlyPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopHourlyPoller();

    assert.equal(broadcasts.length, 1, 'broadcast 1회 발생');
    assert.equal(broadcasts[0].event, 'hourly-null-slots');
    assert.deepEqual(broadcasts[0].payload.nullSlots, ['11:00']);
  });

  // ── 테스트 5: 타임아웃 초과 (4h) → 11:00, 12:00 null 확정 ────
  test('타임아웃 초과 (4h) → hourly-null-slots broadcast 1회, nullSlots=[11:00,12:00]', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: new OriginalDate(T0) }] };
      return { rows: [] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initHourlyUpdateTimes();

    // T0+4h:
    //   target=11:00, 11:00+2h=13:00 <= 14:00 → NULL 11:00, target=12:00
    //   target=12:00, 12:00+2h=14:00 <= 14:00 → NULL 12:00, target=13:00
    //   target=13:00, 13:00+2h=15:00 >  14:00 → 중지
    setFakeTime(T0 + 4 * HOUR);
    poller.startHourlyPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopHourlyPoller();

    assert.equal(broadcasts.length, 1, 'broadcast 1회 발생');
    assert.equal(broadcasts[0].event, 'hourly-null-slots');
    assert.deepEqual(broadcasts[0].payload.nullSlots, ['11:00', '12:00']);
  });

  // ── 테스트 6: 데이터 도착 갭 → 갭 채움 null ──────────────────
  test('데이터 도착 (13:00) 갭 채움 → hourly-traffic-update, nullSlots=[11:00,12:00]', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: new OriginalDate(T0) }] };
      // 13:00 데이터 도착, target=11:00이므로 갭(11:00~12:00) 존재
      return { rows: [{ TOT_DT: new OriginalDate(2026, 0, 1, 13, 0, 0), TRF_QNTY: 5 }] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initHourlyUpdateTimes();

    // gap fill: cur=11:00, 12:00 (전부 receivedSlots에 없음) → NULL 2개
    setFakeTime(T0 + 3 * HOUR);
    poller.startHourlyPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopHourlyPoller();

    const trafficBroadcast = broadcasts.find(b => b.event === 'hourly-traffic-update');
    assert.ok(trafficBroadcast, 'hourly-traffic-update broadcast 발생');
    assert.deepEqual(trafficBroadcast.payload.nullSlots, ['11:00', '12:00']);
  });

  // ── 테스트 7: 데이터 정시 도착 (11:00) → null 없음 ──────────
  test('데이터 정시 도착 (11:00) → hourly-traffic-update, nullSlots=[]', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: new OriginalDate(T0) }] };
      // 11:00 정시 도착 (target=11:00이므로 갭 없음)
      return { rows: [{ TOT_DT: new OriginalDate(2026, 0, 1, 11, 0, 0), TRF_QNTY: 8 }] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initHourlyUpdateTimes();

    // gap fill: cur=11:00, latestRounded=11:00, cur < latestRounded → false → 루프 없음
    setFakeTime(T0 + HOUR + 1000);
    poller.startHourlyPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopHourlyPoller();

    const trafficBroadcast = broadcasts.find(b => b.event === 'hourly-traffic-update');
    assert.ok(trafficBroadcast, 'hourly-traffic-update broadcast 발생');
    assert.deepEqual(trafficBroadcast.payload.nullSlots, []);
  });

});
