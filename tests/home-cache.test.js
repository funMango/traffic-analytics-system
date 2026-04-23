'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }

  get length() {
    return this.map.size;
  }

  key(index) {
    return Array.from(this.map.keys())[index] ?? null;
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(String(key), String(value));
  }

  removeItem(key) {
    this.map.delete(key);
  }
}

function loadCacheContext() {
  const homeJsPath = path.join(__dirname, '..', 'public', 'js', 'home.js');
  const source = fs.readFileSync(homeJsPath, 'utf8');
  const marker = '// ── 사이드바';
  const idx = source.indexOf(marker);
  assert.ok(idx > 0, 'home.js 캐시 영역을 찾지 못했습니다.');
  const cacheSource = source.slice(0, idx);

  const storage = new MemoryStorage();
  const fixedNow = new Date('2026-04-21T09:00:00+09:00').getTime();
  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) {
        super(fixedNow);
      } else {
        super(...args);
      }
    }

    static now() {
      return fixedNow;
    }
  }

  const context = {
    localStorage: storage,
    console,
    Date: FakeDate,
  };
  vm.createContext(context);
  vm.runInContext(cacheSource, context, { filename: homeJsPath });
  return { context, storage };
}

describe('home.js cache helpers', () => {
  test('heatmap cache schema is persisted with v1 key/value format', () => {
    const { context, storage } = loadCacheContext();
    const slots = [{ slotKey: '2026-04-20', count: 2, preview: ['강남'], hasMore: false, future: false }];

    context.setCachedHeatmap('2026', 'node', { slots });
    const key = context.getHeatmapCacheKey('2026', 'node');
    const raw = storage.getItem(key);
    assert.ok(raw, '캐시 키가 생성되어야 합니다.');

    const parsed = JSON.parse(raw);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.year, '2026');
    assert.equal(parsed.type, 'node');
    assert.ok(Number.isFinite(parsed.cachedAt));
    assert.equal(parsed.slots.length, 1);
    assert.equal(parsed.slots[0].slotKey, '2026-04-20');

    const cached = context.getCachedHeatmap('2026', 'node');
    assert.equal(cached.version, 1);
    assert.equal(cached.year, '2026');
    assert.equal(cached.type, 'node');
    assert.equal(cached.slots[0].count, 2);
  });

  test('mergeHeatmapPayload keeps cached slots when fresh slots are empty', () => {
    const { context } = loadCacheContext();
    const cached = {
      slots: [
        { slotKey: '2026-04-19', count: 1, preview: [], hasMore: false, future: false },
        { slotKey: '2026-04-20', count: 2, preview: ['A'], hasMore: false, future: false },
      ],
    };
    const merged = context.mergeHeatmapPayload(cached, { slots: [] });

    assert.equal(merged.slots.length, 2);
    assert.equal(merged.slots[0].slotKey, '2026-04-19');
    assert.equal(merged.slots[1].slotKey, '2026-04-20');
  });

  test('mergeHeatmapPayload upserts by slotKey and sorts result', () => {
    const { context } = loadCacheContext();
    const cached = {
      slots: [
        { slotKey: '2026-04-20', count: 2, preview: ['old'], hasMore: false, future: false },
      ],
    };
    const fresh = {
      slots: [
        { slotKey: '2026-04-20', count: 5, preview: ['new'], hasMore: true, future: false },
        { slotKey: '2026-04-21', count: 1, preview: [], hasMore: false, future: false },
      ],
    };
    const merged = context.mergeHeatmapPayload(cached, fresh);

    assert.equal(merged.slots.length, 2);
    assert.equal(merged.slots[0].slotKey, '2026-04-20');
    assert.equal(merged.slots[0].count, 5);
    assert.equal(merged.slots[0].hasMore, true);
    assert.equal(merged.slots[1].slotKey, '2026-04-21');
  });

  test('pruneHeatmapCache keeps only recent 3 years', () => {
    const { context, storage } = loadCacheContext();
    const keepYears = ['2026', '2025', '2024'];
    const dropYears = ['2023', '2022'];

    for (const year of keepYears) {
      storage.setItem(context.getHeatmapCacheKey(year, 'node'), JSON.stringify({
        version: 1, year, type: 'node', cachedAt: Date.now(), slots: [],
      }));
    }
    for (const year of dropYears) {
      storage.setItem(context.getHeatmapCacheKey(year, 'direction'), JSON.stringify({
        version: 1, year, type: 'direction', cachedAt: Date.now(), slots: [],
      }));
    }

    context.pruneHeatmapCache();

    for (const year of keepYears) {
      assert.ok(storage.getItem(context.getHeatmapCacheKey(year, 'node')));
    }
    for (const year of dropYears) {
      assert.equal(storage.getItem(context.getHeatmapCacheKey(year, 'direction')), null);
    }
  });

  test('today-abnormal cache keeps only current date key', () => {
    const { context, storage } = loadCacheContext();

    context.setCachedTodayAbnormal('2026-04-20', { count: 1, directionCount: 0, nodes: [], directions: [] });
    context.setCachedTodayAbnormal('2026-04-21', { count: 2, directionCount: 1, nodes: [], directions: [] });
    storage.setItem('home.ta.v1.2026-04-19', JSON.stringify({ version: 1, date: '2026-04-19', payload: {} }));

    context.pruneTodayAbnormalCache('2026-04-21');

    assert.equal(storage.getItem('home.ta.v1.2026-04-20'), null);
    assert.equal(storage.getItem('home.ta.v1.2026-04-19'), null);
    assert.ok(storage.getItem('home.ta.v1.2026-04-21'));

    const cached = context.getCachedTodayAbnormal();
    assert.equal(cached.count, 2);
    assert.equal(cached.directionCount, 1);
  });
});
