'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const DirectionTurnChartManager = require('../public/js/direction-turn-chart');

const {
  directionsForRows,
  normalizeDirections,
  normalizeDirectionCode,
  trafficValue,
  hasMappedMeasuredRows,
  labelForRow,
  latestLabelFromRows,
  lastActualLabelIndex,
  blinkTargets,
  buildData,
} = DirectionTurnChartManager._test;

const directions = [
  { drctCd: '01', label: 'left' },
  { drctCd: '02', label: 'straight' },
  { drctCd: '03', label: 'right' },
];

function row(drctCd, date, quantity = 1) {
  return {
    NODE_ID: 'N1',
    ACSR_ID: 'A1',
    DRCT_CD: drctCd,
    TOT_DT: date,
    TRF_QNTY: quantity,
  };
}

describe('direction turn chart data helpers', () => {
  test('keeps only directions that have positive measured traffic in the selected range', () => {
    const rows = [row('02', new Date(2026, 4, 11, 8, 5), 12)];
    const visible = directionsForRows(directions, rows);

    assert.deepEqual(visible.map((direction) => direction.drctCd), ['02']);
  });

  test('hides a direction whose measured rows are all zero', () => {
    const rows = [
      row('01', new Date(2026, 4, 11, 8, 0), 10),
      row('02', new Date(2026, 4, 11, 8, 5), 20),
      row('03', new Date(2026, 4, 11, 8, 0), 0),
      row('03', new Date(2026, 4, 11, 8, 5), 0),
    ];
    const visible = directionsForRows(directions, rows);

    assert.deepEqual(visible.map((direction) => direction.drctCd), ['01', '02']);
  });

  test('does not show a direction that only has null-slot filled zeros', () => {
    const labels = ['08:00', '08:05'];
    const rows = [row('01', new Date(2026, 4, 11, 8, 0), 10), row('02', new Date(2026, 4, 11, 8, 5), 20)];
    const visible = directionsForRows(directions, rows);
    const data = buildData(visible, rows, labels, '1d', true, ['08:00', '08:05']);

    assert.deepEqual(visible.map((direction) => direction.drctCd), ['01', '02']);
    assert.equal(visible.some((direction) => direction.drctCd === '03'), false);
    assert.equal(data.length, 2);
  });

  test('blinks each visible direction at its own last measured label', () => {
    const rows = [
      row('01', new Date(2026, 4, 11, 8, 0), 10),
      row('01', new Date(2026, 4, 11, 8, 5), 11),
      row('02', new Date(2026, 4, 11, 8, 5), 12),
      row('03', new Date(2026, 4, 11, 8, 0), 13),
      row('03', new Date(2026, 4, 11, 8, 10), 0),
    ];
    const visible = directionsForRows(directions, rows);
    const targets = blinkTargets(visible, rows, ['08:00', '08:05', '08:10'], '1d', true);

    assert.deepEqual(targets, [
      { drctCd: '01', label: '08:05', index: 1 },
      { drctCd: '02', label: '08:05', index: 1 },
      { drctCd: '03', label: '08:00', index: 0 },
    ]);
  });

  test('does not blink outside a current realtime range', () => {
    const rows = [row('02', new Date(2026, 4, 10, 8, 5), 12)];
    const visible = directionsForRows(directions, rows);
    const targets = blinkTargets(visible, rows, ['08:00', '08:05'], '1d', false);

    assert.deepEqual(targets, []);
  });

  test('finds the last actual label index without using zero-filled chart values', () => {
    assert.equal(lastActualLabelIndex(new Set(['08:00', '08:05']), ['08:00', '08:05', '08:10']), 1);
    assert.equal(lastActualLabelIndex(new Set(), ['08:00']), -1);
  });

  test('uses each direction last measured label for week month and year ranges', () => {
    const visible = normalizeDirections([
      { drctCd: '01', label: 'left' },
      { drctCd: '02', label: 'straight' },
    ]);
    const samples = [
      {
        mode: '1w',
        labels: ['2026-05-11 08:15', '2026-05-12 09:15'],
        rows: [
          row('01', new Date(2026, 4, 11, 8, 17), 10),
          row('02', new Date(2026, 4, 12, 9, 29), 20),
        ],
      },
      {
        mode: '1m',
        labels: ['2026-05-11 08:00', '2026-05-12 09:00'],
        rows: [
          row('01', new Date(2026, 4, 11, 8, 17), 10),
          row('02', new Date(2026, 4, 12, 9, 29), 20),
        ],
      },
      {
        mode: '1y',
        labels: ['2026-05-11', '2026-06-12'],
        rows: [
          row('01', new Date(2026, 4, 11, 8, 17), 10),
          row('02', new Date(2026, 5, 12, 9, 29), 20),
        ],
      },
    ];

    for (const sample of samples) {
      assert.deepEqual(blinkTargets(visible, sample.rows, sample.labels, sample.mode, true), [
        { drctCd: '01', label: sample.labels[0], index: 0 },
        { drctCd: '02', label: sample.labels[1], index: 1 },
      ]);
    }
  });

  test('calculates latest labels for day week month and year formats', () => {
    const visible = normalizeDirections([{ drctCd: '02', label: 'straight' }]);
    const samples = [
      {
        mode: '1d',
        rows: [row('02', new Date(2026, 4, 11, 8, 7), 1), row('02', new Date(2026, 4, 11, 8, 11), 2)],
        labels: ['08:05', '08:10'],
        expected: '08:10',
      },
      {
        mode: '1w',
        rows: [row('02', new Date(2026, 4, 11, 8, 17), 1), row('02', new Date(2026, 4, 12, 9, 29), 2)],
        labels: ['2026-05-11 08:15', '2026-05-12 09:15'],
        expected: '2026-05-12 09:15',
      },
      {
        mode: '1m',
        rows: [row('02', new Date(2026, 4, 11, 8, 17), 1), row('02', new Date(2026, 4, 12, 9, 29), 2)],
        labels: ['2026-05-11 08:00', '2026-05-12 09:00'],
        expected: '2026-05-12 09:00',
      },
      {
        mode: '1y',
        rows: [row('02', new Date(2026, 4, 11, 8, 17), 1), row('02', new Date(2026, 5, 12, 9, 29), 2)],
        labels: ['2026-05-11', '2026-06-12'],
        expected: '2026-06-12',
      },
    ];

    for (const sample of samples) {
      assert.equal(latestLabelFromRows(visible, sample.rows, sample.labels, sample.mode), sample.expected);
    }
  });

  test('normalizes direction codes from API variants', () => {
    assert.equal(normalizeDirectionCode({ DRCT_CD: 1 }), '01');
    assert.equal(normalizeDirectionCode({ drctCd: '1' }), '01');
    assert.equal(normalizeDirectionCode({ DRCT_CD: '01' }), '01');
    assert.equal(normalizeDirectionCode(3), '03');
  });

  test('shows numeric direction codes and string traffic quantities in datasets', () => {
    const rows = [row(1, new Date(2026, 4, 11, 8, 5), '42')];
    const visible = directionsForRows(directions, rows);
    const data = buildData(visible, rows, ['08:00', '08:05'], '1d', false, []);

    assert.deepEqual(visible.map((direction) => direction.drctCd), ['01']);
    assert.equal(trafficValue(rows[0]), 42);
    assert.deepEqual(data[0].data, [0, 42]);
  });

  test('matches labels from JSON serialized API date strings', () => {
    const visible = normalizeDirections([{ drctCd: '02', label: 'straight' }]);
    const serialized = (date) => JSON.parse(JSON.stringify(date));
    const samples = [
      {
        mode: '1d',
        rows: [row('02', serialized(new Date(2026, 4, 11, 8, 7)), 1)],
        labels: ['08:05'],
        expected: '08:05',
      },
      {
        mode: '1w',
        rows: [row('02', serialized(new Date(2026, 4, 11, 8, 17)), 1)],
        labels: ['2026-05-11 08:15'],
        expected: '2026-05-11 08:15',
      },
      {
        mode: '1m',
        rows: [row('02', serialized(new Date(2026, 4, 11, 8, 17)), 1)],
        labels: ['2026-05-11 08:00'],
        expected: '2026-05-11 08:00',
      },
      {
        mode: '1y',
        rows: [row('02', serialized(new Date(2026, 4, 11, 8, 17)), 1)],
        labels: ['2026-05-11'],
        expected: '2026-05-11',
      },
    ];

    for (const sample of samples) {
      assert.equal(latestLabelFromRows(visible, sample.rows, sample.labels, sample.mode), sample.expected);
    }
  });

  test('uses SLOT_LABEL before parsing TOT_DT', () => {
    const visible = normalizeDirections([{ drctCd: '02', label: 'straight' }]);
    const source = row('02', '2026-05-10T23:05:00.000Z', 7);
    source.SLOT_LABEL = '08:05';

    assert.equal(labelForRow(source, '1d'), '08:05');
    assert.equal(latestLabelFromRows(visible, [source], ['08:05'], '1d'), '08:05');
  });

  test('reports no mapped measured rows when positive rows do not match chart labels', () => {
    const rows = [row('02', new Date(2026, 4, 11, 8, 5), 12)];

    assert.equal(hasMappedMeasuredRows(directions, rows, ['09:00'], '1d'), false);
  });

  test('reports mapped measured rows for legacy rows without SLOT_LABEL', () => {
    const rows = [row('02', new Date(2026, 4, 11, 8, 5), 12)];

    assert.equal(hasMappedMeasuredRows(directions, rows, ['08:05'], '1d'), true);
  });

  test('does not use zero rows as measured data points', () => {
    const visible = normalizeDirections([{ drctCd: '02', label: 'straight' }]);
    const rows = [row('02', new Date(2026, 4, 11, 8, 5), 0)];
    const data = buildData(visible, rows, ['08:00', '08:05'], '1d', false, []);

    assert.deepEqual(data[0].data, [0, 0]);
    assert.equal(data[0].actualLabels.size, 0);
    assert.equal(hasMappedMeasuredRows(visible, rows, ['08:05'], '1d'), false);
  });

  test('keeps slots after the last measured label null unless they are confirmed null slots', () => {
    const rows = [row('01', new Date(2026, 4, 11, 8, 5), '17')];
    const visible = directionsForRows(directions, rows);
    const data = buildData(visible, rows, ['08:00', '08:05', '08:10', '08:15'], '1d', true, ['08:10']);

    assert.deepEqual(data[0].data, [0, 17, 0, null]);
  });
});
