'use strict';

/**
 * 상태 관리 + UI 연결
 */
const App = (() => {
  // ─── 상태 ───────────────────────────────────────
  const state = {
    selectedNodeId: null,
    selectedName: '',
    currentDate: todayStr(),
    allIntersections: [],
    currentPeriod: '1d',      // '1d' | '1w' | '1m' | '1y'
    currentWeekStart: null,      // 'YYYY-MM-DD' (일요일)
    currentMonthStr: null,      // 'YYYY-MM'
    currentYearStr: null,      // 'YYYY'
    currentApproaches: [],       // [{ acsrId, name }]
    sidebarFocusedIndex: -1,     // 키보드 포커스 인덱스
    intersectionHistory: [],     // [{ nodeId, name }] 이전 교차로 스택
  };

  const HEALTH_CHECK_INTERVAL_MS = 30_000;
  let healthPollTimer = null;
  let healthCheckInFlight = null;

  // ─── 유틸 ────────────────────────────────────────
  function todayStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function padZ(n) { return String(n).padStart(2, '0'); }

  function getWeekStart(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - dt.getDay()); // 일요일로
    return `${dt.getFullYear()}-${padZ(dt.getMonth() + 1)}-${padZ(dt.getDate())}`;
  }

  function getWeekEnd(weekStart) {
    const [y, m, d] = weekStart.split('-').map(Number);
    const dt = new Date(y, m - 1, d + 6); // 토요일
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

  function currentMonthStr() {
    const now = new Date();
    return `${now.getFullYear()}-${padZ(now.getMonth() + 1)}`;
  }

  function isCurrentMonth(monthStr) {
    return monthStr === currentMonthStr();
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

  // ─── DOM 참조 ─────────────────────────────────────
  const els = {
    sidebarFilter: () => document.getElementById('sidebarFilter'),
    intersectionList: () => document.getElementById('intersectionList'),
    prevDay: () => document.getElementById('prevDay'),
    nextDay: () => document.getElementById('nextDay'),
    currentDateBtn: () => document.getElementById('currentDateBtn'),
    datePicker: () => document.getElementById('datePicker'),
    selectedInfo: () => document.getElementById('selectedInfo'),
    selectedName: () => document.getElementById('selectedName'),
    lastUpdateTime: () => document.getElementById('lastUpdateTime'),
    chartPlaceholder: () => document.getElementById('chartPlaceholder'),
    trafficChart: () => document.getElementById('trafficChart'),
    sidebar: () => document.getElementById('sidebar'),
    sidebarToggleBtn: () => document.getElementById('sidebarToggleBtn'),
    sidebarOpenTab: () => document.getElementById('sidebarOpenTab'),
    filterClearBtn: () => document.getElementById('filterClearBtn'),
    backBtn: () => document.getElementById('backBtn'),
    directionButtons: () => document.getElementById('directionButtons'),
    systemHealthBadge: () => document.getElementById('systemHealthBadge'),
    systemHealthDot: () => document.getElementById('systemHealthDot'),
    systemHealthText: () => document.getElementById('systemHealthText'),
  };

  function setSystemHealthUI(status) {
    const badge = els.systemHealthBadge();
    const dot = els.systemHealthDot();
    const text = els.systemHealthText();
    if (!badge || !dot || !text) return;

    dot.classList.remove('bg-tertiary', 'bg-error', 'bg-outline');
    text.classList.remove('text-tertiary', 'text-error', 'text-on-surface-variant');
    badge.disabled = status === 'checking';

    if (status === 'healthy') {
      dot.classList.add('bg-tertiary');
      text.classList.add('text-tertiary');
      text.textContent = '시스템 정상';
      return;
    }

    if (status === 'degraded') {
      dot.classList.add('bg-error');
      text.classList.add('text-error');
      text.textContent = 'DB 연결 불량';
      return;
    }

    dot.classList.add('bg-outline');
    text.classList.add('text-on-surface-variant');
    text.textContent = '상태 확인중';
  }

  function isApiNotAppliedHealthError(err) {
    if (!err || typeof err !== 'object') return false;
    if (err.code === 'HEALTH_API_NOT_APPLIED' || err.reason === 'API_NOT_APPLIED') return true;
    return err.status === 404 && String(err.contentType || '').includes('text/html');
  }

  async function checkSystemHealth() {
    if (healthCheckInFlight) return healthCheckInFlight;

    setSystemHealthUI('checking');
    healthCheckInFlight = requestSystemHealth()
      .then((result) => {
        if (result && result.ok) {
          setSystemHealthUI('healthy');
        } else {
          setSystemHealthUI('degraded');
        }
      })
      .catch((err) => {
        if (err && err.name === 'AbortError') return;
        if (isApiNotAppliedHealthError(err)) {
          console.error('[SystemHealth] /api/system/health API not reflected on running server', {
            status: err.status,
            contentType: err.contentType,
            code: err.code,
            message: err.message,
          });
        } else {
          console.error('[SystemHealth] check failed', {
            status: err && err.status,
            code: err && err.code,
            message: err && err.message,
          });
        }
        setSystemHealthUI('degraded');
      })
      .finally(() => {
        healthCheckInFlight = null;
      });

    return healthCheckInFlight;
  }

  async function requestSystemHealth() {
    if (typeof API.getSystemHealth === 'function') {
      return API.getSystemHealth();
    }

    const res = await fetch('/api/system/health');
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const isJson = contentType.includes('application/json');
    let body = {};

    if (isJson) {
      body = await res.json().catch(() => ({}));
    } else {
      const raw = await res.text().catch(() => '');
      body = raw ? { raw } : {};
    }

    if (!res.ok) {
      const err = new Error(body.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.body = body;
      err.contentType = contentType;
      if (res.status === 404 && !isJson) {
        err.code = 'HEALTH_API_NOT_APPLIED';
        err.reason = 'API_NOT_APPLIED';
      }
      throw err;
    }

    if (!isJson) {
      const err = new Error('Invalid health response content type');
      err.status = res.status;
      err.body = body;
      err.contentType = contentType;
      err.code = 'HEALTH_API_INVALID_RESPONSE';
      throw err;
    }

    return body;
  }

  function startSystemHealthPolling() {
    stopSystemHealthPolling();
    void checkSystemHealth();
    healthPollTimer = setInterval(() => {
      void checkSystemHealth();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  function stopSystemHealthPolling() {
    if (healthPollTimer) {
      clearInterval(healthPollTimer);
      healthPollTimer = null;
    }
  }

  function bindSystemHealthBadgeClick() {
    const badge = els.systemHealthBadge();
    if (!badge) return;
    badge.addEventListener('click', () => {
      void checkSystemHealth();
    });
  }

  // ─── 교차로 목록 렌더 ─────────────────────────────
  function renderSidebarList(list) {
    state.sidebarFocusedIndex = -1;
    const ul = els.intersectionList();
    if (list.length === 0) {
      ul.innerHTML = '<li class="px-3 py-2 text-xs text-outline">결과 없음</li>';
      return;
    }
    ul.innerHTML = list.map(item =>
      `<li data-node="${item.NODE_ID}" data-name="${escHtml(item.CRSRD_NM)}"
           class="px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-white hover:shadow-sm transition-all rounded-xl cursor-pointer${item.NODE_ID === state.selectedNodeId ? ' active' : ''}">
        ${escHtml(item.CRSRD_NM)}</li>`
    ).join('');
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderDirectionButtons(approaches) {
    const container = els.directionButtons();
    if (!container) return;

    if (!state.selectedNodeId || !Array.isArray(approaches) || approaches.length === 0) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    container.innerHTML = approaches.map(ap =>
      `<button type="button" class="direction-btn" data-acsr-id="${escHtml(ap.acsrId)}" data-acsr-name="${escHtml(ap.name)}">${escHtml(ap.name)}</button>`
    ).join('');
    container.style.display = 'flex';
  }

  function bindDirectionButtonClick() {
    const container = els.directionButtons();
    if (!container) return;

    container.addEventListener('click', e => {
      const btn = e.target.closest('button[data-acsr-id][data-acsr-name]');
      if (!btn || !state.selectedNodeId) return;

      const params = new URLSearchParams();
      params.set('node_id', state.selectedNodeId);
      params.set('acsr_id', btn.dataset.acsrId);
      params.set('acsr_name', btn.dataset.acsrName);
      if (state.currentDate) params.set('date', state.currentDate);
      window.location.href = `/direction-detail.html?${params.toString()}`;
    });
  }

  // ─── 그래프 로드 (1일) ───────────────────────────
  async function loadTrafficData() {
    if (!state.selectedNodeId) return;

    const canvas = els.trafficChart();
    const placeholder = els.chartPlaceholder();

    try {
      placeholder.style.display = 'flex';
      placeholder.innerHTML = '<div class="loading-spinner"></div>';
      canvas.style.display = 'none';

      const [{ rows, nullSlots }, approachData] = await Promise.all([
        API.getTraffic(state.selectedNodeId, state.currentDate),
        API.getApproachTraffic(state.selectedNodeId, state.currentDate),
      ]);

      canvas.style.display = 'block';
      placeholder.style.display = 'none';

      ChartManager.init('trafficChart');
      ChartManager.update(rows, state.currentDate === todayStr(), nullSlots);

      // 접근로 차트
      state.currentApproaches = approachData.approaches;
      renderDirectionButtons(state.currentApproaches);
      const approachWrapper = document.getElementById('approachChartWrapper');
      if (approachData.approaches.length > 0) {
        DirectionChartManager.init('approachChart', approachData.approaches);
        DirectionChartManager.update(
          approachData.approaches,
          approachData.rows,
          state.currentDate === todayStr(),
          approachData.nullSlots
        );
        approachWrapper.style.display = 'block';
      } else {
        approachWrapper.style.display = 'none';
        DirectionChartManager.destroy();
      }

      if (rows.length > 0) {
        const last = rows[rows.length - 1];
        const dt = new Date(last.TOT_DT);
        els.lastUpdateTime().textContent =
          `마지막 업데이트: ${padZ(dt.getHours())}:${padZ(dt.getMinutes())}`;
      } else {
        els.lastUpdateTime().textContent = '데이터 없음';
      }
    } catch (err) {
      console.error('[App] 교통량 로드 오류:', err);
      placeholder.style.display = 'flex';
      placeholder.innerHTML = `<p style="color:#ef4444">데이터 로드 실패: ${err.message}</p>`;
      canvas.style.display = 'none';
    }
  }

  // ─── 그래프 로드 (1주일) ─────────────────────────
  async function loadWeeklyData() {
    if (!state.selectedNodeId) return;

    const canvas = els.trafficChart();
    const placeholder = els.chartPlaceholder();

    try {
      placeholder.style.display = 'flex';
      placeholder.innerHTML = '<div class="loading-spinner"></div>';
      canvas.style.display = 'none';

      const [{ rows, nullSlots }, approachData] = await Promise.all([
        API.getWeeklyTraffic(state.selectedNodeId, state.currentWeekStart),
        API.getApproachWeeklyTraffic(state.selectedNodeId, state.currentWeekStart)
          .catch(() => ({ approaches: [], rows: [], nullSlots: {} })),
      ]);

      canvas.style.display = 'block';
      placeholder.style.display = 'none';

      const currentWeek = isCurrentWeek(state.currentWeekStart);
      ChartManager.initWeekly('trafficChart', state.currentWeekStart);
      ChartManager.updateWeekly(rows, state.currentWeekStart, currentWeek, nullSlots);

      // 접근로 차트
      state.currentApproaches = approachData.approaches;
      renderDirectionButtons(state.currentApproaches);
      const approachWrapper = document.getElementById('approachChartWrapper');
      if (approachData.approaches.length > 0) {
        DirectionChartManager.initWeekly('approachChart', approachData.approaches, state.currentWeekStart);
        DirectionChartManager.updateWeekly(
          approachData.approaches, approachData.rows,
          state.currentWeekStart, currentWeek, approachData.nullSlots
        );
        approachWrapper.style.display = 'block';
      } else {
        approachWrapper.style.display = 'none';
        DirectionChartManager.destroy();
      }

      if (rows.length > 0) {
        const last = rows[rows.length - 1];
        const dt = new Date(last.TOT_DT);
        els.lastUpdateTime().textContent =
          `마지막 업데이트: ${padZ(dt.getHours())}:${padZ(dt.getMinutes())}`;
      } else {
        els.lastUpdateTime().textContent = '데이터 없음';
      }
    } catch (err) {
      console.error('[App] 주간 교통량 로드 오류:', err);
      placeholder.style.display = 'flex';
      placeholder.innerHTML = `<p style="color:#ef4444">데이터 로드 실패: ${err.message}</p>`;
      canvas.style.display = 'none';
    }
  }

  // ─── 그래프 로드 (1달) ────────────────────────────
  async function loadMonthlyData() {
    if (!state.selectedNodeId) return;

    const canvas = els.trafficChart();
    const placeholder = els.chartPlaceholder();

    try {
      placeholder.style.display = 'flex';
      placeholder.innerHTML = '<div class="loading-spinner"></div>';
      canvas.style.display = 'none';

      const [{ rows, nullSlots }, approachData] = await Promise.all([
        API.getMonthlyTraffic(state.selectedNodeId, state.currentMonthStr),
        API.getApproachMonthlyTraffic(state.selectedNodeId, state.currentMonthStr)
          .catch(() => ({ approaches: [], rows: [], nullSlots: {} })),
      ]);

      canvas.style.display = 'block';
      placeholder.style.display = 'none';

      const currentMonth = isCurrentMonth(state.currentMonthStr);
      ChartManager.initMonthly('trafficChart', state.currentMonthStr);
      ChartManager.updateMonthly(rows, state.currentMonthStr, currentMonth, nullSlots);

      // 접근로 차트
      state.currentApproaches = approachData.approaches;
      renderDirectionButtons(state.currentApproaches);
      const approachWrapper = document.getElementById('approachChartWrapper');
      if (approachData.approaches.length > 0) {
        DirectionChartManager.initMonthly('approachChart', approachData.approaches, state.currentMonthStr);
        DirectionChartManager.updateMonthly(
          approachData.approaches, approachData.rows,
          state.currentMonthStr, currentMonth, approachData.nullSlots
        );
        approachWrapper.style.display = 'block';
      } else {
        approachWrapper.style.display = 'none';
        DirectionChartManager.destroy();
      }

      if (rows.length > 0) {
        const last = rows[rows.length - 1];
        const dt = new Date(last.TOT_DT);
        const y = dt.getFullYear();
        const m = padZ(dt.getMonth() + 1);
        const d = padZ(dt.getDate());
        els.lastUpdateTime().textContent = `마지막 업데이트: ${y}.${m}.${d} ${padZ(dt.getHours())}:00`;
      } else {
        els.lastUpdateTime().textContent = '데이터 없음';
      }
    } catch (err) {
      console.error('[App] 월간 교통량 로드 오류:', err);
      placeholder.style.display = 'flex';
      placeholder.innerHTML = `<p style="color:#ef4444">데이터 로드 실패: ${err.message}</p>`;
      canvas.style.display = 'none';
    }
  }

  // ─── 그래프 로드 (1년) ────────────────────────────
  async function loadYearlyData() {
    if (!state.selectedNodeId) return;

    const canvas = els.trafficChart();
    const placeholder = els.chartPlaceholder();

    try {
      placeholder.style.display = 'flex';
      placeholder.innerHTML = '<div class="loading-spinner"></div>';
      canvas.style.display = 'none';

      const [{ rows, nullSlots }, approachData] = await Promise.all([
        API.getYearlyTraffic(state.selectedNodeId, state.currentYearStr),
        API.getApproachYearlyTraffic(state.selectedNodeId, state.currentYearStr)
          .catch(() => ({ approaches: [], rows: [], nullSlots: [] })),
      ]);

      canvas.style.display = 'block';
      placeholder.style.display = 'none';

      const currentYear = isCurrentYear(state.currentYearStr);
      ChartManager.initYearly('trafficChart', state.currentYearStr);
      ChartManager.updateYearly(rows, state.currentYearStr, currentYear, nullSlots);

      // 접근로 차트
      state.currentApproaches = approachData.approaches;
      renderDirectionButtons(state.currentApproaches);
      const approachWrapper = document.getElementById('approachChartWrapper');
      if (approachData.approaches.length > 0) {
        DirectionChartManager.initYearly('approachChart', approachData.approaches, state.currentYearStr);
        DirectionChartManager.updateYearly(
          approachData.approaches, approachData.rows,
          state.currentYearStr, currentYear, approachData.nullSlots
        );
        approachWrapper.style.display = 'block';
      } else {
        approachWrapper.style.display = 'none';
        DirectionChartManager.destroy();
      }

      if (rows.length > 0) {
        const last = rows[rows.length - 1];
        const dt = new Date(last.TOT_DT);
        const y = dt.getFullYear();
        const m = padZ(dt.getMonth() + 1);
        const d = padZ(dt.getDate());
        els.lastUpdateTime().textContent = `마지막 업데이트: ${y}.${m}.${d}`;
      } else {
        els.lastUpdateTime().textContent = '데이터 없음';
      }
    } catch (err) {
      console.error('[App] 연간 교통량 로드 오류:', err);
      placeholder.style.display = 'flex';
      placeholder.innerHTML = `<p style="color:#ef4444">데이터 로드 실패: ${err.message}</p>`;
      canvas.style.display = 'none';
    }
  }

  // ─── 교차로 선택 ─────────────────────────────────
  function selectIntersection(nodeId, name, skipHistory = false) {
    if (!skipHistory && state.selectedNodeId) {
      state.intersectionHistory.push({ nodeId: state.selectedNodeId, name: state.selectedName });
      els.backBtn().style.display = '';
    }
    state.selectedNodeId = nodeId;
    state.selectedName = name;

    els.selectedInfo().style.display = 'flex';
    els.selectedName().textContent = name;
    renderDirectionButtons([]);

    renderSidebarList(
      state.allIntersections.filter(i =>
        filterText(i.CRSRD_NM, els.sidebarFilter().value)
      )
    );

    if (state.currentPeriod === '1w') {
      loadWeeklyData();
    } else if (state.currentPeriod === '1m') {
      loadMonthlyData();
    } else if (state.currentPeriod === '1y') {
      loadYearlyData();
    } else {
      loadTrafficData();
    }
  }

  function filterText(text, query) {
    if (!query) return true;
    return String(text).toLowerCase().includes(query.toLowerCase());
  }

  // ─── 사이드바 클릭 위임 ───────────────────────────
  function bindSidebarClick() {
    els.intersectionList().addEventListener('click', e => {
      const li = e.target.closest('li[data-node]');
      if (!li) return;
      selectIntersection(li.dataset.node, li.dataset.name);
    });
  }

  // ─── 사이드바 필터 ───────────────────────────────
  function bindSidebarFilter() {
    const filterInput = els.sidebarFilter();
    const clearBtn = els.filterClearBtn();
    let debounceTimer = null;

    filterInput.addEventListener('input', e => {
      clearBtn.style.display = e.target.value ? 'block' : 'none';
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const q = e.target.value;
        const filtered = state.allIntersections.filter(i => filterText(i.CRSRD_NM, q));
        renderSidebarList(filtered);
      }, 200);
    });

    clearBtn.addEventListener('click', () => {
      filterInput.value = '';
      clearBtn.style.display = 'none';
      renderSidebarList(state.allIntersections);
      filterInput.focus();
    });

    filterInput.addEventListener('keydown', e => {
      const items = els.intersectionList().querySelectorAll('li[data-node]');
      if (!items.length) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.sidebarFocusedIndex = Math.min(state.sidebarFocusedIndex + 1, items.length - 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.sidebarFocusedIndex = Math.max(state.sidebarFocusedIndex - 1, 0);
      } else if (e.key === 'Enter') {
        const idx = state.sidebarFocusedIndex >= 0 ? state.sidebarFocusedIndex : 0;
        const target = items[idx];
        if (target) {
          selectIntersection(target.dataset.node, target.dataset.name);
          state.sidebarFocusedIndex = idx; // renderSidebarList가 -1로 리셋한 것을 복원
        }
        return;
      } else {
        return;
      }

      items.forEach(li => li.classList.remove('keyboard-focused', 'active'));
      items[state.sidebarFocusedIndex].classList.add('keyboard-focused');
      items[state.sidebarFocusedIndex].scrollIntoView({ block: 'nearest' });
    });
  }

  // ─── 사이드바 토글 ───────────────────────────────
  function bindSidebarToggle() {
    els.sidebarToggleBtn().addEventListener('click', () => {
      const sidebar = els.sidebar();
      sidebar.style.width = '0';
      sidebar.style.overflow = 'hidden';
      els.sidebarOpenTab().style.display = 'flex';
      document.querySelector('main').style.marginLeft = '0';
    });

    els.sidebarOpenTab().addEventListener('click', () => {
      const sidebar = els.sidebar();
      const saved = localStorage.getItem('sidebarWidth');
      sidebar.style.width = saved ? saved + 'px' : '16rem';
      sidebar.style.overflow = '';
      els.sidebarOpenTab().style.display = 'none';
      document.querySelector('main').style.marginLeft = saved ? saved + 'px' : '16rem';
    });
  }

  // ─── 날짜 표시 업데이트 ──────────────────────────
  function updateDateDisplay() {
    if (state.currentPeriod === '1w') {
      els.currentDateBtn().textContent = weekDisplayLabel(state.currentWeekStart);
      els.nextDay().disabled = isCurrentWeek(state.currentWeekStart);
    } else if (state.currentPeriod === '1m') {
      const [y, m] = state.currentMonthStr.split('-');
      els.currentDateBtn().textContent = `${y}.${m}`;
      els.nextDay().disabled = isCurrentMonth(state.currentMonthStr);
    } else if (state.currentPeriod === '1y') {
      els.currentDateBtn().textContent = `${state.currentYearStr}년`;
      els.nextDay().disabled = isCurrentYear(state.currentYearStr);
    } else {
      const [y, m, d] = state.currentDate.split('-');
      els.currentDateBtn().textContent = `${y}.${m}.${d}`;
      els.nextDay().disabled = (state.currentDate >= todayStr());
    }
  }

  // ─── 날짜/주/월 이동 ──────────────────────────────
  function changeDate(delta) {
    if (state.currentPeriod === '1w') {
      changeWeek(delta);
    } else if (state.currentPeriod === '1m') {
      changeMonth(delta);
    } else if (state.currentPeriod === '1y') {
      changeYear(delta);
    } else {
      changeDailyDate(delta);
    }
  }

  function changeDailyDate(delta) {
    const [y, m, d] = state.currentDate.split('-').map(Number);
    const date = new Date(y, m - 1, d + delta);
    const newDate = `${date.getFullYear()}-${padZ(date.getMonth() + 1)}-${padZ(date.getDate())}`;
    if (newDate > todayStr()) return;
    state.currentDate = newDate;
    updateDateDisplay();
    loadTrafficData();
  }

  function changeWeek(delta) {
    const newWeekStart = shiftWeek(state.currentWeekStart, delta);
    const todayWeekStart = getWeekStart(todayStr());
    if (newWeekStart > todayWeekStart) return;
    state.currentWeekStart = newWeekStart;
    updateDateDisplay();
    loadWeeklyData();
  }

  function changeMonth(delta) {
    const newMonthStr = shiftMonth(state.currentMonthStr, delta);
    const todayMonthStr = currentMonthStr();
    if (newMonthStr > todayMonthStr) return;
    state.currentMonthStr = newMonthStr;
    updateDateDisplay();
    loadMonthlyData();
  }

  function changeYear(delta) {
    const newYear = shiftYear(state.currentYearStr, delta);
    if (parseInt(newYear, 10) > new Date().getFullYear()) return;
    state.currentYearStr = newYear;
    updateDateDisplay();
    loadYearlyData();
  }

  // ─── 날짜 네비게이션 바인딩 ──────────────────────
  function bindDateNav() {
    els.prevDay().addEventListener('click', () => changeDate(-1));
    els.nextDay().addEventListener('click', () => changeDate(1));

    els.currentDateBtn().addEventListener('click', () => {
      if (state.currentPeriod === '1w') {
        WeeklyCalendar.open(state.currentWeekStart, (selectedWeekStart) => {
          state.currentWeekStart = selectedWeekStart;
          updateDateDisplay();
          loadWeeklyData();
        });
      } else if (state.currentPeriod === '1m') {
        MonthlyCalendar.open(state.currentMonthStr, (selectedMonth) => {
          state.currentMonthStr = selectedMonth;
          updateDateDisplay();
          loadMonthlyData();
        });
      } else if (state.currentPeriod === '1y') {
        YearlyNavigator.open(state.currentYearStr, (selectedYear) => {
          state.currentYearStr = selectedYear;
          updateDateDisplay();
          loadYearlyData();
        });
      } else {
        const picker = els.datePicker();
        picker.value = state.currentDate;
        picker.max = todayStr();
        picker.showPicker();
      }
    });

    els.datePicker().addEventListener('change', e => {
      if (state.currentPeriod !== '1d') return;
      const val = e.target.value;
      if (!val || val > todayStr()) return;
      state.currentDate = val;
      updateDateDisplay();
      loadTrafficData();
    });

    updateDateDisplay();
  }

  // ─── granularity label ──────────────────────────
  function updateGranularityLabel(period) {
    const el = document.getElementById('chartGranularity');
    if (!el) return;
    const map = { '1d': '5분 단위', '1w': '15분 단위', '1m': '1시간 단위', '1y': '1일 단위' };
    el.textContent = map[period] ? `(${map[period]})` : '';
  }

  // ─── 기간 버튼 ───────────────────────────────────
  function bindPeriodButtons() {
    document.querySelectorAll('.btn-period').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.btn-period').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const period = btn.dataset.period;
        state.currentPeriod = period;

        updateGranularityLabel(period);
        if (period === '1w') {
          state.currentWeekStart = getWeekStart(state.currentDate);
          updateDateDisplay();
          loadWeeklyData();
        } else if (period === '1m') {
          state.currentMonthStr = currentMonthStr();
          updateDateDisplay();
          loadMonthlyData();
        } else if (period === '1d') {
          updateDateDisplay();
          loadTrafficData();
        } else if (period === '1y') {
          state.currentYearStr = currentYearStrFn();
          updateDateDisplay();
          loadYearlyData();
        }
      });
    });
  }

  // ─── SSE 연결 ─────────────────────────────────────
  function initSSE() {
    API.connectSSE(() => { });

    // 1일 null-slots
    API.on('null-slots', ({ nullSlots }) => {
      if (state.currentPeriod !== '1d') return;
      if (state.currentDate === todayStr()) {
        ChartManager.applyNullSlots(nullSlots, state.currentDate);
        DirectionChartManager.applyNullSlots(nullSlots, state.currentDate);
      }
    });

    // 1일 traffic-update
    API.on('traffic-update', ({ rows, nullSlots }) => {
      if (state.currentPeriod !== '1d') return;
      if (!state.selectedNodeId) return;
      const updated = ChartManager.mergeNewRows(rows, state.selectedNodeId, state.currentDate, nullSlots);
      if (updated) {
        const myRows = rows.filter(r =>
          r.NODE_ID === state.selectedNodeId &&
          new Date(r.TOT_DT).toISOString().slice(0, 10) === state.currentDate
        );
        if (myRows.length > 0) {
          const last = myRows[myRows.length - 1];
          const dt = new Date(last.TOT_DT);
          els.lastUpdateTime().textContent =
            `마지막 업데이트: ${padZ(dt.getHours())}:${padZ(dt.getMinutes())}`;
        }
      }
    });

    // 1일 approach-traffic-update
    API.on('approach-traffic-update', ({ rows, nullSlots }) => {
      if (state.currentPeriod !== '1d') return;
      if (!state.selectedNodeId || state.currentDate !== todayStr()) return;
      DirectionChartManager.mergeNewRows(rows, state.selectedNodeId, state.currentDate, nullSlots);
    });

    // 월간 hourly-null-slots
    API.on('hourly-null-slots', ({ nullSlots }) => {
      if (state.currentPeriod === '1m') {
        if (!state.currentMonthStr || !isCurrentMonth(state.currentMonthStr)) return;
        const today = new Date().toISOString().slice(0, 10);
        ChartManager.applyDailyNullSlots({ [today]: nullSlots }, state.currentMonthStr);
      }
    });

    // 1주 fifteen-min-null-slots
    API.on('fifteen-min-null-slots', ({ nullSlots }) => {
      if (state.currentPeriod !== '1w') return;
      if (!state.currentWeekStart || !isCurrentWeek(state.currentWeekStart)) return;
      const today = todayStr();
      ChartManager.applyHourlyNullSlots({ [today]: nullSlots }, state.currentWeekStart);
    });

    // 1주 fifteen-min-traffic-update
    API.on('fifteen-min-traffic-update', ({ rows, nullSlots }) => {
      if (state.currentPeriod !== '1w') return;
      if (!state.selectedNodeId || !state.currentWeekStart || !isCurrentWeek(state.currentWeekStart)) return;
      const today = todayStr();
      const nullSlotsObj = nullSlots.length > 0 ? { [today]: nullSlots } : {};
      const updated = ChartManager.mergeNewHourlyRows(
        rows, state.selectedNodeId, state.currentWeekStart, nullSlotsObj
      );
      if (updated) {
        const myRows = rows.filter(r =>
          r.NODE_ID === state.selectedNodeId &&
          new Date(r.TOT_DT).toISOString().slice(0, 10) === today
        );
        if (myRows.length > 0) {
          const last = myRows[myRows.length - 1];
          const dt = new Date(last.TOT_DT);
          els.lastUpdateTime().textContent =
            `마지막 업데이트: ${padZ(dt.getHours())}:${padZ(dt.getMinutes())}`;
        }
      }
    });

    // 월간 hourly-traffic-update
    API.on('hourly-traffic-update', ({ rows, nullSlots }) => {
      if (state.currentPeriod === '1m') {
        if (!state.selectedNodeId || !state.currentMonthStr || !isCurrentMonth(state.currentMonthStr)) return;
        const today = new Date().toISOString().slice(0, 10);
        const updated = ChartManager.mergeNewDailyRows(
          rows, state.selectedNodeId, state.currentMonthStr, { [today]: nullSlots }
        );
        if (updated) {
          const myRows = rows.filter(r =>
            r.NODE_ID === state.selectedNodeId &&
            new Date(r.TOT_DT).toISOString().slice(0, 7) === state.currentMonthStr
          );
          if (myRows.length > 0) {
            const last = myRows[myRows.length - 1];
            const dt = new Date(last.TOT_DT);
            els.lastUpdateTime().textContent =
              `마지막 업데이트: ${dt.getFullYear()}.${padZ(dt.getMonth() + 1)}.${padZ(dt.getDate())} ${padZ(dt.getHours())}:00`;
          }
        }
      }
    });

    // 연간 daily-null-slots
    API.on('daily-null-slots', ({ nullSlots }) => {
      if (state.currentPeriod === '1y') {
        if (!state.currentYearStr || !isCurrentYear(state.currentYearStr)) return;
        ChartManager.applyDailyNullSlotsYearly(nullSlots, state.currentYearStr);
      }
    });

    // 연간 daily-traffic-update
    API.on('daily-traffic-update', ({ rows, nullSlots }) => {
      if (state.currentPeriod === '1y') {
        if (!state.selectedNodeId || !state.currentYearStr || !isCurrentYear(state.currentYearStr)) return;
        const updated = ChartManager.mergeNewDailyRowsYearly(
          rows, state.selectedNodeId, state.currentYearStr, nullSlots
        );
        if (updated) {
          const myRows = rows.filter(r =>
            r.NODE_ID === state.selectedNodeId &&
            String(new Date(r.TOT_DT).getFullYear()) === state.currentYearStr
          );
          if (myRows.length > 0) {
            const last = myRows[myRows.length - 1];
            const dt = new Date(last.TOT_DT);
            const y = dt.getFullYear();
            const m = padZ(dt.getMonth() + 1);
            const d = padZ(dt.getDate());
            els.lastUpdateTime().textContent = `마지막 업데이트: ${y}.${m}.${d}`;
          }
        }
      }
    });
  }

  // ─── 사이드바 너비 조정 ───────────────────────────
  function initSidebarResize() {
    const sidebar = document.getElementById('sidebar');
    const handle = document.getElementById('sidebarResizeHandle');
    if (!handle || !sidebar) return;
    let startX, startWidth;
    handle.addEventListener('mousedown', e => {
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      handle.classList.add('dragging');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
    function onMove(e) {
      const w = Math.max(140, Math.min(400, startWidth + e.clientX - startX));
      sidebar.style.width = w + 'px';
      document.querySelector('main').style.marginLeft = w + 'px';
    }
    function onUp() {
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      localStorage.setItem('sidebarWidth', sidebar.offsetWidth);
    }
  }

  // ─── 초기화 ───────────────────────────────────────
  async function init() {
    SidebarComponent.render('sidebar-container', 'traffic');

    els.backBtn().addEventListener('click', () => {
      const prev = state.intersectionHistory.pop();
      if (!prev) return;
      selectIntersection(prev.nodeId, prev.name, true);
      els.backBtn().style.display = state.intersectionHistory.length === 0 ? 'none' : '';
    });

    bindSidebarToggle();
    bindSidebarClick();
    initSidebarResize();
    const savedSidebarWidth = localStorage.getItem('sidebarWidth');
    if (savedSidebarWidth) {
      document.getElementById('sidebar').style.width = savedSidebarWidth + 'px';
      document.querySelector('main').style.marginLeft = savedSidebarWidth + 'px';
    }
    bindSidebarFilter();
    bindDateNav();
    bindPeriodButtons();
    bindDirectionButtonClick();
    bindSystemHealthBadgeClick();
    updateGranularityLabel(state.currentPeriod);

    // ─── 페이지 생명주기 관리 (bfcache + fetch 누적 방지) ─────────────────
    let _ctrl = new AbortController();
    API.setAbortSignal(_ctrl.signal);
    startSystemHealthPolling();

    window.addEventListener('pagehide', () => {
      stopSystemHealthPolling();
      _ctrl.abort();
      API.disconnectSSE();
    });

    window.addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      _ctrl = new AbortController();
      API.setAbortSignal(_ctrl.signal);
      API.connectSSE(() => {});
      startSystemHealthPolling();
      if (state.selectedNodeId) {
        selectIntersection(state.selectedNodeId, state.selectedName, true);
      }
    });

    initSSE();

    try {
      state.allIntersections = await API.getIntersections();
      renderSidebarList(state.allIntersections);

      // URL 파라미터로 교차로 자동 선택 (홈에서 이동 시)
      const urlParams = new URLSearchParams(location.search);
      const initNodeId = urlParams.get('node_id');
      const initDate = urlParams.get('date');
      if (initNodeId) {
        if (initDate && initDate <= todayStr()) {
          state.currentDate = initDate;
          updateDateDisplay();
        }
        const found = state.allIntersections.find(i => i.NODE_ID === initNodeId);
        if (found) selectIntersection(found.NODE_ID, found.CRSRD_NM);
      }
    } catch (err) {
      console.error('[App] 교차로 목록 로드 오류:', err);
      els.intersectionList().innerHTML =
        '<li class="list-placeholder" style="color:#ef4444">목록 로드 실패</li>';
    }
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
