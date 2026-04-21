'use strict';

/**
 * 방향별(접근로별) 다중 라인 차트 관리
 * 1일(5분) / 1주(15분) / 1달(1시간) / 1년(1일) 모드 지원
 */
const DirectionChartManager = (() => {
  let chart = null;

  // ─── 방향별 결측 상태 ─────────────────────────────────────────────────────────
  let _currentApproaches = [];   // init() 시 저장
  let _currentMissingData = [];  // 슬롯별 결측 정보 (288개)

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
          if (ds.data[j] !== null && ds.data[j] !== undefined) {
            lastIdx = j; break;
          }
        }
        if (lastIdx < 0) return;

        const pt = meta.data[lastIdx];
        if (!pt) return;
        const { x, y } = pt;
        const color = ds.borderColor;

        // 퍼지는 링
        const maxR = 14;
        const r = maxR * _blinkPhase;
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

  // ─── 레이블 ──────────────────────────────────────────────────────────────────
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

  // ─── 주간 레이블 (672개, 15분 단위) ──────────────────────────────────────────
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

  // ─── 월간 레이블 (days×24개, 1시간 단위) ────────────────────────────────────
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

  // ─── 연간 레이블 (365/366개, 1일 단위) ──────────────────────────────────────
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

  // ─── 유틸 ────────────────────────────────────────────────────────────────────
  function toHHMM(val) {
    if (!val) return null;
    const d = val instanceof Date ? val : new Date(val);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // ─── 색상 결정 ───────────────────────────────────────────────────────────────
  const COLOR_MAP = { '북': '#ef4444', '남': '#3b82f6', '동': '#22c55e', '서': '#eab308' };
  const DIR_CHARS = '북남동서';

  const PALETTE = [
    '#ef4444', // 빨강  (북 기본)
    '#3b82f6', // 파랑  (남 기본)
    '#22c55e', // 초록  (동 기본)
    '#eab308', // 노랑  (서 기본)
    '#8b5cf6', // 보라
    '#06b6d4', // 시안
    '#ec4899', // 핑크
    '#84cc16', // 라임
    '#f97316', // 오렌지
    '#14b8a6', // 틸
    '#6366f1', // 인디고
    '#f43f5e', // 로즈
  ];

  // 특정 접근로 이름에 대한 색상 강제 지정 (로직으로 해결 불가한 예외 케이스)
  const NAME_COLOR_OVERRIDES = {};

  function assignApproachColors(approaches) {
    const result = new Map();
    const usedColors = new Set();

    // 0순위: 이름 기반 오버라이드 먼저 적용
    for (const ap of approaches) {
      if (NAME_COLOR_OVERRIDES[ap.name]) {
        result.set(ap.acsrId, NAME_COLOR_OVERRIDES[ap.name]);
        usedColors.add(NAME_COLOR_OVERRIDES[ap.name]);
      }
    }

    // 1순위: 각 방향의 이름에서 첫 번째 방향 글자를 우선 매핑 (북, 남, 동, 서)
    // 만약 이미 사용 중이라면 두 번째 방향 글자를 시도.
    for (const ap of approaches) {
      if (result.has(ap.acsrId)) continue;  // 오버라이드 적용된 항목 건너뜀
      const namePart = ap.name.includes('-') ? ap.name.split('-').slice(1).join('-') : ap.name;
      const dirChars = [...namePart].filter(c => DIR_CHARS.includes(c));
      let assigned = false;

      for (const char of dirChars) {
        const color = COLOR_MAP[char];
        if (color && !usedColors.has(color)) {
          result.set(ap.acsrId, color);
          usedColors.add(color);
          assigned = true;
          break;
        }
      }

      if (!assigned) {
        result.set(ap.acsrId, null);
      }
    }

    // 2순위: 위에서 색상을 배정받지 못한 방향들에 대해 PALETTE에서 남은 색상 순차 할당
    let pi = 0;
    for (const ap of approaches) {
      if (result.get(ap.acsrId) === null) {
        while (pi < PALETTE.length && usedColors.has(PALETTE[pi])) {
          pi++;
        }
        if (pi < PALETTE.length) {
          const fallback = PALETTE[pi];
          result.set(ap.acsrId, fallback);
          usedColors.add(fallback);
          pi++;
        } else {
          result.set(ap.acsrId, '#94a3b8');
        }
      }
    }

    return result;
  }

  // ─── 데이터 빌드 ─────────────────────────────────────────────────────────────
  function buildApproachChartData(approaches, rows, isToday, nullSlots = []) {
    // acsrId → Map<HH:MM, row>
    const acsrMaps = new Map();
    for (const ap of approaches) {
      acsrMaps.set(ap.acsrId, new Map());
    }
    for (const row of rows) {
      const label = toHHMM(row.TOT_DT);
      if (!label) continue;
      const m = acsrMaps.get(row.ACSR_ID);
      if (m) m.set(label, row);
    }

    const nullSet = new Set(nullSlots);
    const now = new Date();

    return approaches.map(ap => {
      const map = acsrMaps.get(ap.acsrId) || new Map();

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

      return values;
    });
  }

  // ─── 방향별 결측 데이터 빌드 (1일, 288개) ────────────────────────────────────
  // 반환: Array<null | undefined | { directions: string[] }>
  //   null      → 모든 방향 정상
  //   undefined → 미래 슬롯 (아직 미수신)
  //   { directions } → 결측 방향 목록 (부분 결측 포함)
  function buildApproachMissingData(approaches, rows, isToday, nullSlots = []) {
    const acsrMaps = new Map();
    for (const ap of approaches) acsrMaps.set(ap.acsrId, new Map());
    for (const row of rows) {
      const label = toHHMM(row.TOT_DT);
      if (!label) continue;
      const m = acsrMaps.get(row.ACSR_ID);
      if (m) m.set(label, row);
    }

    const nullSet = new Set(nullSlots);
    const now = new Date();

    let cutoff = null;
    if (isToday) {
      const allKeys = [...acsrMaps.values()].flatMap(m => [...m.keys()]);
      if (allKeys.length > 0) {
        cutoff = allKeys.sort().at(-1);
      } else {
        cutoff = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      }
    }

    return ALL_LABELS.map(l => {
      if (cutoff !== null && l > cutoff) {
        if (nullSet.has(l)) return { directions: approaches.map(ap => ap.name) };
        return undefined;
      }

      if (approaches.length === 0) return null;

      const missingDirections = approaches
        .filter(ap => {
          const row = acsrMaps.get(ap.acsrId)?.get(l);
          return !row || (row.TRF_QNTY ?? 0) === 0;
        })
        .map(ap => ap.name);

      return missingDirections.length > 0 ? { directions: missingDirections } : null;
    });
  }

  // ─── 방향별 결측 데이터 빌드 (1주, 672 15분 슬롯) ───────────────────────────
  function buildApproachMissingDataWeekly(approaches, rows, weekStart, isCurrentWeek, nullSlots = {}) {
    const LABELS = generateWeeklyLabels(weekStart);

    const acsrMaps = new Map();
    for (const ap of approaches) acsrMaps.set(ap.acsrId, new Map());
    for (const row of rows) {
      const dt = row.TOT_DT instanceof Date ? row.TOT_DT : new Date(row.TOT_DT);
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(Math.floor(dt.getMinutes() / 15) * 15).padStart(2, '0');
      const label = `${dateStr} ${hh}:${mm}`;
      const m = acsrMaps.get(row.ACSR_ID);
      if (m) m.set(label, row);
    }

    const nullSet = new Set();
    for (const [dateStr, slots] of Object.entries(nullSlots)) {
      for (const slot of slots) nullSet.add(`${dateStr} ${slot}`);
    }

    const now = new Date();
    let cutoff = null;
    if (isCurrentWeek) {
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(Math.floor(now.getMinutes() / 15) * 15).padStart(2, '0');
      cutoff = `${dateStr} ${hh}:${mm}`;
    }

    return LABELS.map(l => {
      if (cutoff !== null && l >= cutoff) {
        if (nullSet.has(l)) return { directions: approaches.map(ap => ap.name) };
        return undefined;
      }
      if (approaches.length === 0) return null;
      const missingAps = approaches.filter(ap => {
        const row = acsrMaps.get(ap.acsrId)?.get(l);
        return !row || (row.TRF_QNTY ?? 0) === 0;
      });
      return missingAps.length > 0 ? { directions: missingAps.map(ap => ap.name) } : null;
    });
  }

  // ─── 방향별 결측 데이터 빌드 (1달, N×24 시간 슬롯) ─────────────────────────
  function buildApproachMissingDataMonthly(approaches, rows, monthStr, isCurrentMonth, nullSlots = {}) {
    const LABELS = generateMonthlyLabels(monthStr);

    const acsrMaps = new Map();
    for (const ap of approaches) acsrMaps.set(ap.acsrId, new Map());
    for (const row of rows) {
      const dt = row.TOT_DT instanceof Date ? row.TOT_DT : new Date(row.TOT_DT);
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const hh = String(dt.getHours()).padStart(2, '0');
      const label = `${dateStr} ${hh}:00`;
      const m = acsrMaps.get(row.ACSR_ID);
      if (m) m.set(label, row);
    }

    const nullSet = new Set();
    for (const [dateStr, slots] of Object.entries(nullSlots)) {
      for (const slot of slots) nullSet.add(`${dateStr} ${slot}`);
    }

    const now = new Date();
    let cutoff = null;
    if (isCurrentMonth) {
      const y = now.getFullYear();
      const mo = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const hh = String(now.getHours()).padStart(2, '0');
      cutoff = `${y}-${mo}-${d} ${hh}:00`;
    }

    return LABELS.map(l => {
      if (cutoff !== null && l >= cutoff) {
        if (nullSet.has(l)) return { directions: approaches.map(ap => ap.name) };
        return undefined;
      }
      if (approaches.length === 0) return null;
      const missingAps = approaches.filter(ap => {
        const row = acsrMaps.get(ap.acsrId)?.get(l);
        return !row || (row.TRF_QNTY ?? 0) === 0;
      });
      return missingAps.length > 0 ? { directions: missingAps.map(ap => ap.name) } : null;
    });
  }

  // ─── 방향별 결측 데이터 빌드 (1년, 365 일 슬롯) ────────────────────────────
  function buildApproachMissingDataYearly(approaches, rows, yearStr, isCurrentYear, nullSlots = []) {
    const LABELS = generateYearlyLabels(yearStr);

    const acsrMaps = new Map();
    for (const ap of approaches) acsrMaps.set(ap.acsrId, new Map());
    for (const row of rows) {
      const dt = row.TOT_DT instanceof Date ? row.TOT_DT : new Date(row.TOT_DT);
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const m = acsrMaps.get(row.ACSR_ID);
      if (m) m.set(dateStr, row);
    }

    const nullSet = new Set(nullSlots);

    const now = new Date();
    let cutoff = null;
    if (isCurrentYear) {
      cutoff = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    return LABELS.map(l => {
      if (cutoff !== null && l >= cutoff) {
        if (nullSet.has(l)) return { directions: approaches.map(ap => ap.name) };
        return undefined;
      }
      if (approaches.length === 0) return null;
      const missingAps = approaches.filter(ap => {
        const row = acsrMaps.get(ap.acsrId)?.get(l);
        return !row || (row.TRF_QNTY ?? 0) === 0;
      });
      return missingAps.length > 0 ? { directions: missingAps.map(ap => ap.name) } : null;
    });
  }

  // ─── 차트 초기화 ─────────────────────────────────────────────────────────────
  function init(canvasId, approaches) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    _currentApproaches = approaches;
    _currentMissingData = [];

    if (chart) {
      stopBlink();
      chart.destroy();
      chart = null;
    }

    const colorMap = assignApproachColors(approaches);
    const emptyValues = new Array(288).fill(0);

    const datasets = approaches.map(ap => ({
      label: ap.name,
      _acsrId: ap.acsrId,
      data: [...emptyValues],
      borderColor: colorMap.get(ap.acsrId),
      backgroundColor: colorMap.get(ap.acsrId),
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.3,
      fill: false,
      spanGaps: false,
    }));

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: ALL_LABELS,
        datasets,
      },
      plugins: [lastPointBlinkPlugin],
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
          legend: {
            display: true,
            position: 'top',
            labels: { boxWidth: 12, font: { size: 11 } },
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            displayColors: true,
            callbacks: {
              title(items) { return items[0]?.label || ''; },
              label(item) {
                return `${item.dataset.label}: ${item.raw ?? '-'} 대`;
              },
            },
          },
        },
      },
    });

    startBlink(chart);
    return chart;
  }

  // ─── 차트 업데이트 ───────────────────────────────────────────────────────────
  function update(approaches, rows, isToday, nullSlots = []) {
    if (!chart) return;

    _currentApproaches = approaches;
    _currentMissingData = buildApproachMissingData(approaches, rows, isToday, nullSlots);

    const dataArrays = buildApproachChartData(approaches, rows, isToday, nullSlots);
    for (let i = 0; i < chart.data.datasets.length; i++) {
      if (dataArrays[i]) {
        chart.data.datasets[i].data = dataArrays[i];
      }
    }
    chart.update();
    ChartManager.renderMissingHeatmapDirectional(_currentMissingData);
  }

  // ─── SSE 신규 데이터 병합 ────────────────────────────────────────────────────
  function mergeNewRows(newRows, nodeId, date, nullSlots = []) {
    if (!chart) return;

    applyNullSlots(nullSlots, date);

    let updated = false;
    for (const row of newRows) {
      if (row.NODE_ID !== nodeId) continue;
      const rowDate = new Date(row.TOT_DT);
      if (rowDate.toISOString().slice(0, 10) !== date) continue;

      const label = toHHMM(row.TOT_DT);
      if (!label) continue;
      const idx = ALL_LABELS.indexOf(label);
      if (idx < 0) continue;

      const targetIdx = chart.data.datasets.findIndex(ds => ds._acsrId === row.ACSR_ID);
      if (targetIdx < 0) continue;

      chart.data.datasets[targetIdx].data[idx] = row.TRF_QNTY ?? 0;
      updated = true;

      // 해당 슬롯에서 이 방향의 결측 해제
      if (_currentMissingData[idx]?.directions) {
        const apName = _currentApproaches.find(a => a.acsrId === row.ACSR_ID)?.name;
        if (apName) {
          _currentMissingData[idx].directions = _currentMissingData[idx].directions.filter(d => d !== apName);
          if (_currentMissingData[idx].directions.length === 0) _currentMissingData[idx] = null;
        }
      }
    }

    if (updated) {
      chart.update();
      if (_currentMissingData.length > 0) {
        ChartManager.renderMissingHeatmapDirectional(_currentMissingData);
      }
    }
  }

  // ─── SSE null-slots 반영 ─────────────────────────────────────────────────────
  function applyNullSlots(nullSlots, date) {
    if (!chart || !nullSlots || nullSlots.length === 0) return;

    let changed = false;
    for (const hhmm of nullSlots) {
      const idx = ALL_LABELS.indexOf(hhmm);
      if (idx < 0) continue;
      for (const ds of chart.data.datasets) {
        if (ds.data[idx] === null) {
          ds.data[idx] = 0;
          changed = true;
        }
      }
      // 확정 null 슬롯: 미래(undefined)였던 슬롯을 전 방향 결측으로 표시
      if (_currentMissingData[idx] === undefined && _currentApproaches.length > 0) {
        _currentMissingData[idx] = { directions: _currentApproaches.map(a => a.name) };
        changed = true;
      }
    }

    if (changed) {
      chart.update();
      if (_currentMissingData.length > 0) {
        ChartManager.renderMissingHeatmapDirectional(_currentMissingData);
      }
    }
  }

  // ─── 차트 파괴 ───────────────────────────────────────────────────────────────
  function destroy() {
    if (chart) {
      stopBlink();
      chart.destroy();
      chart = null;
    }
    _currentApproaches = [];
    _currentMissingData = [];
  }

  // ─── 공통 차트 생성 헬퍼 ─────────────────────────────────────────────────────
  function _initChart(canvasId, approaches, labels, tickCallback) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;

    if (chart) {
      stopBlink();
      chart.destroy();
      chart = null;
    }

    const colorMap = assignApproachColors(approaches);
    const emptyValues = new Array(labels.length).fill(null);

    const datasets = approaches.map(ap => ({
      label: ap.name,
      _acsrId: ap.acsrId,
      data: [...emptyValues],
      borderColor: colorMap.get(ap.acsrId),
      backgroundColor: colorMap.get(ap.acsrId),
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.3,
      fill: false,
      spanGaps: false,
    }));

    chart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      plugins: [lastPointBlinkPlugin],
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
              callback: tickCallback,
              font: { size: 11 },
              color: '#64748b',
            },
            grid: { color: 'rgba(0,0,0,0.05)', drawTicks: false },
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: '교통량 (대)', font: { size: 12 }, color: '#64748b' },
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
    });

    startBlink(chart);
    return chart;
  }

  // ─── 공통 데이터 업데이트 헬퍼 ───────────────────────────────────────────────
  function _updateChart(dataArrays) {
    if (!chart) return;
    for (let i = 0; i < chart.data.datasets.length; i++) {
      if (dataArrays[i]) chart.data.datasets[i].data = dataArrays[i];
    }
    chart.update();
  }

  // ─── 주간 데이터 빌드 ────────────────────────────────────────────────────────
  function buildApproachChartDataWeekly(approaches, rows, weekStart, isCurrentWeek, nullSlots = {}) {
    const LABELS = generateWeeklyLabels(weekStart);

    const acsrMaps = new Map();
    for (const ap of approaches) acsrMaps.set(ap.acsrId, new Map());

    for (const row of rows) {
      const dt = row.TOT_DT instanceof Date ? row.TOT_DT : new Date(row.TOT_DT);
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(Math.floor(dt.getMinutes() / 15) * 15).padStart(2, '0');
      const label = `${dateStr} ${hh}:${mm}`;
      const m = acsrMaps.get(row.ACSR_ID);
      if (m) m.set(label, row);
    }

    const nullSet = new Set();
    for (const [dateStr, slots] of Object.entries(nullSlots)) {
      for (const slot of slots) nullSet.add(`${dateStr} ${slot}`);
    }

    const now = new Date();
    let cutoff = null;
    if (isCurrentWeek) {
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(Math.floor(now.getMinutes() / 15) * 15).padStart(2, '0');
      cutoff = `${dateStr} ${hh}:${mm}`;
    }

    return approaches.map(ap => {
      const map = acsrMaps.get(ap.acsrId) || new Map();
      return LABELS.map(l => {
        const r = map.get(l);
        if (r != null) return r.TRF_QNTY ?? 0;
        if (cutoff !== null && l >= cutoff) return null;
        return 0;
      });
    });
  }

  // ─── 월간 데이터 빌드 ────────────────────────────────────────────────────────
  function buildApproachChartDataMonthly(approaches, rows, monthStr, isCurrentMonth, nullSlots = {}) {
    const LABELS = generateMonthlyLabels(monthStr);

    const acsrMaps = new Map();
    for (const ap of approaches) acsrMaps.set(ap.acsrId, new Map());

    for (const row of rows) {
      const dt = row.TOT_DT instanceof Date ? row.TOT_DT : new Date(row.TOT_DT);
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const hh = String(dt.getHours()).padStart(2, '0');
      const label = `${dateStr} ${hh}:00`;
      const m = acsrMaps.get(row.ACSR_ID);
      if (m) m.set(label, row);
    }

    const nullSet = new Set();
    for (const [dateStr, slots] of Object.entries(nullSlots)) {
      for (const slot of slots) nullSet.add(`${dateStr} ${slot}`);
    }

    const now = new Date();
    let cutoff = null;
    if (isCurrentMonth) {
      const y = now.getFullYear();
      const mo = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const hh = String(now.getHours()).padStart(2, '0');
      cutoff = `${y}-${mo}-${d} ${hh}:00`;
    }

    return approaches.map(ap => {
      const map = acsrMaps.get(ap.acsrId) || new Map();
      return LABELS.map(l => {
        const r = map.get(l);
        if (r != null) return r.TRF_QNTY ?? 0;
        if (cutoff !== null && l >= cutoff) return null;
        return 0;
      });
    });
  }

  // ─── 연간 데이터 빌드 ────────────────────────────────────────────────────────
  function buildApproachChartDataYearly(approaches, rows, yearStr, isCurrentYear, nullSlots = []) {
    const LABELS = generateYearlyLabels(yearStr);

    const acsrMaps = new Map();
    for (const ap of approaches) acsrMaps.set(ap.acsrId, new Map());

    for (const row of rows) {
      const dt = row.TOT_DT instanceof Date ? row.TOT_DT : new Date(row.TOT_DT);
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const m = acsrMaps.get(row.ACSR_ID);
      if (m) m.set(dateStr, row);
    }

    const nullSet = new Set(nullSlots);

    const now = new Date();
    let cutoff = null;
    if (isCurrentYear) {
      cutoff = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    return approaches.map(ap => {
      const map = acsrMaps.get(ap.acsrId) || new Map();
      return LABELS.map(l => {
        const r = map.get(l);
        if (r != null) return r.TRF_QNTY ?? 0;
        if (cutoff !== null && l >= cutoff) return null;
        return 0;
      });
    });
  }

  // ─── 주간 차트 init/update ────────────────────────────────────────────────────
  function initWeekly(canvasId, approaches, weekStart) {
    const LABELS = generateWeeklyLabels(weekStart);
    const DAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
    const [wy, wm, wd] = weekStart.split('-').map(Number);

    function tickCb(val, index) {
      const label = this.getLabelForValue(index);
      if (!label) return '';
      const timePart = label.slice(11); // 'HH:MM'
      if (!timePart.endsWith(':00')) return '';
      const hour = parseInt(timePart.slice(0, 2), 10);
      const w = this.chart.canvas.offsetWidth;
      // 날짜 변경점(00:00)에 날짜 표시
      if (hour === 0) {
        const datePart = label.slice(0, 10);
        const dt = new Date(datePart + 'T00:00:00');
        return `${wm === (dt.getMonth() + 1) ? '' : `${dt.getMonth() + 1}/`}${dt.getDate()}(${DAYS_KO[dt.getDay()]})`;
      }
      if (w >= 700) return hour % 6 === 0 ? timePart : '';
      if (w >= 500) return hour % 12 === 0 ? timePart : '';
      return '';
    }

    return _initChart(canvasId, approaches, LABELS, tickCb);
  }

  function updateWeekly(approaches, rows, weekStart, isCurrentWeek, nullSlots = {}) {
    _updateChart(buildApproachChartDataWeekly(approaches, rows, weekStart, isCurrentWeek, nullSlots));
    const missingData = buildApproachMissingDataWeekly(approaches, rows, weekStart, isCurrentWeek, nullSlots);
    ChartManager.renderMissingHeatmapDirectionalWeekly(missingData, weekStart);
  }

  // ─── 월간 차트 init/update ────────────────────────────────────────────────────
  function initMonthly(canvasId, approaches, monthStr) {
    const LABELS = generateMonthlyLabels(monthStr);

    function tickCb(val, index) {
      const label = this.getLabelForValue(index);
      if (!label) return '';
      const timePart = label.slice(11); // 'HH:00'
      if (timePart !== '00:00') return '';
      const datePart = label.slice(0, 10); // 'YYYY-MM-DD'
      const day = parseInt(datePart.slice(8), 10);
      const w = this.chart.canvas.offsetWidth;
      if (w >= 600) return `${day}일`;
      return day % 5 === 1 ? `${day}일` : '';
    }

    return _initChart(canvasId, approaches, LABELS, tickCb);
  }

  function updateMonthly(approaches, rows, monthStr, isCurrentMonth, nullSlots = {}) {
    _updateChart(buildApproachChartDataMonthly(approaches, rows, monthStr, isCurrentMonth, nullSlots));
    const missingData = buildApproachMissingDataMonthly(approaches, rows, monthStr, isCurrentMonth, nullSlots);
    ChartManager.renderMissingHeatmapDirectionalMonthly(missingData, monthStr);
  }

  // ─── 연간 차트 init/update ────────────────────────────────────────────────────
  function initYearly(canvasId, approaches, yearStr) {
    const LABELS = generateYearlyLabels(yearStr);

    function tickCb(val, index) {
      const label = this.getLabelForValue(index);
      if (!label) return '';
      const day = parseInt(label.slice(8), 10);
      const month = parseInt(label.slice(5, 7), 10);
      const w = this.chart.canvas.offsetWidth;
      if (day === 1) return `${month}월`;
      if (w >= 700 && day === 15) return `${month}/${day}`;
      return '';
    }

    return _initChart(canvasId, approaches, LABELS, tickCb);
  }

  function updateYearly(approaches, rows, yearStr, isCurrentYear, nullSlots = []) {
    _updateChart(buildApproachChartDataYearly(approaches, rows, yearStr, isCurrentYear, nullSlots));
    const missingData = buildApproachMissingDataYearly(approaches, rows, yearStr, isCurrentYear, nullSlots);
    ChartManager.renderMissingHeatmapDirectionalYearly(missingData, yearStr);
  }

  return {
    init, update, mergeNewRows, applyNullSlots, destroy,
    initWeekly, updateWeekly, initMonthly, updateMonthly, initYearly, updateYearly
  };
})();
