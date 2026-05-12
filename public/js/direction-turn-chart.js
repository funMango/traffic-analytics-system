'use strict';

const DirectionTurnChartManager = (() => {
  let chart = null;
  let currentMode = '1d';
  let currentLabels = [];
  let currentDirections = [];
  let currentSourceDirections = [];
  let currentRows = [];
  let currentIsCurrentRange = false;
  let currentNullSlots = [];
  let currentHasBlinkTargets = false;
  let currentDirectionSignature = '';
  let currentLabelSignature = '';
  let _blinkPhase = 0;
  let _blinkRafId = null;

  const DIRECTION_LABELS = {
    '01': '좌',
    '02': '직',
    '03': '우',
  };

  const DIRECTION_COLORS = {
    '01': '#ef4444',
    '02': '#2563eb',
    '03': '#16a34a',
  };

  const lastPointBlinkPlugin = {
    id: 'directionTurnLastPointBlink',
    afterDraw(chartInstance) {
      const ctx = chartInstance.ctx;
      chartInstance.data.datasets.forEach((ds, i) => {
        const meta = chartInstance.getDatasetMeta(i);
        if (meta.hidden || ds.hidden) return;

        const lastIdx = lastActualLabelIndex(ds._actualLabels, chartInstance.data.labels);
        if (lastIdx < 0) return;

        const pt = meta.data[lastIdx];
        if (!pt) return;

        const { x, y } = pt;
        const color = ds.borderColor;
        const r = 14 * _blinkPhase;

        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 1 - _blinkPhase;
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 1;
        ctx.fill();
        ctx.restore();
      });
    },
  };

  function startBlink(chartInstance) {
    if (_blinkRafId) return;
    function tick() {
      _blinkPhase = (_blinkPhase + 0.018) % 1;
      chartInstance.render();
      _blinkRafId = requestAnimationFrame(tick);
    }
    _blinkRafId = requestAnimationFrame(tick);
  }

  function stopBlink() {
    if (_blinkRafId) {
      cancelAnimationFrame(_blinkRafId);
      _blinkRafId = null;
    }
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function normalizeDirections(directions) {
    const source = Array.isArray(directions) && directions.length > 0
      ? directions
      : Object.entries(DIRECTION_LABELS).map(([drctCd, label]) => ({ drctCd, label }));

    return source.map((item) => {
      const drctCd = normalizeDirectionCode(item);
      return {
        drctCd,
        label: item.label || DIRECTION_LABELS[drctCd] || drctCd,
      };
    }).filter((item) => item.drctCd);
  }

  function filterDirectionsWithRows(directions, rows) {
    const existingCodes = activeDirectionCodes(rows);
    return directions.filter((direction) => existingCodes.has(direction.drctCd));
  }

  function normalizeDirectionCode(source) {
    const value = typeof source === 'object' && source !== null
      ? (source.drctCd ?? source.DRCT_CD ?? source.drct_cd)
      : source;
    if (value === null || value === undefined) return '';

    const text = String(value).trim();
    if (text === '') return '';

    const numeric = Number(text);
    if (Number.isFinite(numeric)) return String(Math.trunc(numeric)).padStart(2, '0');
    return text.padStart(2, '0');
  }

  function trafficValue(row) {
    const raw = row?.TRF_QNTY ?? row?.trfQnty ?? row?.trf_qnty;
    if (raw === null || raw === undefined || raw === '') return null;

    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function hasMeasuredTraffic(row) {
    const value = trafficValue(row);
    return value !== null && value > 0;
  }

  function slotLabel(row) {
    const raw = row?.SLOT_LABEL ?? row?.slotLabel ?? row?.slot_label;
    if (raw === null || raw === undefined) return null;
    const label = String(raw).trim();
    return label === '' ? null : label;
  }

  function activeDirectionCodes(rows) {
    const codes = new Set();
    for (const row of rows || []) {
      const drctCd = normalizeDirectionCode(row);
      if (!drctCd) continue;
      if (!hasMeasuredTraffic(row)) continue;
      codes.add(drctCd);
    }
    return codes;
  }

  function directionsForRows(directions, rows) {
    const normalized = normalizeDirections(directions);
    const byCode = new Map(normalized.map((direction) => [direction.drctCd, direction]));
    for (const code of activeDirectionCodes(rows)) {
      if (!byCode.has(code)) byCode.set(code, { drctCd: code, label: DIRECTION_LABELS[code] || code });
    }
    return filterDirectionsWithRows(Array.from(byCode.values()), rows);
  }

  function directionSignature(directions) {
    return directions.map((direction) => direction.drctCd).join('|');
  }

  function labelSignature(labels) {
    if (!Array.isArray(labels) || labels.length === 0) return '0';
    return `${labels.length}|${labels[0]}|${labels[labels.length - 1]}`;
  }

  function generateDailyLabels() {
    const labels = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 5) labels.push(`${pad(h)}:${pad(m)}`);
    }
    return labels;
  }

  function generateWeeklyLabels(weekStart) {
    const labels = [];
    const [y, m, d] = weekStart.split('-').map(Number);
    const base = new Date(y, m - 1, d);
    for (let day = 0; day < 7; day++) {
      const dt = new Date(base);
      dt.setDate(dt.getDate() + day);
      const dateStr = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
      for (let h = 0; h < 24; h++) {
        for (let min = 0; min < 60; min += 15) labels.push(`${dateStr} ${pad(h)}:${pad(min)}`);
      }
    }
    return labels;
  }

  function generateMonthlyLabels(monthStr) {
    const labels = [];
    const [y, m] = monthStr.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${y}-${pad(m)}-${pad(day)}`;
      for (let h = 0; h < 24; h++) labels.push(`${dateStr} ${pad(h)}:00`);
    }
    return labels;
  }

  function generateYearlyLabels(yearStr) {
    const labels = [];
    const y = parseInt(yearStr, 10);
    for (let d = 0; ; d++) {
      const dt = new Date(y, 0, 1 + d);
      if (dt.getFullYear() !== y) break;
      labels.push(`${y}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`);
    }
    return labels;
  }

  function labelForRow(row, mode) {
    const explicitLabel = slotLabel(row);
    if (explicitLabel) return explicitLabel;

    const raw = row?.TOT_DT ?? row?.totDt ?? row?.tot_dt;
    const dt = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(dt.getTime())) return null;

    if (mode === '1d') return `${pad(dt.getHours())}:${pad(Math.floor(dt.getMinutes() / 5) * 5)}`;

    const dateStr = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    if (mode === '1w') return `${dateStr} ${pad(dt.getHours())}:${pad(Math.floor(dt.getMinutes() / 15) * 15)}`;
    if (mode === '1m') return `${dateStr} ${pad(dt.getHours())}:00`;
    return dateStr;
  }

  function nullSlotSet(nullSlots, mode) {
    if (mode === '1d') return new Set(Array.isArray(nullSlots) ? nullSlots : []);
    if (mode === '1y') return new Set(Array.isArray(nullSlots) ? nullSlots : []);

    const set = new Set();
    for (const [dateStr, slots] of Object.entries(nullSlots || {})) {
      for (const slot of slots || []) set.add(`${dateStr} ${slot}`);
    }
    return set;
  }

  function nowCutoffLabel(mode, isCurrentRange) {
    if (!isCurrentRange) return null;
    const now = new Date();
    if (mode === '1d') return `${pad(now.getHours())}:${pad(Math.floor(now.getMinutes() / 5) * 5)}`;

    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    if (mode === '1w') return `${dateStr} ${pad(now.getHours())}:${pad(Math.floor(now.getMinutes() / 15) * 15)}`;
    if (mode === '1m') return `${dateStr} ${pad(now.getHours())}:00`;
    return dateStr;
  }

  function latestLabelFromRows(directions, rows, labels, mode) {
    const validCodes = new Set(directions.map((direction) => direction.drctCd));
    const validLabels = new Set(labels);
    let latest = null;

    for (const row of rows || []) {
      const drctCd = normalizeDirectionCode(row);
      if (!validCodes.has(drctCd)) continue;
      if (!hasMeasuredTraffic(row)) continue;

      const label = labelForRow(row, mode);
      if (!label || !validLabels.has(label)) continue;
      if (latest === null || label > latest) latest = label;
    }

    return latest;
  }

  function lastActualLabelIndex(actualLabels, labels) {
    if (!actualLabels || !labels) return -1;
    const labelSet = actualLabels instanceof Set ? actualLabels : new Set(actualLabels);
    for (let i = labels.length - 1; i >= 0; i--) {
      if (labelSet.has(labels[i])) return i;
    }
    return -1;
  }

  function hasMappedMeasuredRows(directions, rows, labels, mode) {
    const normalized = normalizeDirections(directions);
    const validCodes = new Set(normalized.map((direction) => direction.drctCd));
    const validLabels = new Set(labels || []);

    for (const row of rows || []) {
      const drctCd = normalizeDirectionCode(row);
      if (!validCodes.has(drctCd)) continue;
      if (!hasMeasuredTraffic(row)) continue;

      const label = labelForRow(row, mode);
      if (label && validLabels.has(label)) return true;
    }

    return false;
  }

  function cutoffLabelFromRows(directions, rows, labels, mode, isCurrentRange) {
    if (!isCurrentRange) return null;
    return latestLabelFromRows(directions, rows, labels, mode) || nowCutoffLabel(mode, isCurrentRange);
  }

  function buildData(directions, rows, labels, mode, isCurrentRange, nullSlots) {
    const maps = new Map(directions.map((d) => [d.drctCd, new Map()]));
    const validLabels = new Set(labels);
    for (const row of rows || []) {
      const drctCd = normalizeDirectionCode(row);
      const label = labelForRow(row, mode);
      if (!label || !validLabels.has(label) || !maps.has(drctCd)) continue;
      if (!hasMeasuredTraffic(row)) continue;
      maps.get(drctCd).set(label, trafficValue(row));
    }

    const nullSet = nullSlotSet(nullSlots, mode);
    const cutoff = cutoffLabelFromRows(directions, rows, labels, mode, isCurrentRange);

    return directions.map((direction) => {
      const rowMap = maps.get(direction.drctCd) || new Map();
      return {
        data: labels.map((label) => {
          if (rowMap.has(label)) return rowMap.get(label) ?? 0;
          if (cutoff && label > cutoff) return nullSet.has(label) ? 0 : null;
          return 0;
        }),
        actualLabels: new Set(rowMap.keys()),
      };
    });
  }

  function blinkTargets(directions, rows, labels, mode, isCurrentRange) {
    if (!isCurrentRange) return [];

    const validCodes = new Set(directions.map((direction) => direction.drctCd));
    const validLabels = new Set(labels);
    const latestByDirection = new Map();
    for (const row of rows || []) {
      const drctCd = normalizeDirectionCode(row);
      if (!validCodes.has(drctCd)) continue;
      if (!hasMeasuredTraffic(row)) continue;

      const label = labelForRow(row, mode);
      if (!label || !validLabels.has(label)) continue;
      const previous = latestByDirection.get(drctCd);
      if (previous === undefined || label > previous) latestByDirection.set(drctCd, label);
    }

    return directions
      .filter((direction) => latestByDirection.has(direction.drctCd))
      .map((direction) => ({
        drctCd: direction.drctCd,
        label: latestByDirection.get(direction.drctCd),
        index: labels.indexOf(latestByDirection.get(direction.drctCd)),
      }));
  }

  function mergeRowsByDirectionAndLabel(existingRows, newRows, mode) {
    const merged = [];
    const indexByKey = new Map();

    for (const row of existingRows || []) {
      const label = labelForRow(row, mode);
      const drctCd = normalizeDirectionCode(row);
      if (!label) continue;
      const key = `${row.NODE_ID}|${row.ACSR_ID}|${drctCd}|${label || ''}`;
      indexByKey.set(key, merged.length);
      merged.push(row);
    }

    for (const row of newRows || []) {
      const label = labelForRow(row, mode);
      const drctCd = normalizeDirectionCode(row);
      if (!label) continue;
      const key = `${row.NODE_ID}|${row.ACSR_ID}|${drctCd}|${label || ''}`;
      if (indexByKey.has(key)) merged[indexByKey.get(key)] = row;
      else {
        indexByKey.set(key, merged.length);
        merged.push(row);
      }
    }

    return merged;
  }

  function tickCallback(mode) {
    return function onTick(value, index) {
      const label = this.getLabelForValue(index);
      if (!label) return '';
      const width = this.chart.canvas.offsetWidth;

      if (mode === '1d') {
        if (!label.endsWith(':00')) return '';
        const hour = parseInt(label.slice(0, 2), 10);
        if (width >= 600) return label;
        if (width >= 400) return hour % 2 === 0 ? label : '';
        return hour % 6 === 0 ? label : '';
      }

      if (mode === '1w') {
        const time = label.slice(11);
        if (time === '00:00') return `${parseInt(label.slice(8, 10), 10)}일`;
        if (width >= 700 && time.endsWith(':00')) return parseInt(time, 10) % 6 === 0 ? time : '';
        return '';
      }

      if (mode === '1m') {
        if (!label.endsWith('00:00')) return '';
        const day = parseInt(label.slice(8, 10), 10);
        return width >= 600 || day % 5 === 1 ? `${day}일` : '';
      }

      const day = parseInt(label.slice(8, 10), 10);
      const month = parseInt(label.slice(5, 7), 10);
      if (day === 1) return `${month}월`;
      if (width >= 700 && day === 15) return `${month}/${day}`;
      return '';
    };
  }

  function init(canvasId, directions, labels, mode) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;

    destroy();
    currentMode = mode;
    currentLabels = labels;
    currentDirections = normalizeDirections(directions);
    currentDirectionSignature = directionSignature(currentDirections);
    currentLabelSignature = labelSignature(labels);

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: currentDirections.map((direction) => ({
          label: direction.label,
          _drctCd: direction.drctCd,
          data: new Array(labels.length).fill(null),
          borderColor: DIRECTION_COLORS[direction.drctCd] || '#64748b',
          backgroundColor: DIRECTION_COLORS[direction.drctCd] || '#64748b',
          borderWidth: 1.8,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3,
          fill: false,
          spanGaps: false,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'category',
            ticks: { maxRotation: 0, autoSkip: false, callback: tickCallback(mode), font: { size: 11 }, color: '#64748b' },
            grid: { color: 'rgba(0,0,0,0.05)', drawTicks: false },
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: '교통량(대)', font: { size: 12 }, color: '#64748b' },
            ticks: { font: { size: 11 }, color: '#64748b' },
            grid: { color: 'rgba(0,0,0,0.06)' },
          },
        },
        plugins: {
          legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            mode: 'index',
            intersect: false,
            displayColors: true,
            callbacks: {
              title(items) { return items[0]?.label || ''; },
              label(item) { return `${item.dataset.label}: ${item.raw ?? '-'} 대`; },
            },
          },
        },
      },
      plugins: [lastPointBlinkPlugin],
    });

    return chart;
  }

  function update(directions, rows, labels, mode, isCurrentRange, nullSlots = []) {
    currentSourceDirections = normalizeDirections(directions);
    currentRows = Array.isArray(rows) ? rows.slice() : [];
    currentIsCurrentRange = Boolean(isCurrentRange);
    currentNullSlots = nullSlots;

    const normalized = directionsForRows(currentSourceDirections, currentRows);
    const nextDirectionSignature = directionSignature(normalized);
    const nextLabelSignature = labelSignature(labels);
    if (!chart || currentMode !== mode || currentLabelSignature !== nextLabelSignature || currentDirectionSignature !== nextDirectionSignature) {
      init('turnTrafficChart', normalized, labels, mode);
    }
    if (!chart) return;

    currentDirections = normalized;
    currentDirectionSignature = nextDirectionSignature;
    currentLabelSignature = nextLabelSignature;
    currentHasBlinkTargets = isCurrentRange && blinkTargets(normalized, currentRows, labels, mode, true).length > 0;

    const dataArrays = buildData(normalized, currentRows, labels, mode, isCurrentRange, nullSlots);
    chart.data.datasets.forEach((dataset, index) => {
      const dataItem = dataArrays[index];
      dataset.data = dataItem?.data || new Array(labels.length).fill(null);
      dataset._actualLabels = dataItem?.actualLabels || new Set();
    });
    chart.update();
    if (currentHasBlinkTargets) startBlink(chart); else stopBlink();
  }

  function mergeNewRows(rows, nodeId, acsrId, nullSlots = []) {
    if (!chart) return false;

    const filteredRows = (rows || []).filter((row) => (
      String(row.NODE_ID) === String(nodeId)
      && String(row.ACSR_ID) === String(acsrId)
      && currentLabels.includes(labelForRow(row, currentMode))
    ));

    if (filteredRows.length > 0) {
      currentRows = mergeRowsByDirectionAndLabel(currentRows, filteredRows, currentMode);
      currentNullSlots = nullSlots;

      const nextDirections = directionsForRows(currentSourceDirections, currentRows);
      const nextDirectionSignature = directionSignature(nextDirections);
      if (nextDirectionSignature !== currentDirectionSignature) {
        update(currentSourceDirections, currentRows, currentLabels, currentMode, currentIsCurrentRange, currentNullSlots);
        return true;
      }
    }

    const nullSet = nullSlotSet(nullSlots, currentMode);
    for (const slot of nullSet) {
      const idx = currentLabels.indexOf(slot);
      if (idx < 0) continue;
      chart.data.datasets.forEach((dataset) => {
        if (dataset.data[idx] === null) dataset.data[idx] = 0;
      });
    }

    let updated = false;
    for (const row of filteredRows) {
      const label = labelForRow(row, currentMode);
      const idx = currentLabels.indexOf(label);
      if (idx < 0) continue;
      if (!hasMeasuredTraffic(row)) continue;
      const drctCd = normalizeDirectionCode(row);
      const dataset = chart.data.datasets.find((ds) => ds._drctCd === drctCd);
      if (!dataset) continue;
      dataset.data[idx] = trafficValue(row);
      if (!dataset._actualLabels) dataset._actualLabels = new Set();
      dataset._actualLabels.add(label);
      updated = true;
    }

    if (updated) {
      currentHasBlinkTargets = currentIsCurrentRange
        && blinkTargets(currentDirections, currentRows, currentLabels, currentMode, true).length > 0;
    }

    if (updated || nullSet.size > 0) chart.update();
    if (currentHasBlinkTargets) startBlink(chart); else stopBlink();
    return updated;
  }

  function destroy() {
    stopBlink();
    if (chart) {
      chart.destroy();
      chart = null;
    }
    currentDirections = [];
    currentSourceDirections = [];
    currentRows = [];
    currentIsCurrentRange = false;
    currentNullSlots = [];
    currentHasBlinkTargets = false;
    currentDirectionSignature = '';
    currentLabelSignature = '';
  }

  return {
    generateDailyLabels,
    generateWeeklyLabels,
    generateMonthlyLabels,
    generateYearlyLabels,
    update,
    mergeNewRows,
    hasMappedMeasuredRows,
    destroy,
    _test: {
      normalizeDirections,
      normalizeDirectionCode,
      trafficValue,
      filterDirectionsWithRows,
      directionsForRows,
      labelForRow,
      hasMappedMeasuredRows,
      latestLabelFromRows,
      lastActualLabelIndex,
      blinkTargets,
      buildData,
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DirectionTurnChartManager;
}
