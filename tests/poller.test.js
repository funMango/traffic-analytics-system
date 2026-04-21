'use strict';

/**
 * poller.js 단위 테스트 (Node.js built-in test runner)
 *
 * - DB / 서버 없이 NULL 슬롯 감지 시나리오 7가지를 자동 검증
 * - require.cache 모킹으로 DB 의존 제거
 * - Date 오버라이드로 시간 경과 시뮬레이션
 *
 * 실행: node --test tests/poller.test.js
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

// ─── poller 재로드 헬퍼 ──────────────────────────────────────
// 각 테스트마다 독립된 모듈 인스턴스(nullSlots 빈 Map 초기 상태)를 얻기 위해
// require.cache에서 poller를 삭제한 뒤 재로드한다.

const POLLER_PATH = require.resolve('../services/poller');
const DB_PATH     = require.resolve('../db');

function loadFreshPoller(mockExecute) {
  // db 모킹 등록
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

  // poller 캐시 삭제 후 재로드 (모듈 수준 상태 초기화)
  delete require.cache[POLLER_PATH];
  return require(POLLER_PATH);
}

// poll() 비동기 완료를 기다리는 유틸
function flushAsync() {
  return new Promise(resolve => setImmediate(resolve));
}

// ─── 테스트 종료 후 정리 ─────────────────────────────────────
afterEach(() => {
  restoreTime();
  delete require.cache[POLLER_PATH];
});

// ─── 기준 시각 ───────────────────────────────────────────────
// 2026-01-01 10:00:00 로컬 (5분 경계)
const T0 = new OriginalDate(2026, 0, 1, 10, 0, 0, 0).getTime();
const MIN = 60_000;

// ═══════════════════════════════════════════════════════════════
describe('poller NULL 슬롯 감지', () => {

  // ── 테스트 1: initUpdateTimes — DB 최신값 있음 ──────────────
  test('initUpdateTimes — DB 최신값 있음 → target=10:05로 동작', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: new OriginalDate(T0) }] };
      return { rows: [] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initUpdateTimes();

    // T0+15min: target=10:05, 10:05+10min=10:15 <= 10:15 → NULL 확정
    setFakeTime(T0 + 15 * MIN);
    poller.startPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopPoller();

    const nullBroadcast = broadcasts.find(b => b.event === 'null-slots');
    assert.ok(nullBroadcast, 'null-slots broadcast 발생해야 함');
    assert.ok(nullBroadcast.payload.nullSlots.includes('10:05'), '10:05 NULL 확정');
  });

  // ── 테스트 2: initUpdateTimes — DB 비어있음 ─────────────────
  test('initUpdateTimes — DB 비어있음 → 현재 시각 기반 초기화, 이후 동작 정상', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: null }] };
      return { rows: [] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initUpdateTimes();  // LATEST=null → roundDownTo5Min(new Date()) = 10:00, target=10:05

    // T0+15min: target=10:05, 10:05+10min=10:15 <= 10:15 → NULL 확정
    setFakeTime(T0 + 15 * MIN);
    poller.startPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopPoller();

    const nullBroadcast = broadcasts.find(b => b.event === 'null-slots');
    assert.ok(nullBroadcast, 'null-slots broadcast 발생해야 함');
    assert.ok(nullBroadcast.payload.nullSlots.includes('10:05'), '10:05 NULL 확정');
  });

  // ── 테스트 3: 타임아웃 미달 (14분) → null 없음 ─────────────
  test('타임아웃 미달 (14분) → null-slots broadcast 없음', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: new OriginalDate(T0) }] };
      return { rows: [] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initUpdateTimes();

    // T0+14min: target=10:05, 10:05+10min=10:15 > 10:14 → 조건 불만족
    setFakeTime(T0 + 14 * MIN);
    poller.startPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopPoller();

    assert.equal(broadcasts.length, 0, '14분 → broadcast 없어야 함');
  });

  // ── 테스트 4: 타임아웃 초과 (15분) → 10:05 null 확정 ────────
  test('타임아웃 초과 (15분) → null-slots broadcast 1회, nullSlots=[10:05]', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: new OriginalDate(T0) }] };
      return { rows: [] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initUpdateTimes();

    // T0+15min: target=10:05, 10:05+10min=10:15 <= 10:15 → NULL 10:05 확정
    //           다음: target=10:10, 10:10+10min=10:20 > 10:15 → 중지
    setFakeTime(T0 + 15 * MIN);
    poller.startPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopPoller();

    assert.equal(broadcasts.length, 1, 'broadcast 1회 발생');
    assert.equal(broadcasts[0].event, 'null-slots');
    assert.deepEqual(broadcasts[0].payload.nullSlots, ['10:05']);
  });

  // ── 테스트 5: 타임아웃 초과 (20분) → 10:05, 10:10 null 확정 ─
  test('타임아웃 초과 (20분) → null-slots broadcast 1회, nullSlots=[10:05,10:10]', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: new OriginalDate(T0) }] };
      return { rows: [] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initUpdateTimes();

    // T0+20min:
    //   target=10:05, 10:05+10=10:15 <= 10:20 → NULL 10:05, target=10:10
    //   target=10:10, 10:10+10=10:20 <= 10:20 → NULL 10:10, target=10:15
    //   target=10:15, 10:15+10=10:25 >  10:20 → 중지
    setFakeTime(T0 + 20 * MIN);
    poller.startPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopPoller();

    assert.equal(broadcasts.length, 1, 'broadcast 1회 발생');
    assert.equal(broadcasts[0].event, 'null-slots');
    assert.deepEqual(broadcasts[0].payload.nullSlots, ['10:05', '10:10']);
  });

  // ── 테스트 6: 데이터 도착 갭 → 갭 채움 null ──────────────────
  test('데이터 도착 (10:20) 갭 채움 → traffic-update, nullSlots=[10:05,10:10,10:15]', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: new OriginalDate(T0) }] };
      // 10:20 데이터 도착, target=10:05이므로 갭(10:05~10:15) 존재
      return { rows: [{ TOT_DT: new OriginalDate(2026, 0, 1, 10, 20, 0), TRF_QNTY: 5 }] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initUpdateTimes();

    // gap fill: cur=10:05,10:10,10:15 (전부 receivedSlots에 없음) → NULL 3개
    setFakeTime(T0 + 20 * MIN);
    poller.startPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopPoller();

    const trafficBroadcast = broadcasts.find(b => b.event === 'traffic-update');
    assert.ok(trafficBroadcast, 'traffic-update broadcast 발생');
    assert.deepEqual(trafficBroadcast.payload.nullSlots, ['10:05', '10:10', '10:15']);
  });

  // ── 테스트 7: 데이터 정시 도착 → null 없음 ───────────────────
  test('데이터 정시 도착 (10:05) → traffic-update, nullSlots=[]', async () => {
    setFakeTime(T0);

    const broadcasts = [];
    const mockExecute = async (sql) => {
      if (sql.includes('MAX')) return { rows: [{ LATEST: new OriginalDate(T0) }] };
      // 10:05 정시 도착 (target=10:05이므로 갭 없음)
      return { rows: [{ TOT_DT: new OriginalDate(2026, 0, 1, 10, 5, 0), TRF_QNTY: 8 }] };
    };

    const poller = loadFreshPoller(mockExecute);
    await poller.initUpdateTimes();

    // gap fill: cur=10:05, latestRounded=10:05, cur < latestRounded → false → 루프 없음
    setFakeTime(T0 + 6 * MIN);
    poller.startPoller((event, payload) => broadcasts.push({ event, payload }));
    await flushAsync();
    poller.stopPoller();

    const trafficBroadcast = broadcasts.find(b => b.event === 'traffic-update');
    assert.ok(trafficBroadcast, 'traffic-update broadcast 발생');
    assert.deepEqual(trafficBroadcast.payload.nullSlots, []);
  });

});
