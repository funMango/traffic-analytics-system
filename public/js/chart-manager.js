'use strict';

/**
 * Chart.js 그래프 관리
 */
const ChartManager = (() => {
  let chart = null;
  let isCurrentWeekMode = false;  // 현재 주 모드(실시간) 여부
  let weeklyWeekStart = null;     // 현재 주간 차트의 week_start
  let isCurrentMonthMode = false; // 현재 월 모드(실시간) 여부
  let monthlyMonthStr = null;     // 현재 월간 차트의 month (YYYY-MM)
  let isCurrentYearMode = false;  // 현재 연도 모드(실시간) 여부
  let yearlyYearStr = null;       // 현재 연간 차트의 year (YYYY)

  // 방향별 결측 오버라이드 저장소 (SSE 재렌더 시에도 directional 유지)
  let _directionalOverride = { weekly: null, monthly: null, yearly: null };

  // ─── 1일 레이블 ──────────────────────────────────────────────────────────────
  // X축 00:00~23:55 라벨 생성 (288개, 5분 단위)
  function generateTimeLabels() {
    const labels = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 5) {
        labels.push(
          `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
        );
      }
    }
    return labels;
  }

  const ALL_LABELS = generateTimeLabels();

  // ─── 주간 레이블 ─────────────────────────────────────────────────────────────
  // 672개 'YYYY-MM-DD HH:MM' 배열 생성 (15분 단위)
  function generateWeeklyLabels(weekStart) {
    const labels = [];
    const [y, m, d] = weekStart.split('-').map(Number);
    const base = new Date(y, m - 1, d);
    for (let day = 0; day < 7; day++) {
      const dt = new Date(base);
      dt.setDate(dt.getDate() + day);
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      for (let h = 0; h < 24; h++) {
        for (let min = 0; min < 60; min += 15) {
          labels.push(`${dateStr} ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
        }
      }
    }
    return labels;
  }

  // ─── 월간 레이블 ─────────────────────────────────────────────────────────────
  // 해당 월의 시간수만큼 'YYYY-MM-DD HH:00' 배열 생성 (672~744개)
  function generateMonthlyLabels(monthStr) {
    const labels = [];
    const [y, m] = monthStr.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      for (let h = 0; h < 24; h++) {
        labels.push(`${dateStr} ${String(h).padStart(2, '0')}:00`);
      }
    }
    return labels;
  }

  // ─── 유틸 ────────────────────────────────────────────────────────────────────
  // DB 날짜/시간 → "HH:MM" 변환
  function toHHMM(val) {
    if (!val) return null;
    const d = val instanceof Date ? val : new Date(val);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // 마지막 유효 데이터 포인트 인덱스
  function lastValidIndex(values) {
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i] != null) return i;
    }
    return -1;
  }

  // ─── 깜빡임 애니메이션 상태 ──────────────────────────────────────────────────
  let _blinkPhase = 0;
  let _blinkRafId = null;

  const lastPointBlinkPlugin = {
    id: 'lastPointBlink',
    afterDraw(chart) {
      const ctx = chart.ctx;
      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i);
        if (meta.hidden || ds.hidden) return;
        let lastIdx = -1;
        for (let j = ds.data.length - 1; j >= 0; j--) {
          if (ds.data[j] !== null && ds.data[j] !== undefined) { lastIdx = j; break; }
        }
        if (lastIdx < 0) return;
        const pt = meta.data[lastIdx];
        if (!pt) return;
        const { x, y } = pt;
        const color = ds.borderColor;
        // 퍼지는 링
        const r = 14 * _blinkPhase;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 1 - _blinkPhase;
        ctx.stroke();
        ctx.restore();
        // 중심 고정 점
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 1;
        ctx.fill();
        ctx.restore();
      });
    }
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

  // ─── 1일 데이터 빌드 ─────────────────────────────────────────────────────────
  function buildChartData(rows, isToday, nullSlots = []) {
    const map = new Map();
    for (const row of rows) {
      const label = toHHMM(row.TOT_DT);
      if (label) map.set(label, row);
    }

    const nullSet = new Set(nullSlots);

    const now = new Date();
    let cutoff = null;
    if (isToday) {
      if (map.size > 0) {
        cutoff = [...map.keys()].sort().at(-1);
      } else {
        cutoff = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      }
    }

    const values = ALL_LABELS.map(l => {
      const r = map.get(l);
      if (r != null) return r.TRF_QNTY ?? 0;
      if (cutoff !== null && l > cutoff) {
        return nullSet.has(l) ? 0 : null;
      }
      return 0;
    });

    const extendedData = ALL_LABELS.map(l => {
      if (cutoff !== null && l > cutoff) {
        return nullSet.has(l) ? null : undefined;
      }
      return map.get(l) || null;
    });

    return { labels: ALL_LABELS, values, extendedData };
  }

  // ─── 주간 데이터 빌드 ────────────────────────────────────────────────────────
  function buildWeeklyChartData(rows, weekStart, isCurrentWeek, nullSlots = {}) {
    const WEEKLY_LABELS = generateWeeklyLabels(weekStart);

    const map = new Map();
    for (const row of rows) {
      const dt = row.TOT_DT instanceof Date ? row.TOT_DT : new Date(row.TOT_DT);
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(Math.floor(dt.getMinutes() / 15) * 15).padStart(2, '0');
      const label = `${dateStr} ${hh}:${mm}`;
      map.set(label, row);
    }

    // nullSlots 객체 → Set<'YYYY-MM-DD HH:MM'>
    const nullSet = new Set();
    for (const [dateStr, slots] of Object.entries(nullSlots)) {
      for (const slot of slots) {
        nullSet.add(`${dateStr} ${slot}`);
      }
    }

    const now = new Date();
    let cutoff = null;
    if (isCurrentWeek) {
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(Math.floor(now.getMinutes() / 15) * 15).padStart(2, '0');
      cutoff = `${dateStr} ${hh}:${mm}`;
    }

    const values = WEEKLY_LABELS.map(l => {
      const r = map.get(l);
      if (r != null) return r.TRF_QNTY ?? 0;
      if (cutoff !== null && l >= cutoff) return null;
      return 0;
    });

    const extendedData = WEEKLY_LABELS.map(l => {
      if (cutoff !== null && l >= cutoff) return undefined;
      return map.get(l) || null;
    });

    return { labels: WEEKLY_LABELS, values, extendedData };
  }

  // ─── 월간 데이터 빌드 ────────────────────────────────────────────────────────
  function buildMonthlyChartData(rows, monthStr, isCurrentMonth, nullSlots = {}) {
    const MONTHLY_LABELS = generateMonthlyLabels(monthStr);

    const map = new Map();
    for (const row of rows) {
      const dt = row.TOT_DT instanceof Date ? row.TOT_DT : new Date(row.TOT_DT);
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const hh = String(dt.getHours()).padStart(2, '0');
      const dateTimeStr = `${dateStr} ${hh}:00`;
      map.set(dateTimeStr, row);
    }

    // nullSlots { 'YYYY-MM-DD': ['HH:00', ...] } → Set<'YYYY-MM-DD HH:00'>
    const nullSet = new Set();
    for (const [dateStr, slots] of Object.entries(nullSlots)) {
      for (const slot of slots) {
        nullSet.add(`${dateStr} ${slot}`);
      }
    }

    const now = new Date();
    let cutoff = null;
    if (isCurrentMonth) {
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const hh = String(now.getHours()).padStart(2, '0');
      cutoff = `${y}-${m}-${d} ${hh}:00`;
    }

    const values = MONTHLY_LABELS.map(l => {
      const r = map.get(l);
      if (r != null) return r.TRF_QNTY ?? 0;
      if (cutoff !== null && l >= cutoff) return null;
      return 0;
    });

    const extendedData = MONTHLY_LABELS.map(l => {
      if (cutoff !== null && l >= cutoff) return undefined;
      return map.get(l) || null;
    });

    return { labels: MONTHLY_LABELS, values, extendedData };
  }

  // ─── 1일 차트 초기화 ─────────────────────────────────────────────────────────
  function init(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    isCurrentWeekMode = false;

    stopBlink();
    if (chart) {
      chart.destroy();
      chart = null;
    }

    const { labels, values, extendedData } = buildChartData([], true);

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: '교통량',
          data: values,
          extendedData,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37,99,235,0.08)',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          tension: 0.3,
          fill: true,
          spanGaps: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'category',
            ticks: {
              maxRotation: 0,
              autoSkip: false,
              callback(val, index) {
                const label = this.getLabelForValue(index);
                if (!label || !label.endsWith(':00')) return '';
                const hour = parseInt(label.slice(0, 2), 10);
                const w = this.chart.canvas.offsetWidth;
                if (w >= 600) return label;
                if (w >= 400) return hour % 2 === 0 ? label : '';
                return hour % 6 === 0 ? label : '';
              },
              font: { size: 11 },
              color: '#64748b',
            },
            grid: { color: 'rgba(0,0,0,0.05)', drawTicks: false },
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: '교통량 (대)',
              font: { size: 12 },
              color: '#64748b',
            },
            ticks: { font: { size: 11 }, color: '#64748b' },
            grid: { color: 'rgba(0,0,0,0.06)' },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title(items) { return items[0]?.label || ''; },
              label(item) {
                const ext = chart.data.datasets[0].extendedData?.[item.dataIndex];
                if (!ext) return `교통량: ${item.raw ?? '-'}`;
                return [
                  `교통량: ${ext.TRF_QNTY ?? '-'} 대`,
                  `평균속도: ${ext.AVG_SPD ?? '-'} km/h`,
                  `점유율: ${ext.OCPN_RATE ?? '-'} %`,
                  `LOS: ${ext.LOS ?? '-'}`,
                ];
              },
            },
          },
        },
      },
      plugins: [lastPointBlinkPlugin],
    });

    startBlink(chart);

    return chart;
  }

  // ─── 1일 차트 업데이트 ───────────────────────────────────────────────────────
  function update(rows, isToday, nullSlots = []) {
    if (!chart) return;
    const { values, extendedData } = buildChartData(rows, isToday, nullSlots);
    chart.data.datasets[0].data = values;
    chart.data.datasets[0].extendedData = extendedData;
    chart.update();
    renderMissingHeatmap(extendedData);
  }

  // ─── SSE null-slots 반영 (1일) ──────────────────────────────────────────────
  function applyNullSlots(nullSlots, currentDate) {
    if (!chart) return;
    if (!nullSlots || nullSlots.length === 0) return;

    const dataset = chart.data.datasets[0];
    const existingExt = dataset.extendedData || [];
    let changed = false;

    for (const hhmm of nullSlots) {
      const idx = ALL_LABELS.indexOf(hhmm);
      if (idx < 0) continue;
      if (existingExt[idx] === undefined) {
        dataset.data[idx] = 0;
        existingExt[idx] = null;
        changed = true;
      }
    }

    if (changed) {
      dataset.extendedData = existingExt;
      chart.update();
      renderMissingHeatmap(existingExt);
    }
  }

  // ─── SSE 신규 데이터 병합 (1일) ─────────────────────────────────────────────
  function mergeNewRows(newRows, currentNodeId, currentDate, nullSlots = []) {
    if (!chart) return;

    const dataset = chart.data.datasets[0];
    const existingExt = dataset.extendedData || [];

    applyNullSlots(nullSlots, currentDate);

    let updated = false;
    for (const row of newRows) {
      if (row.NODE_ID !== currentNodeId) continue;
      const rowDate = new Date(row.TOT_DT);
      if (rowDate.toISOString().slice(0, 10) !== currentDate) continue;

      const label = toHHMM(row.TOT_DT);
      if (!label) continue;
      const idx = ALL_LABELS.indexOf(label);
      if (idx < 0) continue;

      dataset.data[idx] = row.TRF_QNTY ?? 0;
      existingExt[idx] = row;
      updated = true;
    }

    if (updated) {
      dataset.extendedData = existingExt;
      chart.update();
      renderMissingHeatmap(existingExt);
    }
    return updated;
  }

  // ─── 결측 히트맵 (1일, 6행×48열, column-major) ──────────────────────────────
  function renderMissingHeatmap(extendedData) {
    const container = document.getElementById('heatmapGrid');
    if (!container) return;
    container.innerHTML = '';
    container.className = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'hm-wrapper';

    // 시간 레이블 행 (48열, 매 4열마다 시간 표시 = 매 2시간)
    const labelRow = document.createElement('div');
    labelRow.className = 'hm-label-row';
    labelRow.style.gridTemplateColumns = 'repeat(48, 12px)';
    for (let c = 0; c < 48; c++) {
      const lbl = document.createElement('div');
      lbl.className = 'hm-label';
      if (c % 4 === 0) lbl.textContent = String(c / 2).padStart(2, '0');
      labelRow.appendChild(lbl);
    }
    wrapper.appendChild(labelRow);

    // 6×48 그리드 (column-major: 각 열 = 30분, 6개의 5분 셀)
    const grid = document.createElement('div');
    grid.className = 'hm-grid-day';
    for (let i = 0; i < 288; i++) {
      const cell = document.createElement('div');
      cell.className = 'hm-cell' + (extendedData[i] === null ? ' missing' : '');
      cell.dataset.tooltip = ALL_LABELS[i] || '';
      grid.appendChild(cell);
    }
    wrapper.appendChild(grid);
    container.appendChild(wrapper);
  }

  // ─── 주간 차트 초기화 ────────────────────────────────────────────────────────
  function initWeekly(canvasId, weekStart) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    isCurrentWeekMode = false;
    weeklyWeekStart = weekStart;
    _directionalOverride.weekly = null;

    stopBlink();
    if (chart) {
      chart.destroy();
      chart = null;
    }

    const WEEKLY_LABELS = generateWeeklyLabels(weekStart);
    const values = new Array(672).fill(null);
    const extendedData = new Array(672).fill(undefined);
    const DAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: WEEKLY_LABELS,
        datasets: [{
          label: '교통량',
          data: values,
          extendedData,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37,99,235,0.08)',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          tension: 0.3,
          fill: true,
          spanGaps: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'category',
            ticks: {
              maxRotation: 0,
              autoSkip: false,
              callback(val, index) {
                const label = this.getLabelForValue(index);
                if (!label) return '';
                const parts = label.split(' ');
                const timePart = parts[1] || '';
                const hour = parseInt(timePart.slice(0, 2), 10);
                const min = parseInt(timePart.slice(3, 5), 10);
                const w = this.chart.canvas.offsetWidth;
                if (w >= 700) {
                  if (hour === 0 && min === 0) {
                    const dt = new Date(parts[0] + 'T00:00:00');
                    return DAYS_KO[dt.getDay()];
                  }
                  if (hour === 6 && min === 0) return '06';
                  if (hour === 12 && min === 0) return '12';
                  if (hour === 18 && min === 0) return '18';
                  return '';
                } else if (w >= 420) {
                  if (hour === 0 && min === 0) {
                    const dt = new Date(parts[0] + 'T00:00:00');
                    return DAYS_KO[dt.getDay()];
                  }
                  return '';
                }
                return '';
              },
              font: { size: 11 },
              color: '#64748b',
            },
            grid: { color: 'rgba(0,0,0,0.05)', drawTicks: false },
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: '교통량 (대)',
              font: { size: 12 },
              color: '#64748b',
            },
            ticks: { font: { size: 11 }, color: '#64748b' },
            grid: { color: 'rgba(0,0,0,0.06)' },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title(items) { return items[0]?.label || ''; },
              label(item) {
                const ext = chart.data.datasets[0].extendedData?.[item.dataIndex];
                if (!ext) return `교통량: ${item.raw ?? '-'}`;
                return [
                  `교통량: ${ext.TRF_QNTY ?? '-'} 대`,
                  `평균속도: ${ext.AVG_SPD ?? '-'} km/h`,
                  `점유율: ${ext.OCPN_RATE ?? '-'} %`,
                  `LOS: ${ext.LOS ?? '-'}`,
                ];
              },
            },
          },
        },
      },
      plugins: [lastPointBlinkPlugin],
    });

    if (isCurrentWeekMode) startBlink(chart);

    return chart;
  }

  // ─── 주간 차트 업데이트 ──────────────────────────────────────────────────────
  function updateWeekly(rows, weekStart, isCurrentWeek, nullSlots = {}) {
    if (!chart) return;
    isCurrentWeekMode = isCurrentWeek;
    weeklyWeekStart = weekStart;

    const { values, extendedData } = buildWeeklyChartData(rows, weekStart, isCurrentWeek, nullSlots);
    chart.data.datasets[0].data = values;
    chart.data.datasets[0].extendedData = extendedData;
    chart.update();
    renderWeeklyHeatmap(extendedData, weekStart);
    if (isCurrentWeek) startBlink(chart); else stopBlink();
  }

  // ─── 월간 차트 초기화 ────────────────────────────────────────────────────────
  function initMonthly(canvasId, monthStr) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    isCurrentMonthMode = false;
    monthlyMonthStr = monthStr;
    _directionalOverride.monthly = null;

    stopBlink();
    if (chart) {
      chart.destroy();
      chart = null;
    }

    const MONTHLY_LABELS = generateMonthlyLabels(monthStr);
    const [ym, mm_] = monthStr.split('-').map(Number);
    const daysCount = new Date(ym, mm_, 0).getDate();
    const values = new Array(MONTHLY_LABELS.length).fill(null);
    const extendedData = new Array(MONTHLY_LABELS.length).fill(undefined);

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: MONTHLY_LABELS,
        datasets: [{
          label: '교통량',
          data: values,
          extendedData,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37,99,235,0.08)',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          tension: 0.3,
          fill: true,
          spanGaps: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'category',
            ticks: {
              maxRotation: 0,
              autoSkip: false,
              callback(val, index) {
                const label = this.getLabelForValue(index);
                if (!label) return '';
                const [datePart, timePart] = label.split(' ');
                if (timePart !== '00:00') return '';
                const [, mm, dd] = datePart.split('-');
                const day = parseInt(dd, 10);
                const w = this.chart.canvas.offsetWidth;
                if (w >= 600) {
                  return [1, 5, 10, 15, 20, 25, daysCount].includes(day) ? `${mm}.${dd}` : '';
                } else if (w >= 400) {
                  return [1, 10, 20, daysCount].includes(day) ? `${mm}.${dd}` : '';
                } else {
                  return [1, 15].includes(day) ? `${mm}.${dd}` : '';
                }
              },
              font: { size: 11 },
              color: '#64748b',
            },
            grid: { color: 'rgba(0,0,0,0.05)', drawTicks: false },
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: '교통량 (대)',
              font: { size: 12 },
              color: '#64748b',
            },
            ticks: { font: { size: 11 }, color: '#64748b' },
            grid: { color: 'rgba(0,0,0,0.06)' },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title(items) { return items[0]?.label || ''; },
              label(item) {
                const ext = chart.data.datasets[0].extendedData?.[item.dataIndex];
                if (!ext) return `교통량: ${item.raw ?? '-'}`;
                return [
                  `교통량: ${ext.TRF_QNTY ?? '-'} 대`,
                  `평균속도: ${ext.AVG_SPD ?? '-'} km/h`,
                  `점유율: ${ext.OCPN_RATE ?? '-'} %`,
                  `LOS: ${ext.LOS ?? '-'}`,
                ];
              },
            },
          },
        },
      },
      plugins: [lastPointBlinkPlugin],
    });

    if (isCurrentMonthMode) startBlink(chart);

    return chart;
  }

  // ─── 월간 차트 업데이트 ──────────────────────────────────────────────────────
  function updateMonthly(rows, monthStr, isCurrentMonth, nullSlots = []) {
    if (!chart) return;
    isCurrentMonthMode = isCurrentMonth;
    monthlyMonthStr = monthStr;

    const { values, extendedData } = buildMonthlyChartData(rows, monthStr, isCurrentMonth, nullSlots);
    chart.data.datasets[0].data = values;
    chart.data.datasets[0].extendedData = extendedData;
    chart.update();
    renderMonthlyHeatmap(extendedData, monthStr);
    if (isCurrentMonth) startBlink(chart); else stopBlink();
  }

  // ─── SSE hourly-null-slots 반영 (주간) ──────────────────────────────────────
  // nullSlotsObj: { 'YYYY-MM-DD': ['HH:00', ...] }
  function applyHourlyNullSlots(nullSlotsObj, weekStart) {
    if (!chart || !nullSlotsObj) return;

    const WEEKLY_LABELS = generateWeeklyLabels(weekStart);
    const dataset = chart.data.datasets[0];
    const existingExt = dataset.extendedData || [];
    let changed = false;

    for (const [dateStr, slots] of Object.entries(nullSlotsObj)) {
      for (const hhmm of slots) {
        const label = `${dateStr} ${hhmm}`;
        const idx = WEEKLY_LABELS.indexOf(label);
        if (idx < 0) continue;
        if (existingExt[idx] === undefined) {
          dataset.data[idx] = 0;
          existingExt[idx] = null;
          changed = true;
        }
      }
    }

    if (changed) {
      dataset.extendedData = existingExt;
      chart.update();
      renderWeeklyHeatmap(existingExt, weekStart);
    }
  }

  // ─── SSE 신규 데이터 병합 (주간) ────────────────────────────────────────────
  function mergeNewHourlyRows(newRows, nodeId, weekStart, nullSlotsObj = {}) {
    if (!chart) return;

    const WEEKLY_LABELS = generateWeeklyLabels(weekStart);
    const dataset = chart.data.datasets[0];
    const existingExt = dataset.extendedData || [];

    applyHourlyNullSlots(nullSlotsObj, weekStart);

    let updated = false;
    for (const row of newRows) {
      if (row.NODE_ID !== nodeId) continue;
      const dt = row.TOT_DT instanceof Date ? row.TOT_DT : new Date(row.TOT_DT);
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(Math.floor(dt.getMinutes() / 15) * 15).padStart(2, '0');
      const label = `${dateStr} ${hh}:${mm}`;
      const idx = WEEKLY_LABELS.indexOf(label);
      if (idx < 0) continue;

      dataset.data[idx] = row.TRF_QNTY ?? 0;
      existingExt[idx] = row;
      updated = true;
    }

    if (updated) {
      dataset.extendedData = existingExt;
      chart.update();
      renderWeeklyHeatmap(existingExt, weekStart);
    }
    return updated;
  }

  // ─── 결측 히트맵 (1주, 6행×112열, column-major, 1셀=15분) ───────────────────
  function renderWeeklyHeatmap(extendedData, weekStart) {
    const container = document.getElementById('heatmapGrid');
    if (!container) return;
    container.innerHTML = '';
    container.className = '';

    const DAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
    const [sy, sm, sd] = weekStart.split('-').map(Number);

    const wrapper = document.createElement('div');
    wrapper.className = 'hm-wrapper';

    // 요일 레이블 행 (84열, 매 12열마다 요일)
    const labelRow = document.createElement('div');
    labelRow.className = 'hm-label-row';
    labelRow.style.gridTemplateColumns = 'repeat(84, 12px)';
    for (let c = 0; c < 84; c++) {
      const lbl = document.createElement('div');
      lbl.className = 'hm-label';
      if (c % 12 === 0) {
        const dayIdx = c / 12;
        const dt = new Date(sy, sm - 1, sd + dayIdx);
        lbl.textContent = DAYS_KO[dt.getDay()];
      }
      labelRow.appendChild(lbl);
    }
    wrapper.appendChild(labelRow);

    // 8행 × 84열 그리드 (column-major: 각 열 = 8슬롯×15분=120분, 12열/일)
    const grid = document.createElement('div');
    grid.className = 'hm-grid-week';
    for (let i = 0; i < 672; i++) {
      const ext = extendedData[i];
      const isMissing = ext === null;
      const isNormal = ext !== null && ext !== undefined;

      const cell = document.createElement('div');
      cell.className = 'hm-cell' + (isMissing ? ' missing' : '');
      const dayIdx = Math.floor(i / 96);
      const slotInDay = i % 96;
      const hour = Math.floor(slotInDay / 4);
      const min = (slotInDay % 4) * 15;
      const dt = new Date(sy, sm - 1, sd + dayIdx);
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');

      let tooltipText = `${mm}.${dd} ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      cell.dataset.tooltip = tooltipText;
      grid.appendChild(cell);
    }
    wrapper.appendChild(grid);
    container.appendChild(wrapper);

    // SSE 재렌더 시 방향별 오버라이드 적용
    if (_directionalOverride.weekly?.weekStart === weekStart) {
      renderMissingHeatmapDirectionalWeekly(_directionalOverride.weekly.missingData, weekStart);
    }
  }

  // ─── 결측 히트맵 (1달, N행×24열) ────────────────────────────────────────────
  function renderMonthlyHeatmap(extendedData, monthStr) {
    const container = document.getElementById('heatmapGrid');
    if (!container) return;
    container.innerHTML = '';
    container.className = '';

    const MONTHLY_LABELS = generateMonthlyLabels(monthStr);
    const [y, m] = monthStr.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const totalCols = daysInMonth * 3;

    const wrapper = document.createElement('div');
    wrapper.className = 'hm-wrapper';

    // 레이블 행: daysInMonth×3 열, 매 3열마다 날짜 표시
    const labelRow = document.createElement('div');
    labelRow.className = 'hm-label-row';
    labelRow.style.gridTemplateColumns = `repeat(${totalCols}, 12px)`;
    for (let c = 0; c < totalCols; c++) {
      const lbl = document.createElement('div');
      lbl.className = 'hm-label';
      if (c % 3 === 0) lbl.textContent = String(c / 3 + 1);
      labelRow.appendChild(lbl);
    }
    wrapper.appendChild(labelRow);

    // 8행 × N×3열 그리드 (column-major)
    const grid = document.createElement('div');
    grid.className = 'hm-grid-month';
    for (let i = 0; i < MONTHLY_LABELS.length; i++) {
      const cell = document.createElement('div');
      const isMissing = extendedData[i] === null;
      const isNormal = extendedData[i] !== null && extendedData[i] !== undefined;

      cell.className = 'hm-cell' + (isMissing ? ' missing' : '');
      const label = MONTHLY_LABELS[i] || '';
      if (label) {
        const [datePart, timePart] = label.split(' ');
        const [, mm, dd] = datePart.split('-');
        cell.dataset.tooltip = `${mm}.${dd} ${timePart}`;
      }
      grid.appendChild(cell);
    }
    wrapper.appendChild(grid);
    container.appendChild(wrapper);

    // SSE 재렌더 시 방향별 오버라이드 적용
    if (_directionalOverride.monthly?.monthStr === monthStr) {
      renderMissingHeatmapDirectionalMonthly(_directionalOverride.monthly.missingData, monthStr);
    }
  }

  // ─── SSE hourly-null-slots 반영 (월간) ─────────────────────────────────────
  // nullSlotsObj: { 'YYYY-MM-DD': ['HH:00', ...] }
  function applyDailyNullSlots(nullSlotsObj, monthStr) {
    if (!chart || !nullSlotsObj) return;

    const MONTHLY_LABELS = generateMonthlyLabels(monthStr);
    const dataset = chart.data.datasets[0];
    const existingExt = dataset.extendedData || [];
    let changed = false;

    for (const [dateStr, slots] of Object.entries(nullSlotsObj)) {
      for (const hhmm of slots) {
        const label = `${dateStr} ${hhmm}`;
        const idx = MONTHLY_LABELS.indexOf(label);
        if (idx < 0) continue;
        if (existingExt[idx] === undefined) {
          dataset.data[idx] = 0;
          existingExt[idx] = null;
          changed = true;
        }
      }
    }

    if (changed) {
      dataset.extendedData = existingExt;
      chart.update();
      renderMonthlyHeatmap(existingExt, monthStr);
    }
  }

  // ─── SSE 신규 데이터 병합 (월간) ────────────────────────────────────────────
  function mergeNewDailyRows(newRows, nodeId, monthStr, nullSlotsObj = {}) {
    if (!chart) return;

    const MONTHLY_LABELS = generateMonthlyLabels(monthStr);
    const dataset = chart.data.datasets[0];
    const existingExt = dataset.extendedData || [];

    applyDailyNullSlots(nullSlotsObj, monthStr);

    let updated = false;
    for (const row of newRows) {
      if (row.NODE_ID !== nodeId) continue;
      const dt = row.TOT_DT instanceof Date ? row.TOT_DT : new Date(row.TOT_DT);
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const hh = String(dt.getHours()).padStart(2, '0');
      const dateTimeStr = `${dateStr} ${hh}:00`;
      const idx = MONTHLY_LABELS.indexOf(dateTimeStr);
      if (idx < 0) continue;

      dataset.data[idx] = row.TRF_QNTY ?? 0;
      existingExt[idx] = row;
      updated = true;
    }

    if (updated) {
      dataset.extendedData = existingExt;
      chart.update();
      renderMonthlyHeatmap(existingExt, monthStr);
    }
    return updated;
  }

  // ─── 연간 레이블 ─────────────────────────────────────────────────────────────
  // 365/366개 'YYYY-MM-DD' 배열 생성
  function generateYearlyLabels(yearStr) {
    const labels = [];
    const y = parseInt(yearStr, 10);
    for (let d = 0; ; d++) {
      const dt = new Date(y, 0, 1 + d);
      if (dt.getFullYear() !== y) break;
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      labels.push(`${y}-${mm}-${dd}`);
    }
    return labels;
  }

  // ─── 연간 히트맵 그리드 빌더 (home.js buildYearGrid 동일 로직) ───────────────
  const HM_MONTH_LABELS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

  function buildYearGridHeatmap(yearStr) {
    const y = parseInt(yearStr, 10);
    const jan1 = new Date(y, 0, 1);
    const gridStart = new Date(jan1);
    gridStart.setDate(jan1.getDate() - jan1.getDay());
    const dec31 = new Date(y, 11, 31);
    const gridEnd = new Date(dec31);
    gridEnd.setDate(dec31.getDate() + (6 - dec31.getDay()));
    const totalDays = Math.round((gridEnd - gridStart) / 86400000) + 1;
    const totalWeeks = Math.round(totalDays / 7);

    const cells = [];
    const cur = new Date(gridStart);
    for (let i = 0; i < totalDays; i++) {
      const inYear = cur.getFullYear() === y;
      const mm = String(cur.getMonth() + 1).padStart(2, '0');
      const dd = String(cur.getDate()).padStart(2, '0');
      cells.push({
        date: new Date(cur),
        slotKey: inYear ? `${y}-${mm}-${dd}` : null,
        isCurrentYear: inYear,
        dayOfWeek: cur.getDay(),
        weekIdx: Math.floor(i / 7),
      });
      cur.setDate(cur.getDate() + 1);
    }

    const monthLabels = [];
    for (let m = 0; m < 12; m++) {
      const ms = new Date(y, m, 1);
      const weekIdx = Math.floor(Math.round((ms - gridStart) / 86400000) / 7);
      monthLabels.push({ weekIdx, label: HM_MONTH_LABELS[m] });
    }

    return { cells, monthLabels, totalWeeks };
  }

  // ─── 연간 데이터 빌드 ────────────────────────────────────────────────────────
  function buildYearlyChartData(rows, yearStr, isCurrentYear) {
    const YEARLY_LABELS = generateYearlyLabels(yearStr);

    const map = new Map();
    for (const row of rows) {
      const dt = row.TOT_DT instanceof Date ? row.TOT_DT : new Date(row.TOT_DT);
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      map.set(dateStr, row);
    }

    const now = new Date();
    let cutoff = null;
    if (isCurrentYear) {
      cutoff = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    const values = YEARLY_LABELS.map(l => {
      const r = map.get(l);
      if (r != null) return r.TRF_QNTY ?? 0;
      if (cutoff !== null && l >= cutoff) return null;
      return 0;
    });

    const extendedData = YEARLY_LABELS.map(l => {
      if (cutoff !== null && l >= cutoff) return undefined;
      return map.get(l) || null;
    });

    return { labels: YEARLY_LABELS, values, extendedData };
  }

  // ─── 연간 차트 초기화 ────────────────────────────────────────────────────────
  function initYearly(canvasId, yearStr) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    isCurrentYearMode = false;
    yearlyYearStr = yearStr;
    _directionalOverride.yearly = null;

    stopBlink();
    if (chart) { chart.destroy(); chart = null; }

    const YEARLY_LABELS = generateYearlyLabels(yearStr);
    const values = new Array(YEARLY_LABELS.length).fill(null);
    const extendedData = new Array(YEARLY_LABELS.length).fill(undefined);

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: YEARLY_LABELS,
        datasets: [{
          label: '교통량',
          data: values,
          extendedData,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37,99,235,0.08)',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          tension: 0.3,
          fill: true,
          spanGaps: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'category',
            ticks: {
              maxRotation: 0,
              autoSkip: false,
              callback(val, index) {
                const label = this.getLabelForValue(index);
                if (!label) return '';
                const [, mm, dd] = label.split('-');
                if (dd === '01') return `${mm}월`;
                return '';
              },
              font: { size: 11 },
              color: '#64748b',
            },
            grid: { color: 'rgba(0,0,0,0.05)', drawTicks: false },
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: '교통량 (대)',
              font: { size: 12 },
              color: '#64748b',
            },
            ticks: { font: { size: 11 }, color: '#64748b' },
            grid: { color: 'rgba(0,0,0,0.06)' },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title(items) { return items[0]?.label || ''; },
              label(item) {
                const ext = chart.data.datasets[0].extendedData?.[item.dataIndex];
                if (!ext) return `교통량: ${item.raw ?? '-'}`;
                return [
                  `교통량: ${ext.TRF_QNTY ?? '-'} 대`,
                  `평균속도: ${ext.AVG_SPD ?? '-'} km/h`,
                  `점유율: ${ext.OCPN_RATE ?? '-'} %`,
                  `LOS: ${ext.LOS ?? '-'}`,
                ];
              },
            },
          },
        },
      },
      plugins: [lastPointBlinkPlugin],
    });

    if (isCurrentYearMode) startBlink(chart);

    return chart;
  }

  // ─── 연간 차트 업데이트 ──────────────────────────────────────────────────────
  function updateYearly(rows, yearStr, isCurrentYear, nullSlots = []) {
    if (!chart) return;
    isCurrentYearMode = isCurrentYear;
    yearlyYearStr = yearStr;

    const { values, extendedData } = buildYearlyChartData(rows, yearStr, isCurrentYear);
    chart.data.datasets[0].data = values;
    chart.data.datasets[0].extendedData = extendedData;

    // null slots 반영
    const YEARLY_LABELS = generateYearlyLabels(yearStr);
    const nullSet = new Set(nullSlots);
    for (const dateStr of nullSet) {
      const idx = YEARLY_LABELS.indexOf(dateStr);
      if (idx >= 0 && extendedData[idx] === undefined) {
        values[idx] = 0;
        extendedData[idx] = null;
      }
    }

    chart.update();
    renderYearlyHeatmap(extendedData, yearStr);
    if (isCurrentYear) startBlink(chart); else stopBlink();
  }

  // ─── 결측 히트맵 (1년, GitHub 잔디 스타일) ──────────────────────────────────
  function renderYearlyHeatmap(extendedData, yearStr) {
    const container = document.getElementById('heatmapGrid');
    if (!container) return;
    container.innerHTML = '';
    container.className = '';

    const YEARLY_LABELS = generateYearlyLabels(yearStr);
    const { cells, monthLabels, totalWeeks } = buildYearGridHeatmap(yearStr);
    const colWidth = 14;
    const DOW_KR = ['일', '', '화', '', '목', '', '토'];

    const wrapper = document.createElement('div');
    wrapper.className = 'hm-wrapper';

    const outer = document.createElement('div');
    outer.className = 'gh-heatmap-container';

    // 월 레이블 행
    const monthRow = document.createElement('div');
    monthRow.className = 'gh-month-row';
    monthRow.style.gridTemplateColumns = `repeat(${totalWeeks}, ${colWidth}px)`;
    for (const { weekIdx, label } of monthLabels) {
      const lbl = document.createElement('div');
      lbl.className = 'gh-month-label';
      lbl.style.gridColumn = String(weekIdx + 1);
      lbl.textContent = label;
      monthRow.appendChild(lbl);
    }
    outer.appendChild(monthRow);

    // 그리드 본체 (7행 × totalWeeks열 + 요일 레이블 1열)
    const grid = document.createElement('div');
    grid.className = 'gh-heatmap-grid';
    grid.style.gridTemplateColumns = `24px repeat(${totalWeeks}, ${colWidth}px)`;

    // 요일 레이블
    for (let dow = 0; dow < 7; dow++) {
      const lbl = document.createElement('div');
      lbl.className = 'gh-day-label';
      lbl.style.gridColumn = '1';
      lbl.style.gridRow = String(dow + 1);
      lbl.textContent = DOW_KR[dow];
      grid.appendChild(lbl);
    }

    // 셀 (결측 여부에 따라 색상 적용)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const cell of cells) {
      const div = document.createElement('div');
      div.style.gridColumn = String(cell.weekIdx + 2);
      div.style.gridRow = String(cell.dayOfWeek + 1);

      if (!cell.isCurrentYear) {
        div.className = 'gh-cell-pad';
      } else {
        const idx = YEARLY_LABELS.indexOf(cell.slotKey);
        const val = idx >= 0 ? extendedData[idx] : undefined;
        const isFuture = cell.date > today;
        const [, mm, dd] = cell.slotKey.split('-');

        div.className = 'hm-cell';
        div.dataset.tooltip = `${mm}.${dd}`;

        if (isFuture) {
          div.style.opacity = '0.3';
        } else if (val === null) {
          div.classList.add('missing');
        }
      }
      grid.appendChild(div);
    }

    outer.appendChild(grid);
    wrapper.appendChild(outer);
    container.appendChild(wrapper);

    // SSE 재렌더 시 방향별 오버라이드 적용
    if (_directionalOverride.yearly?.yearStr === yearStr) {
      renderMissingHeatmapDirectionalYearly(_directionalOverride.yearly.missingData, yearStr);
    }
  }

  // ─── SSE daily-null-slots 반영 (연간) ───────────────────────────────────────
  function applyDailyNullSlotsYearly(nullDates, yearStr) {
    if (!chart || !nullDates) return;

    const YEARLY_LABELS = generateYearlyLabels(yearStr);
    const dataset = chart.data.datasets[0];
    const existingExt = dataset.extendedData || [];
    let changed = false;

    const nullSet = new Set(nullDates);
    for (const dateStr of nullSet) {
      const idx = YEARLY_LABELS.indexOf(dateStr);
      if (idx < 0) continue;
      if (existingExt[idx] === undefined) {
        dataset.data[idx] = 0;
        existingExt[idx] = null;
        changed = true;
      }
    }

    if (changed) {
      dataset.extendedData = existingExt;
      chart.update();
      renderYearlyHeatmap(existingExt, yearStr);
    }
  }

  // ─── SSE 신규 데이터 병합 (연간) ────────────────────────────────────────────
  function mergeNewDailyRowsYearly(newRows, nodeId, yearStr, nullDates = []) {
    if (!chart) return;

    const YEARLY_LABELS = generateYearlyLabels(yearStr);
    const dataset = chart.data.datasets[0];
    const existingExt = dataset.extendedData || [];

    applyDailyNullSlotsYearly(nullDates, yearStr);

    let updated = false;
    for (const row of newRows) {
      if (row.NODE_ID !== nodeId) continue;
      const dt = row.TOT_DT instanceof Date ? row.TOT_DT : new Date(row.TOT_DT);
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const idx = YEARLY_LABELS.indexOf(dateStr);
      if (idx < 0) continue;

      dataset.data[idx] = row.TRF_QNTY ?? 0;
      existingExt[idx] = row;
      updated = true;
    }

    if (updated) {
      dataset.extendedData = existingExt;
      chart.update();
      renderYearlyHeatmap(existingExt, yearStr);
    }
    return updated;
  }

  // ─── 차트 파괴 ───────────────────────────────────────────────────────────────
  function destroy() {
    stopBlink();
    if (chart) {
      chart.destroy();
      chart = null;
    }
    const container = document.getElementById('heatmapGrid');
    if (container) container.innerHTML = '';
    isCurrentWeekMode = false;
    weeklyWeekStart = null;
    isCurrentMonthMode = false;
    monthlyMonthStr = null;
    isCurrentYearMode = false;
    yearlyYearStr = null;
    _directionalOverride = { weekly: null, monthly: null, yearly: null };
  }

  // ─── 결측 히트맵 (방향별 데이터 기반, 1일 288셀) ────────────────────────────
  function renderMissingHeatmapDirectional(missingData) {
    const container = document.getElementById('heatmapGrid');
    if (!container) return;
    container.innerHTML = '';
    container.className = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'hm-wrapper';

    // 시간 레이블 행 (48열, 매 4열 = 2시간)
    const labelRow = document.createElement('div');
    labelRow.className = 'hm-label-row';
    labelRow.style.gridTemplateColumns = 'repeat(48, 12px)';
    for (let c = 0; c < 48; c++) {
      const lbl = document.createElement('div');
      lbl.className = 'hm-label';
      if (c % 4 === 0) lbl.textContent = String(c / 2).padStart(2, '0');
      labelRow.appendChild(lbl);
    }
    wrapper.appendChild(labelRow);

    // 6×48 그리드 (column-major)
    const grid = document.createElement('div');
    grid.className = 'hm-grid-day';
    for (let i = 0; i < 288; i++) {
      const cell = document.createElement('div');
      const md = missingData[i];
      const isMissing = md != null && typeof md === 'object' && md.directions?.length > 0;
      cell.className = 'hm-cell' + (isMissing ? ' missing' : '');
      cell.dataset.tooltip = isMissing
        ? `${ALL_LABELS[i]}\n${md.directions.join('\n')}`
        : (ALL_LABELS[i] || '');
      grid.appendChild(cell);
    }
    wrapper.appendChild(grid);
    container.appendChild(wrapper);
  }

  // ─── 결측 히트맵 (방향별, 1주, 8행×21열, column-major, 1셀=1시간) ────────────
  function renderMissingHeatmapDirectionalWeekly(missingData, weekStart) {
    _directionalOverride.weekly = { weekStart, missingData };

    const container = document.getElementById('heatmapGrid');
    if (!container) return;
    container.innerHTML = '';
    container.className = '';

    const DAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
    const [sy, sm, sd] = weekStart.split('-').map(Number);

    const wrapper = document.createElement('div');
    wrapper.className = 'hm-wrapper';

    // 요일 레이블 행 (84열, 매 12열마다 요일)
    const labelRow = document.createElement('div');
    labelRow.className = 'hm-label-row';
    labelRow.style.gridTemplateColumns = 'repeat(84, 12px)';
    for (let c = 0; c < 84; c++) {
      const lbl = document.createElement('div');
      lbl.className = 'hm-label';
      if (c % 12 === 0) {
        const dayIdx = c / 12;
        const dt = new Date(sy, sm - 1, sd + dayIdx);
        lbl.textContent = DAYS_KO[dt.getDay()];
      }
      labelRow.appendChild(lbl);
    }
    wrapper.appendChild(labelRow);

    // 8행 × 84열 그리드 (column-major)
    const grid = document.createElement('div');
    grid.className = 'hm-grid-week';
    for (let i = 0; i < 672; i++) {
      const cell = document.createElement('div');
      const md = missingData[i];
      const isMissing = md?.directions?.length > 0;
      const isNormal = md === null;

      cell.className = 'hm-cell' + (isMissing ? ' missing' : '');
      const dayIdx = Math.floor(i / 96);
      const slotInDay = i % 96;
      const hour = Math.floor(slotInDay / 4);
      const min = (slotInDay % 4) * 15;
      const dt = new Date(sy, sm - 1, sd + dayIdx);
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');

      const timeStr = `${mm}.${dd} ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      cell.dataset.tooltip = isMissing ? `${timeStr}\n${md.directions.join('\n')}` : timeStr;
      grid.appendChild(cell);
    }
    wrapper.appendChild(grid);
    container.appendChild(wrapper);
  }

  // ─── 결측 히트맵 (방향별, 1달, 8행×N×3열, column-major) ──────────────────────
  function renderMissingHeatmapDirectionalMonthly(missingData, monthStr) {
    _directionalOverride.monthly = { monthStr, missingData };

    const container = document.getElementById('heatmapGrid');
    if (!container) return;
    container.innerHTML = '';
    container.className = '';

    const MONTHLY_LABELS = generateMonthlyLabels(monthStr);
    const [y, m] = monthStr.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const totalCols = daysInMonth * 3;

    const wrapper = document.createElement('div');
    wrapper.className = 'hm-wrapper';

    // 레이블 행: 매 3열마다 날짜 표시
    const labelRow = document.createElement('div');
    labelRow.className = 'hm-label-row';
    labelRow.style.gridTemplateColumns = `repeat(${totalCols}, 12px)`;
    for (let c = 0; c < totalCols; c++) {
      const lbl = document.createElement('div');
      lbl.className = 'hm-label';
      if (c % 3 === 0) lbl.textContent = String(c / 3 + 1);
      labelRow.appendChild(lbl);
    }
    wrapper.appendChild(labelRow);

    // 8행 × N×3열 그리드 (column-major)
    const grid = document.createElement('div');
    grid.className = 'hm-grid-month';
    for (let i = 0; i < MONTHLY_LABELS.length; i++) {
      const cell = document.createElement('div');
      const md = missingData[i];
      const isMissing = md != null && typeof md === 'object' && md.directions?.length > 0;
      const isNormal = md === null;

      cell.className = 'hm-cell' + (isMissing ? ' missing' : '');
      const label = MONTHLY_LABELS[i] || '';
      if (label) {
        const [datePart, timePart] = label.split(' ');
        const [, mm, dd] = datePart.split('-');

        cell.dataset.tooltip = isMissing
          ? `${mm}.${dd} ${timePart}\n${md.directions.join('\n')}`
          : `${mm}.${dd} ${timePart}`;
      }
      grid.appendChild(cell);
    }
    wrapper.appendChild(grid);
    container.appendChild(wrapper);
  }

  // ─── 결측 히트맵 (방향별, 1년, GitHub 잔디 스타일) ──────────────────────────
  function renderMissingHeatmapDirectionalYearly(missingData, yearStr) {
    _directionalOverride.yearly = { yearStr, missingData };

    const container = document.getElementById('heatmapGrid');
    if (!container) return;
    container.innerHTML = '';
    container.className = '';

    const YEARLY_LABELS = generateYearlyLabels(yearStr);
    const { cells, monthLabels, totalWeeks } = buildYearGridHeatmap(yearStr);
    const colWidth = 14;
    const DOW_KR = ['일', '', '화', '', '목', '', '토'];

    const wrapper = document.createElement('div');
    wrapper.className = 'hm-wrapper';

    const outer = document.createElement('div');
    outer.className = 'gh-heatmap-container';

    const monthRow = document.createElement('div');
    monthRow.className = 'gh-month-row';
    monthRow.style.gridTemplateColumns = `repeat(${totalWeeks}, ${colWidth}px)`;
    for (const { weekIdx, label } of monthLabels) {
      const lbl = document.createElement('div');
      lbl.className = 'gh-month-label';
      lbl.style.gridColumn = String(weekIdx + 1);
      lbl.textContent = label;
      monthRow.appendChild(lbl);
    }
    outer.appendChild(monthRow);

    const grid = document.createElement('div');
    grid.className = 'gh-heatmap-grid';
    grid.style.gridTemplateColumns = `24px repeat(${totalWeeks}, ${colWidth}px)`;

    for (let dow = 0; dow < 7; dow++) {
      const lbl = document.createElement('div');
      lbl.className = 'gh-day-label';
      lbl.style.gridColumn = '1';
      lbl.style.gridRow = String(dow + 1);
      lbl.textContent = DOW_KR[dow];
      grid.appendChild(lbl);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const cell of cells) {
      const div = document.createElement('div');
      div.style.gridColumn = String(cell.weekIdx + 2);
      div.style.gridRow = String(cell.dayOfWeek + 1);

      if (!cell.isCurrentYear) {
        div.className = 'gh-cell-pad';
      } else {
        const idx = YEARLY_LABELS.indexOf(cell.slotKey);
        const md = idx >= 0 ? missingData[idx] : undefined;
        const isFuture = cell.date > today;
        const [, mm, dd] = cell.slotKey.split('-');
        const isMissing = md != null && typeof md === 'object' && md.directions?.length > 0;
        const isNormal = !isFuture && md === null;

        div.className = 'hm-cell';

        div.dataset.tooltip = isMissing
          ? `${mm}.${dd}\n${md.directions.join('\n')}`
          : `${mm}.${dd}`;

        if (isFuture) {
          div.style.opacity = '0.3';
        } else if (isMissing) {
          div.classList.add('missing');
        }
      }
      grid.appendChild(div);
    }

    outer.appendChild(grid);
    wrapper.appendChild(outer);
    container.appendChild(wrapper);
  }

  // ─── 플로팅 툴팁 초기화 ─────────────────────────────────────────────────────
  function initHeatmapTooltip() {
    if (document.getElementById('hm-floating-tip')) return;
    const tip = document.createElement('div');
    tip.id = 'hm-floating-tip';
    tip.style.cssText = 'position:fixed;display:none;z-index:9999;background:#1e293b;color:#fff;padding:3px 8px;border-radius:4px;font-size:10px;white-space:pre;pointer-events:none;line-height:1.5;';
    document.body.appendChild(tip);
    document.addEventListener('mouseover', e => {
      const cell = e.target.closest('.hm-cell[data-tooltip]');
      if (!cell) return;
      tip.textContent = cell.dataset.tooltip;
      tip.style.display = 'block';
    });
    document.addEventListener('mousemove', e => {
      if (tip.style.display === 'none') return;
      tip.style.left = (e.clientX + 12) + 'px';
      tip.style.top = (e.clientY - 28) + 'px';
    });
    document.addEventListener('mouseout', e => {
      if (e.target.closest('.hm-cell[data-tooltip]')) tip.style.display = 'none';
    });
  }

  initHeatmapTooltip();

  return {
    init,
    update,
    mergeNewRows,
    applyNullSlots,
    initWeekly,
    updateWeekly,
    mergeNewHourlyRows,
    applyHourlyNullSlots,
    initMonthly,
    updateMonthly,
    applyDailyNullSlots,
    mergeNewDailyRows,
    renderMonthlyHeatmap,
    initYearly,
    updateYearly,
    renderYearlyHeatmap,
    applyDailyNullSlotsYearly,
    mergeNewDailyRowsYearly,
    destroy,
    renderMissingHeatmap,
    renderWeeklyHeatmap,
    renderMissingHeatmapDirectional,
    renderMissingHeatmapDirectionalWeekly,
    renderMissingHeatmapDirectionalMonthly,
    renderMissingHeatmapDirectionalYearly,
  };
})();
