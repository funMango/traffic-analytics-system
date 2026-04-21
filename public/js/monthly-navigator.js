'use strict';

/**
 * 월 선택 팝업 (IIFE 모듈)
 * MonthlyCalendar.open(currentMonthStr, onSelect)
 * MonthlyCalendar.close()
 */
const MonthlyCalendar = (() => {
  let overlay = null;
  let currentYear = 0;
  let onSelectCallback = null;
  const MIN_YEAR = 2000;
  let yearPickerOpen = false;

  const MONTHS_KO = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

  function todayStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function makeMonthStr(y, m0) {
    // m0 is 0-indexed (0-11)
    return `${y}-${String(m0 + 1).padStart(2, '0')}`;
  }

  function ensureOverlay() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = 'monthlyCalendarOverlay';
    overlay.className = 'mc-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <div class="mc-popup">
        <div class="mc-header">
          <button class="mc-nav-btn" id="mcPrevYear">&#8592;</button>
          <button class="mc-year-btn" id="mcYearLabel"></button>
          <button class="mc-nav-btn" id="mcNextYear">&#8594;</button>
        </div>
        <div class="mc-months-grid" id="mcMonthsGrid"></div>
        <div class="mc-year-picker" id="mcYearPicker">
          <div class="mc-year-grid" id="mcYearGrid"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // 오버레이 바깥 클릭 → 닫기
    overlay.addEventListener('click', e => {
      if (e.target === overlay) close();
    });

    // ESC 키 → 닫기
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay.style.display !== 'none') close();
    });

    document.getElementById('mcYearLabel').addEventListener('click', e => {
      e.stopPropagation();
      toggleYearPicker();
    });

    document.getElementById('mcPrevYear').addEventListener('click', e => {
      e.stopPropagation();
      currentYear--;
      render();
    });

    document.getElementById('mcNextYear').addEventListener('click', e => {
      e.stopPropagation();
      const now = new Date();
      // 현재 연도 이후로는 이동 불가
      if (currentYear < now.getFullYear()) {
        currentYear++;
        render();
      }
    });
  }

  function open(currentMonthStr, onSelect) {
    ensureOverlay();
    onSelectCallback = onSelect;

    // 시작 연도 = currentMonthStr 기준
    const [y] = currentMonthStr.split('-').map(Number);
    currentYear = y;

    render();
    overlay.style.display = 'flex';
  }

  function toggleYearPicker() {
    yearPickerOpen ? hideYearPicker() : showYearPicker();
  }

  function showYearPicker() {
    yearPickerOpen = true;
    renderYearGrid();
    document.getElementById('mcYearPicker').style.display = 'block';
    document.getElementById('mcMonthsGrid').style.display = 'none';
    const selected = document.querySelector('.mc-year-item--selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }

  function hideYearPicker() {
    yearPickerOpen = false;
    document.getElementById('mcYearPicker').style.display = 'none';
    document.getElementById('mcMonthsGrid').style.display = 'grid';
  }

  function renderYearGrid() {
    const grid = document.getElementById('mcYearGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const nowYear = new Date().getFullYear();

    for (let y = MIN_YEAR; y <= nowYear; y++) {
      const btn = document.createElement('button');
      btn.className = 'mc-year-item';
      btn.textContent = `${y}년`;
      if (y === currentYear) btn.classList.add('mc-year-item--selected');
      btn.addEventListener('click', e => {
        e.stopPropagation();
        currentYear = y;
        hideYearPicker();
        render();
      });
      grid.appendChild(btn);
    }
  }

  function close() {
    if (overlay) overlay.style.display = 'none';
    yearPickerOpen = false;
  }

  function render() {
    const yearLabel = document.getElementById('mcYearLabel');
    const grid = document.getElementById('mcMonthsGrid');
    const nextBtn = document.getElementById('mcNextYear');
    if (!yearLabel || !grid) return;

    yearLabel.textContent = `${currentYear}년`;

    // 다음 연도 버튼 비활성화 (현재 연도 이후 이동 불가)
    const now = new Date();
    if (nextBtn) {
      nextBtn.disabled = (currentYear >= now.getFullYear());
    }

    grid.innerHTML = '';

    const today = todayStr();
    const todayYear = parseInt(today.split('-')[0]);
    const todayMonth = parseInt(today.split('-')[1]);

    for (let m0 = 0; m0 < 12; m0++) {
      const btn = document.createElement('button');
      btn.className = 'mc-month';
      btn.textContent = MONTHS_KO[m0];

      const monthStr = makeMonthStr(currentYear, m0);
      const monthYear = parseInt(monthStr.split('-')[0]);
      const monthNum = parseInt(monthStr.split('-')[1]);

      // 미래 월 = disabled
      if (monthYear > todayYear || (monthYear === todayYear && monthNum > todayMonth)) {
        btn.classList.add('mc-month--disabled');
        btn.disabled = true;
      } else {
        btn.dataset.month = monthStr;
        btn.addEventListener('click', e => {
          e.stopPropagation();
          onMonthClick(monthStr);
        });
      }

      grid.appendChild(btn);
    }
  }

  function onMonthClick(monthStr) {
    if (onSelectCallback) onSelectCallback(monthStr);
    close();
  }

  return { open, close };
})();
