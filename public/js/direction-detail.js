'use strict';

const DirectionDetailApp = (() => {
  const state = {
    nodeId: null,
    acsrId: null,
    acsrName: '',
    selectedNodeName: '',
    allIntersections: [],
    sidebarFocusedIndex: -1,
    currentDate: todayStr(),
    currentPeriod: '1d',
    currentWeekStart: null,
    currentMonthStr: null,
    currentYearStr: null,
  };

  function todayStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function padZ(n) {
    return String(n).padStart(2, '0');
  }

  function formatLastUpdateDateTime(date) {
    return [
      date.getFullYear(),
      padZ(date.getMonth() + 1),
      padZ(date.getDate()),
    ].join('.') + ` ${padZ(date.getHours())}:${padZ(date.getMinutes())}`;
  }

  function getWeekStart(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - dt.getDay());
    return `${dt.getFullYear()}-${padZ(dt.getMonth() + 1)}-${padZ(dt.getDate())}`;
  }

  function getWeekEnd(weekStart) {
    const [y, m, d] = weekStart.split('-').map(Number);
    const dt = new Date(y, m - 1, d + 6);
    return `${dt.getFullYear()}-${padZ(dt.getMonth() + 1)}-${padZ(dt.getDate())}`;
  }

  function isCurrentWeek(weekStart) {
    return weekStart === getWeekStart(todayStr());
  }

  function shiftWeek(weekStart, delta) {
    const [y, m, d] = weekStart.split('-').map(Number);
    const dt = new Date(y, m - 1, d + delta * 7);
    return `${dt.getFullYear()}-${padZ(dt.getMonth() + 1)}-${padZ(dt.getDate())}`;
  }

  function currentMonthStrFn() {
    const now = new Date();
    return `${now.getFullYear()}-${padZ(now.getMonth() + 1)}`;
  }

  function isCurrentMonth(monthStr) {
    return monthStr === currentMonthStrFn();
  }

  function shiftMonth(monthStr, delta) {
    const [y, m] = monthStr.split('-').map(Number);
    const dt = new Date(y, m - 1 + delta, 1);
    return `${dt.getFullYear()}-${padZ(dt.getMonth() + 1)}`;
  }

  function currentYearStrFn() {
    return String(new Date().getFullYear());
  }

  function isCurrentYear(yearStr) {
    return yearStr === currentYearStrFn();
  }

  function shiftYear(yearStr, delta) {
    return String(parseInt(yearStr, 10) + delta);
  }

  function weekDisplayLabel(weekStart) {
    const today = todayStr();
    const end = getWeekEnd(weekStart);
    const displayEnd = end > today ? today : end;
    const [y1, m1, d1] = weekStart.split('-');
    const [y2, m2, d2] = displayEnd.split('-');
    return `${y1}.${m1}.${d1} - ${y2}.${m2}.${d2}`;
  }

  function formatYmd(dateStr) {
    const [y, m, d] = dateStr.split('-');
    return `${y}.${m}.${d}`;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const els = {
    sidebar: () => document.getElementById('sidebar'),
    sidebarToggleBtn: () => document.getElementById('sidebarToggleBtn'),
    sidebarOpenTab: () => document.getElementById('sidebarOpenTab'),
    sidebarFilter: () => document.getElementById('sidebarFilter'),
    filterClearBtn: () => document.getElementById('filterClearBtn'),
    intersectionList: () => document.getElementById('intersectionList'),
    backBtn: () => document.getElementById('backBtn'),
    directionName: () => document.getElementById('directionName'),
    intersectionName: () => document.getElementById('intersectionName'),
    lastUpdateTime: () => document.getElementById('lastUpdateTime'),
    prevDay: () => document.getElementById('prevDay'),
    nextDay: () => document.getElementById('nextDay'),
    currentDateBtn: () => document.getElementById('currentDateBtn'),
    datePicker: () => document.getElementById('datePicker'),
    chartPlaceholder: () => document.getElementById('chartPlaceholder'),
    trafficChart: () => document.getElementById('trafficChart'),
    turnChartPlaceholder: () => document.getElementById('turnChartPlaceholder'),
    turnTrafficChart: () => document.getElementById('turnTrafficChart'),
    chartGranularity: () => document.getElementById('chartGranularity'),
    turnChartGranularity: () => document.getElementById('turnChartGranularity'),
  };

  function filterText(text, query) {
    if (!query) return true;
    return String(text).toLowerCase().includes(query.toLowerCase());
  }

  function navigateToIndex(nodeId) {
    window.location.href = `/index.html?node_id=${encodeURIComponent(nodeId)}`;
  }

  function buildReturnUrl() {
    if (!state.nodeId) return '/index.html';

    const params = new URLSearchParams({
      node_id: String(state.nodeId),
      date: state.currentDate,
    });
    return `/index.html?${params.toString()}`;
  }

  function bindBackButton() {
    const backBtn = els.backBtn();
    if (!backBtn) return;

    backBtn.addEventListener('click', () => {
      window.location.href = buildReturnUrl();
    });
  }

  function renderSidebarList(list) {
    state.sidebarFocusedIndex = -1;
    const ul = els.intersectionList();
    if (!ul) return;

    if (!Array.isArray(list) || list.length === 0) {
      ul.innerHTML = '<li class="px-3 py-2 text-xs text-outline">?? ??</li>';
      return;
    }

    ul.innerHTML = list.map((item) => {
      const activeClass = String(item.NODE_ID) === String(state.nodeId) ? ' active' : '';
      return `<li data-node="${escapeHtml(item.NODE_ID)}" data-name="${escapeHtml(item.CRSRD_NM)}"
          class="px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-white hover:shadow-sm transition-all rounded-xl cursor-pointer${activeClass}">
          ${escapeHtml(item.CRSRD_NM)}</li>`;
    }).join('');
  }

  function bindSidebarClick() {
    const list = els.intersectionList();
    if (!list) return;

    list.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-node]');
      if (!li) return;
      navigateToIndex(li.dataset.node);
    });
  }

  function bindSidebarFilter() {
    const filterInput = els.sidebarFilter();
    const clearBtn = els.filterClearBtn();
    const listEl = els.intersectionList();
    if (!filterInput || !clearBtn || !listEl) return;

    let debounceTimer = null;

    filterInput.addEventListener('input', (e) => {
      clearBtn.style.display = e.target.value ? 'block' : 'none';
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const q = e.target.value;
        const filtered = state.allIntersections.filter((i) => filterText(i.CRSRD_NM, q));
        renderSidebarList(filtered);
      }, 200);
    });

    clearBtn.addEventListener('click', () => {
      filterInput.value = '';
      clearBtn.style.display = 'none';
      renderSidebarList(state.allIntersections);
      filterInput.focus();
    });

    filterInput.addEventListener('keydown', (e) => {
      const items = listEl.querySelectorAll('li[data-node]');
      if (!items.length) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.sidebarFocusedIndex = Math.min(state.sidebarFocusedIndex + 1, items.length - 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.sidebarFocusedIndex = Math.max(state.sidebarFocusedIndex - 1, 0);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const idx = state.sidebarFocusedIndex >= 0 ? state.sidebarFocusedIndex : 0;
        const target = items[idx];
        if (target) navigateToIndex(target.dataset.node);
        return;
      } else {
        return;
      }

      items.forEach((li) => li.classList.remove('keyboard-focused', 'active'));
      items[state.sidebarFocusedIndex].classList.add('keyboard-focused');
      items[state.sidebarFocusedIndex].scrollIntoView({ block: 'nearest' });
    });
  }

  function bindSidebarToggle() {
    const closeBtn = els.sidebarToggleBtn();
    const openTab = els.sidebarOpenTab();
    if (!closeBtn || !openTab) return;

    closeBtn.addEventListener('click', () => {
      const sidebar = els.sidebar();
      if (!sidebar) return;
      sidebar.style.width = '0';
      sidebar.style.overflow = 'hidden';
      openTab.style.display = 'flex';
      document.querySelector('main').style.marginLeft = '0';
    });

    openTab.addEventListener('click', () => {
      const sidebar = els.sidebar();
      if (!sidebar) return;
      const saved = localStorage.getItem('sidebarWidth');
      const width = saved ? `${saved}px` : '16rem';
      sidebar.style.width = width;
      sidebar.style.overflow = '';
      openTab.style.display = 'none';
      document.querySelector('main').style.marginLeft = width;
    });
  }

  function initSidebarResize() {
    const sidebar = document.getElementById('sidebar');
    const handle = document.getElementById('sidebarResizeHandle');
    if (!sidebar || !handle) return;

    let startX = 0;
    let startWidth = 0;

    handle.addEventListener('mousedown', (e) => {
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      handle.classList.add('dragging');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });

    function onMove(e) {
      const width = Math.max(140, Math.min(400, startWidth + e.clientX - startX));
      sidebar.style.width = `${width}px`;
      document.querySelector('main').style.marginLeft = `${width}px`;
    }

    function onUp() {
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      localStorage.setItem('sidebarWidth', String(sidebar.offsetWidth));
    }
  }

  function applySavedSidebarWidth() {
    const saved = localStorage.getItem('sidebarWidth');
    if (!saved) return;
    const sidebar = els.sidebar();
    if (!sidebar) return;
    sidebar.style.width = `${saved}px`;
    document.querySelector('main').style.marginLeft = `${saved}px`;
  }

  function updateHeader() {
    const directionLabel = state.acsrName || `?? ${state.acsrId || '-'}`;
    const nodeLabel = state.selectedNodeName || (state.nodeId ? `??? ${state.nodeId}` : '??? ?? ??');

    if (els.directionName()) els.directionName().textContent = directionLabel;
    if (els.intersectionName()) els.intersectionName().textContent = nodeLabel;
    document.title = `${directionLabel} - ?? ?? ??`;
  }

  function showPlaceholder(message, isError = false) {
    const placeholder = els.chartPlaceholder();
    const canvas = els.trafficChart();
    if (!placeholder || !canvas) return;

    placeholder.style.display = 'flex';
    placeholder.innerHTML = `<p style="color:${isError ? '#ef4444' : '#64748b'}">${escapeHtml(message)}</p>`;
    canvas.style.display = 'none';
  }

  function showTurnPlaceholder(message, isError = false) {
    const placeholder = els.turnChartPlaceholder();
    const canvas = els.turnTrafficChart();
    if (!placeholder || !canvas) return;

    placeholder.style.display = 'flex';
    placeholder.innerHTML = `<p style="color:${isError ? '#ef4444' : '#64748b'}">${escapeHtml(message)}</p>`;
    canvas.style.display = 'none';
    DirectionTurnChartManager.destroy();
  }

  function showLoading() {
    const placeholder = els.chartPlaceholder();
    const canvas = els.trafficChart();
    if (!placeholder || !canvas) return;

    placeholder.style.display = 'flex';
    placeholder.innerHTML = '<div class="loading-spinner"></div>';
    canvas.style.display = 'none';
  }

  function showTurnLoading() {
    const placeholder = els.turnChartPlaceholder();
    const canvas = els.turnTrafficChart();
    if (!placeholder || !canvas) return;

    placeholder.style.display = 'flex';
    placeholder.innerHTML = '<div class="loading-spinner"></div>';
    canvas.style.display = 'none';
  }

  function updateGranularityLabel(period) {
    const el = els.chartGranularity();
    if (!el) return;
    const map = {
      '1d': '(5분 단위)',
      '1w': '(15분 단위)',
      '1m': '(1시간 단위)',
      '1y': '(1일 단위)',
    };
    el.textContent = map[period] || '';
    const turnEl = els.turnChartGranularity();
    if (turnEl) turnEl.textContent = map[period] || '';
  }

  function updateDateDisplay() {
    const btn = els.currentDateBtn();
    const nextBtn = els.nextDay();
    if (!btn || !nextBtn) return;

    if (state.currentPeriod === '1w') {
      btn.textContent = weekDisplayLabel(state.currentWeekStart);
      nextBtn.disabled = isCurrentWeek(state.currentWeekStart);
      return;
    }

    if (state.currentPeriod === '1m') {
      const [y, m] = state.currentMonthStr.split('-');
      btn.textContent = `${y}.${m}`;
      nextBtn.disabled = isCurrentMonth(state.currentMonthStr);
      return;
    }

    if (state.currentPeriod === '1y') {
      btn.textContent = `${state.currentYearStr}?`;
      nextBtn.disabled = isCurrentYear(state.currentYearStr);
      return;
    }

    btn.textContent = formatYmd(state.currentDate);
    nextBtn.disabled = state.currentDate >= todayStr();
  }

  function setLastUpdateByRows(rows) {
    const el = els.lastUpdateTime();
    if (!el) return;

    if (!Array.isArray(rows) || rows.length === 0) {
      el.textContent = '데이터 없음';
      return;
    }

    const last = rows[rows.length - 1];
    const dt = new Date(last.TOT_DT);
    el.textContent = `마지막 업데이트: ${formatLastUpdateDateTime(dt)}`;
  }

  function filterRowsByAcsr(rows) {
    return (rows || []).filter((row) => String(row.ACSR_ID) === String(state.acsrId));
  }

  function getTurnLabels() {
    if (state.currentPeriod === '1w') return DirectionTurnChartManager.generateWeeklyLabels(state.currentWeekStart);
    if (state.currentPeriod === '1m') return DirectionTurnChartManager.generateMonthlyLabels(state.currentMonthStr);
    if (state.currentPeriod === '1y') return DirectionTurnChartManager.generateYearlyLabels(state.currentYearStr);
    return DirectionTurnChartManager.generateDailyLabels();
  }

  function showTurnChart() {
    const placeholder = els.turnChartPlaceholder();
    const canvas = els.turnTrafficChart();
    if (!placeholder || !canvas) return;
    canvas.style.display = 'block';
    placeholder.style.display = 'none';
  }

  async function loadCurrentPeriodData() {
    if (!state.nodeId || !state.acsrId) {
      showPlaceholder('?? ????(node_id, acsr_id)? ????.', true);
      showTurnPlaceholder('방향 정보(node_id, acsr_id)가 없습니다.', true);
      return;
    }

    const canvas = els.trafficChart();
    const placeholder = els.chartPlaceholder();
    if (!canvas || !placeholder) return;

    showLoading();
    showTurnLoading();

    try {
      let response = null;
      let turnResponse = null;

      if (state.currentPeriod === '1w') {
        [response, turnResponse] = await Promise.all([
          API.getApproachWeeklyTraffic(state.nodeId, state.currentWeekStart),
          API.getDirectionWeeklyTraffic(state.nodeId, state.acsrId, state.currentWeekStart),
        ]);
      } else if (state.currentPeriod === '1m') {
        [response, turnResponse] = await Promise.all([
          API.getApproachMonthlyTraffic(state.nodeId, state.currentMonthStr),
          API.getDirectionMonthlyTraffic(state.nodeId, state.acsrId, state.currentMonthStr),
        ]);
      } else if (state.currentPeriod === '1y') {
        [response, turnResponse] = await Promise.all([
          API.getApproachYearlyTraffic(state.nodeId, state.currentYearStr),
          API.getDirectionYearlyTraffic(state.nodeId, state.acsrId, state.currentYearStr),
        ]);
      } else {
        [response, turnResponse] = await Promise.all([
          API.getApproachTraffic(state.nodeId, state.currentDate),
          API.getDirectionTraffic(state.nodeId, state.acsrId, state.currentDate),
        ]);
      }

      const approaches = response.approaches || [];
      const filteredRows = filterRowsByAcsr(response.rows || []);

      if (!state.acsrName) {
        const foundDirection = approaches.find((ap) => String(ap.acsrId) === String(state.acsrId));
        if (foundDirection) state.acsrName = foundDirection.name;
      }
      updateHeader();

      canvas.style.display = 'block';
      placeholder.style.display = 'none';

      if (state.currentPeriod === '1w') {
        const currentWeek = isCurrentWeek(state.currentWeekStart);
        ChartManager.initWeekly('trafficChart', state.currentWeekStart);
        ChartManager.updateWeekly(filteredRows, state.currentWeekStart, currentWeek, response.nullSlots || {});
        renderTurnChart(turnResponse, currentWeek, response.nullSlots || {});
      } else if (state.currentPeriod === '1m') {
        const currentMonth = isCurrentMonth(state.currentMonthStr);
        ChartManager.initMonthly('trafficChart', state.currentMonthStr);
        ChartManager.updateMonthly(filteredRows, state.currentMonthStr, currentMonth, response.nullSlots || {});
        renderTurnChart(turnResponse, currentMonth, response.nullSlots || {});
      } else if (state.currentPeriod === '1y') {
        const currentYear = isCurrentYear(state.currentYearStr);
        ChartManager.initYearly('trafficChart', state.currentYearStr);
        ChartManager.updateYearly(filteredRows, state.currentYearStr, currentYear, response.nullSlots || []);
        renderTurnChart(turnResponse, currentYear, response.nullSlots || []);
      } else {
        const isToday = state.currentDate === todayStr();
        ChartManager.init('trafficChart');
        ChartManager.update(filteredRows, isToday, response.nullSlots || []);
        renderTurnChart(turnResponse, isToday, response.nullSlots || []);
      }

      setLastUpdateByRows(filteredRows);
    } catch (err) {
      console.error('[DirectionDetail] load failed', err);
      showPlaceholder(`??? ?? ??: ${err.message}`, true);
      showTurnPlaceholder(`방향별 교통량 조회 실패: ${err.message}`, true);
    }
  }

  function renderTurnChart(response, isCurrentRange, nullSlots) {
    const rows = response?.rows || [];
    const labels = getTurnLabels();
    if (
      rows.length === 0
      || !DirectionTurnChartManager.hasMappedMeasuredRows(
        response?.directions || [],
        rows,
        labels,
        state.currentPeriod
      )
    ) {
      showTurnPlaceholder('방향별 교통량 데이터가 없습니다');
      return;
    }

    showTurnChart();
    DirectionTurnChartManager.update(
      response.directions || [],
      rows,
      labels,
      state.currentPeriod,
      isCurrentRange,
      response.nullSlots || nullSlots || []
    );
  }

  function changeDailyDate(delta) {
    const [y, m, d] = state.currentDate.split('-').map(Number);
    const date = new Date(y, m - 1, d + delta);
    const newDate = `${date.getFullYear()}-${padZ(date.getMonth() + 1)}-${padZ(date.getDate())}`;
    if (newDate > todayStr()) return;
    state.currentDate = newDate;
    updateDateDisplay();
    void loadCurrentPeriodData();
  }

  function changeWeek(delta) {
    const newWeekStart = shiftWeek(state.currentWeekStart, delta);
    const todayWeekStart = getWeekStart(todayStr());
    if (newWeekStart > todayWeekStart) return;
    state.currentWeekStart = newWeekStart;
    updateDateDisplay();
    void loadCurrentPeriodData();
  }

  function changeMonth(delta) {
    const newMonthStr = shiftMonth(state.currentMonthStr, delta);
    const todayMonth = currentMonthStrFn();
    if (newMonthStr > todayMonth) return;
    state.currentMonthStr = newMonthStr;
    updateDateDisplay();
    void loadCurrentPeriodData();
  }

  function changeYear(delta) {
    const newYear = shiftYear(state.currentYearStr, delta);
    if (parseInt(newYear, 10) > new Date().getFullYear()) return;
    state.currentYearStr = newYear;
    updateDateDisplay();
    void loadCurrentPeriodData();
  }

  function changeDate(delta) {
    if (state.currentPeriod === '1w') {
      changeWeek(delta);
      return;
    }
    if (state.currentPeriod === '1m') {
      changeMonth(delta);
      return;
    }
    if (state.currentPeriod === '1y') {
      changeYear(delta);
      return;
    }
    changeDailyDate(delta);
  }

  function bindDateNav() {
    const prev = els.prevDay();
    const next = els.nextDay();
    const dateBtn = els.currentDateBtn();
    const datePicker = els.datePicker();

    if (!prev || !next || !dateBtn || !datePicker) return;

    prev.addEventListener('click', () => changeDate(-1));
    next.addEventListener('click', () => changeDate(1));

    dateBtn.addEventListener('click', () => {
      if (state.currentPeriod === '1w') {
        WeeklyCalendar.open(state.currentWeekStart, (selectedWeekStart) => {
          state.currentWeekStart = selectedWeekStart;
          updateDateDisplay();
          void loadCurrentPeriodData();
        });
        return;
      }

      if (state.currentPeriod === '1m') {
        MonthlyCalendar.open(state.currentMonthStr, (selectedMonth) => {
          state.currentMonthStr = selectedMonth;
          updateDateDisplay();
          void loadCurrentPeriodData();
        });
        return;
      }

      if (state.currentPeriod === '1y') {
        YearlyNavigator.open(state.currentYearStr, (selectedYear) => {
          state.currentYearStr = selectedYear;
          updateDateDisplay();
          void loadCurrentPeriodData();
        });
        return;
      }

      datePicker.value = state.currentDate;
      datePicker.max = todayStr();
      datePicker.showPicker();
    });

    datePicker.addEventListener('change', (e) => {
      if (state.currentPeriod !== '1d') return;
      const value = e.target.value;
      if (!value || value > todayStr()) return;
      state.currentDate = value;
      updateDateDisplay();
      void loadCurrentPeriodData();
    });

    updateDateDisplay();
  }

  function bindPeriodButtons() {
    const buttons = document.querySelectorAll('.btn-period');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buttons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        const period = btn.dataset.period;
        state.currentPeriod = period;

        if (period === '1w') {
          state.currentWeekStart = getWeekStart(state.currentDate);
        } else if (period === '1m') {
          state.currentMonthStr = currentMonthStrFn();
        } else if (period === '1y') {
          state.currentYearStr = currentYearStrFn();
        }

        updateGranularityLabel(period);
        updateDateDisplay();
        void loadCurrentPeriodData();
      });
    });
  }

  function initSSE() {
    API.connectSSE(() => {});

    API.on('null-slots', ({ nullSlots }) => {
      if (state.currentPeriod !== '1d') return;
      if (state.currentDate !== todayStr()) return;
      ChartManager.applyNullSlots(nullSlots, state.currentDate);
      DirectionTurnChartManager.mergeNewRows([], state.nodeId, state.acsrId, nullSlots || []);
    });

    API.on('approach-traffic-update', ({ rows, nullSlots }) => {
      if (state.currentPeriod !== '1d') return;
      if (state.currentDate !== todayStr()) return;

      const filteredRows = (rows || []).filter((r) => {
        return String(r.NODE_ID) === String(state.nodeId)
          && String(r.ACSR_ID) === String(state.acsrId)
          && new Date(r.TOT_DT).toISOString().slice(0, 10) === state.currentDate;
      });

      const updated = ChartManager.mergeNewRows(filteredRows, state.nodeId, state.currentDate, nullSlots || []);
      if (!updated || filteredRows.length === 0) return;
      setLastUpdateByRows(filteredRows);
    });

    API.on('direction-traffic-update', ({ rows, nullSlots }) => {
      if (state.currentPeriod !== '1d') return;
      if (state.currentDate !== todayStr()) return;

      const filteredRows = (rows || []).filter((r) => {
        return String(r.NODE_ID) === String(state.nodeId)
          && String(r.ACSR_ID) === String(state.acsrId)
          && new Date(r.TOT_DT).toISOString().slice(0, 10) === state.currentDate;
      });

      DirectionTurnChartManager.mergeNewRows(filteredRows, state.nodeId, state.acsrId, nullSlots || []);
    });

    API.on('fifteen-min-null-slots', ({ nullSlots }) => {
      if (state.currentPeriod !== '1w') return;
      if (!isCurrentWeek(state.currentWeekStart)) return;
      const today = todayStr();
      ChartManager.applyHourlyNullSlots({ [today]: nullSlots || [] }, state.currentWeekStart);
      DirectionTurnChartManager.mergeNewRows([], state.nodeId, state.acsrId, { [today]: nullSlots || [] });
    });

    API.on('fifteen-min-traffic-update', ({ rows, nullSlots }) => {
      if (state.currentPeriod !== '1w') return;
      if (!isCurrentWeek(state.currentWeekStart)) return;

      const today = todayStr();
      const filteredRows = (rows || []).filter((r) => {
        return String(r.NODE_ID) === String(state.nodeId)
          && String(r.ACSR_ID) === String(state.acsrId)
          && new Date(r.TOT_DT).toISOString().slice(0, 10) === today;
      });

      const nullObj = (nullSlots && nullSlots.length > 0) ? { [today]: nullSlots } : {};
      const updated = ChartManager.mergeNewHourlyRows(filteredRows, state.nodeId, state.currentWeekStart, nullObj);
      if (!updated || filteredRows.length === 0) return;
      setLastUpdateByRows(filteredRows);
    });

    API.on('direction-fifteen-min-traffic-update', ({ rows, nullSlots }) => {
      if (state.currentPeriod !== '1w') return;
      if (!isCurrentWeek(state.currentWeekStart)) return;

      const today = todayStr();
      const filteredRows = (rows || []).filter((r) => {
        return String(r.NODE_ID) === String(state.nodeId)
          && String(r.ACSR_ID) === String(state.acsrId)
          && new Date(r.TOT_DT).toISOString().slice(0, 10) === today;
      });

      const nullObj = (nullSlots && nullSlots.length > 0) ? { [today]: nullSlots } : {};
      DirectionTurnChartManager.mergeNewRows(filteredRows, state.nodeId, state.acsrId, nullObj);
    });

    API.on('hourly-null-slots', ({ nullSlots }) => {
      if (state.currentPeriod !== '1m') return;
      if (!isCurrentMonth(state.currentMonthStr)) return;
      const today = todayStr();
      ChartManager.applyDailyNullSlots({ [today]: nullSlots || [] }, state.currentMonthStr);
      DirectionTurnChartManager.mergeNewRows([], state.nodeId, state.acsrId, { [today]: nullSlots || [] });
    });

    API.on('hourly-traffic-update', ({ rows, nullSlots }) => {
      if (state.currentPeriod !== '1m') return;
      if (!isCurrentMonth(state.currentMonthStr)) return;

      const today = todayStr();
      const filteredRows = (rows || []).filter((r) => {
        return String(r.NODE_ID) === String(state.nodeId)
          && String(r.ACSR_ID) === String(state.acsrId)
          && new Date(r.TOT_DT).toISOString().slice(0, 7) === state.currentMonthStr;
      });

      const updated = ChartManager.mergeNewDailyRows(
        filteredRows,
        state.nodeId,
        state.currentMonthStr,
        { [today]: nullSlots || [] }
      );

      if (!updated || filteredRows.length === 0) return;
      setLastUpdateByRows(filteredRows);
    });

    API.on('direction-hourly-traffic-update', ({ rows, nullSlots }) => {
      if (state.currentPeriod !== '1m') return;
      if (!isCurrentMonth(state.currentMonthStr)) return;

      const today = todayStr();
      const filteredRows = (rows || []).filter((r) => {
        return String(r.NODE_ID) === String(state.nodeId)
          && String(r.ACSR_ID) === String(state.acsrId)
          && new Date(r.TOT_DT).toISOString().slice(0, 7) === state.currentMonthStr;
      });

      DirectionTurnChartManager.mergeNewRows(filteredRows, state.nodeId, state.acsrId, { [today]: nullSlots || [] });
    });

    API.on('daily-null-slots', ({ nullSlots }) => {
      if (state.currentPeriod !== '1y') return;
      if (!isCurrentYear(state.currentYearStr)) return;
      ChartManager.applyDailyNullSlotsYearly(nullSlots || [], state.currentYearStr);
      DirectionTurnChartManager.mergeNewRows([], state.nodeId, state.acsrId, nullSlots || []);
    });

    API.on('daily-traffic-update', ({ rows, nullSlots }) => {
      if (state.currentPeriod !== '1y') return;
      if (!isCurrentYear(state.currentYearStr)) return;

      const filteredRows = (rows || []).filter((r) => {
        return String(r.NODE_ID) === String(state.nodeId)
          && String(r.ACSR_ID) === String(state.acsrId)
          && String(new Date(r.TOT_DT).getFullYear()) === state.currentYearStr;
      });

      const updated = ChartManager.mergeNewDailyRowsYearly(
        filteredRows,
        state.nodeId,
        state.currentYearStr,
        nullSlots || []
      );

      if (!updated || filteredRows.length === 0) return;
      setLastUpdateByRows(filteredRows);
    });

    API.on('direction-daily-traffic-update', ({ rows, nullSlots }) => {
      if (state.currentPeriod !== '1y') return;
      if (!isCurrentYear(state.currentYearStr)) return;

      const filteredRows = (rows || []).filter((r) => {
        return String(r.NODE_ID) === String(state.nodeId)
          && String(r.ACSR_ID) === String(state.acsrId)
          && String(new Date(r.TOT_DT).getFullYear()) === state.currentYearStr;
      });

      DirectionTurnChartManager.mergeNewRows(filteredRows, state.nodeId, state.acsrId, nullSlots || []);
    });
  }

  function disableControls() {
    const controls = [els.prevDay(), els.nextDay(), els.currentDateBtn()];
    controls.forEach((control) => {
      if (control) control.disabled = true;
    });
    document.querySelectorAll('.btn-period').forEach((btn) => {
      btn.disabled = true;
    });
  }

  function readUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const nodeId = params.get('node_id');
    const acsrId = params.get('acsr_id');
    const acsrName = params.get('acsr_name');
    const date = params.get('date');

    state.nodeId = nodeId;
    state.acsrId = acsrId;
    state.acsrName = acsrName || '';

    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= todayStr()) {
      state.currentDate = date;
    }

    state.currentWeekStart = getWeekStart(state.currentDate);
    state.currentMonthStr = currentMonthStrFn();
    state.currentYearStr = currentYearStrFn();
  }

  async function loadIntersections() {
    try {
      state.allIntersections = await API.getIntersections();
      renderSidebarList(state.allIntersections);

      const selected = state.allIntersections.find((i) => String(i.NODE_ID) === String(state.nodeId));
      if (selected) state.selectedNodeName = selected.CRSRD_NM;
      updateHeader();
    } catch (err) {
      console.error('[DirectionDetail] intersections load failed', err);
      const list = els.intersectionList();
      if (list) list.innerHTML = '<li class="px-3 py-2 text-xs text-error">??? ?? ?? ??</li>';
    }
  }

  async function init() {
    SidebarComponent.render('sidebar-container', 'traffic');

    bindSidebarToggle();
    initSidebarResize();
    applySavedSidebarWidth();
    bindSidebarClick();
    bindSidebarFilter();

    readUrlParams();
    bindBackButton();
    bindDateNav();
    bindPeriodButtons();
    updateHeader();
    updateGranularityLabel(state.currentPeriod);
    updateDateDisplay();

    let controller = new AbortController();
    API.setAbortSignal(controller.signal);

    window.addEventListener('pagehide', () => {
      controller.abort();
      API.disconnectSSE();
    });

    window.addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      controller = new AbortController();
      API.setAbortSignal(controller.signal);
      API.connectSSE(() => {});
      void loadCurrentPeriodData();
    });

    await loadIntersections();

    if (!state.nodeId || !state.acsrId) {
      disableControls();
      showPlaceholder('?? ????(node_id, acsr_id)? ????.', true);
      showTurnPlaceholder('방향 정보(node_id, acsr_id)가 없습니다.', true);
      return;
    }

    initSSE();
    await loadCurrentPeriodData();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  void DirectionDetailApp.init();
});

