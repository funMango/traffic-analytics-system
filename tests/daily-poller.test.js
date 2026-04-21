'use strict';

/**
 * daily-poller.js 단위 테스트 (Node.js built-in test runner)
 *
 * - DB / 서버 없이 NULL 슬롯 감지 시나리오 7가지를 자동 검증
 * - require.cache 모킹으로 DB 의존 제거
 * - Date 오버라이드로 시간 경과 시뮬레이션
 *
 * 실행: node --test tests/daily-poller.test.js
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

// ─── daily-poller 재로드 헬퍼 ────────────────────────────────
const POLLER_PATH = require.resolve('../services/daily-poller');
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
// 2026-01-01 00:00:00 로컬 (자정 경계)
const T0   = new OriginalDate(2026, 0, 1, 0, 0, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════
describe('daily-poller NULL 슬롯 감지', () => {

  // ── 테스트 1: initDailyUpdateTimes — DB 최신값 있음 ─────────
  test('initDailyUpdateTimes — DB 최신값 있음 → target=2026-01-02로 동작', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: new OriginalDate(T0) }] };
      return { rows: [] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initDailyUpdateTimes();

    // T0+3d: target=2026-01-02, 2026-01-02+2d=2026-01-04 <= 2026-01-04 → NULL 확정
    setFakeTime(T0 + 3 * DAY);
    poller.startDailyPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopDailyPoller();

    const nullBroadcast = broadcasts.find(b => b.event === 'daily-null-slots');
    assert.ok(nullBroadcast, 'daily-null-slots broadcast 발생해야 함');
    assert.ok(nullBroadcast.payload.nullSlots.includes('2026-01-02'), '2026-01-02 NULL 확정');
  });

  // ── 테스트 2: initDailyUpdateTimes — DB 비어있음 ────────────
  test('initDailyUpdateTimes — DB 비어있음 → 현재 날짜 기반 초기화, 이후 동작 정상', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: null }] };
      return { rows: [] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initDailyUpdateTimes(); // LATEST=null → roundDownToDay(new Date()) = 2026-01-01, target=2026-01-02

    // T0+3d: target=2026-01-02, 2026-01-02+2d=2026-01-04 <= 2026-01-04 → NULL 확정
    setFakeTime(T0 + 3 * DAY);
    poller.startDailyPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopDailyPoller();

    const nullBroadcast = broadcasts.find(b => b.event === 'daily-null-slots');
    assert.ok(nullBroadcast, 'daily-null-slots broadcast 발생해야 함');
    assert.ok(nullBroadcast.payload.nullSlots.includes('2026-01-02'), '2026-01-02 NULL 확정');
  });

  // ── 테스트 3: 타임아웃 미달 (1일 23시간) → null 없음 ───────
  test('타임아웃 미달 (1d23h) → daily-null-slots broadcast 없음', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: new OriginalDate(T0) }] };
      return { rows: [] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initDailyUpdateTimes();

    // T0+1.958d (23h): target=2026-01-02, 2026-01-02+2d=2026-01-04는 초과하지 않음
    setFakeTime(T0 + 1.958 * DAY);
    poller.startDailyPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopDailyPoller();

    const nullBroadcast = broadcasts.find(b => b.event === 'daily-null-slots');
    assert.ok(!nullBroadcast, 'daily-null-slots broadcast 없어야 함');
  });

  // ── 테스트 4: 타임아웃 초과 (3일) → 1일치 null 확정 ─────────
  test('타임아웃 초과 (3d) → 1일치 NULL 확정', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: new OriginalDate(T0) }] };
      return { rows: [] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initDailyUpdateTimes();

    // T0+3.1d: target=2026-01-02, 2026-01-02+2d=2026-01-04 <= 2026-01-04 → NULL 확정
    setFakeTime(T0 + 3.1 * DAY);
    poller.startDailyPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopDailyPoller();

    const nullBroadcast = broadcasts.find(b => b.event === 'daily-null-slots');
    assert.ok(nullBroadcast, 'daily-null-slots broadcast 발생해야 함');
    const nullSlots = nullBroadcast.payload.nullSlots;
    assert.ok(nullSlots.includes('2026-01-02'), '2026-01-02 NULL 확정');
  });

  // ── 테스트 5: 타임아웃 초과 (4일) → 2일치 null 확정 ─────────
  test('타임아웃 초과 (4d) → 2일치 NULL 확정', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: new OriginalDate(T0) }] };
      return { rows: [] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initDailyUpdateTimes();

    // T0+4.1d: target=2026-01-02 이후, 2026-01-02와 2026-01-03 모두 확정
    setFakeTime(T0 + 4.1 * DAY);
    poller.startDailyPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopDailyPoller();

    const nullBroadcast = broadcasts.find(b => b.event === 'daily-null-slots');
    assert.ok(nullBroadcast, 'daily-null-slots broadcast 발생해야 함');
    const nullSlots = nullBroadcast.payload.nullSlots;
    assert.ok(nullSlots.includes('2026-01-02'), '2026-01-02 NULL 확정');
    assert.ok(nullSlots.includes('2026-01-03'), '2026-01-03 NULL 확정');
  });

  // ── 테스트 6: 데이터 도착 갭 채움 → null 포함 traffic-update ──
  test('데이터 도착 갭 채움 → traffic-update에 nullSlots 포함', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: new OriginalDate(T0) }] };
      if (sql.includes('WHERE TOT_DT')) {
        // 2일 뒤의 데이터 반환 (2026-01-03)
        return {
          rows: [{
            NODE_ID: 'N001',
            TOT_DT: new OriginalDate(T0 + 2 * DAY),
            TRF_QNTY: 1500,
            AVG_SPD: 50,
            OCPN_RATE: 65,
            CLBR_TRF_QNTY: 1450,
            PDST_QNTY: 2,
            LOS: 'D',
          }],
        };
      }
      return { rows: [] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initDailyUpdateTimes();

    // T0+0.1d: 데이터 수신 → 2026-01-02는 갭, 2026-01-03은 데이터
    setFakeTime(T0 + 0.1 * DAY);
    poller.startDailyPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopDailyPoller();

    const updateBroadcast = broadcasts.find(b => b.event === 'daily-traffic-update');
    assert.ok(updateBroadcast, 'daily-traffic-update broadcast 발생해야 함');
    assert.ok(updateBroadcast.payload.rows.length > 0, 'rows 데이터 포함');
  });

  // ── 테스트 7: 데이터 정시 도착 → null 없는 traffic-update ────
  test('데이터 정시 도착 → traffic-update, 갭 없음', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: new OriginalDate(T0) }] };
      if (sql.includes('WHERE TOT_DT')) {
        // 정시에 데이터 반환 (2026-01-02)
        return {
          rows: [{
            NODE_ID: 'N001',
            TOT_DT: new OriginalDate(T0 + 1 * DAY),
            TRF_QNTY: 2000,
            AVG_SPD: 55,
            OCPN_RATE: 70,
            CLBR_TRF_QNTY: 1950,
            PDST_QNTY: 1,
            LOS: 'C',
          }],
        };
      }
      return { rows: [] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initDailyUpdateTimes();

    // T0+0.1d: 데이터 수신 (정시 도착)
    setFakeTime(T0 + 0.1 * DAY);
    poller.startDailyPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopDailyPoller();

    const updateBroadcast = broadcasts.find(b => b.event === 'daily-traffic-update');
    assert.ok(updateBroadcast, 'daily-traffic-update broadcast 발생해야 함');
    assert.ok(updateBroadcast.payload.rows.length > 0, 'rows 데이터 포함');
  });
});
