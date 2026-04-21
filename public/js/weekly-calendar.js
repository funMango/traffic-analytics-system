'use strict';

/**
 * 주단위 달력 팝업 (IIFE 모듈)
 * WeeklyCalendar.open(currentWeekStart, onSelect)
 * WeeklyCalendar.close()
 */
const WeeklyCalendar = (() => {
  let overlay = null;
  let currentYear = 0;
  let currentMonth = 0;   // 0-indexed
  let onSelectCallback = null;
  let hoveredWeekStart = null;
  let yearPickerOpen = false;
  let monthPickerOpen = false;
  const MIN_YEAR = 2000;

  const MONTHS_KO = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

  function todayStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function makeDateStr(y, m0, d) {
    // m0 is 0-indexed
    return `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function getWeekStart(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - dt.getDay()); // 일요일로
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  function showDayGrid() {
    yearPickerOpen = false;
    monthPickerOpen = false;
    const yp = document.getElementById('wcYearPicker');
    const mp = document.getElementById('wcMonthPicker');
    const wd = document.getElementById('wcWeekdays');
    const dg = document.getElementById('wcDaysGrid');
    if (yp) yp.style.display = 'none';
    if (mp) mp.style.display = 'none';
    if (wd) wd.style.display = 'grid';
    if (dg) dg.style.display = 'grid';
  }

  function showYearPicker() {
    yearPickerOpen = true;
    monthPickerOpen = false;
    renderYearGrid();
    document.getElementById('wcYearPicker').style.display = 'block';
    document.getElementById('wcMonthPicker').style.display = 'none';
    document.getElementById('wcWeekdays').style.display = 'none';
    document.getElementById('wcDaysGrid').style.display = 'none';
    const selected = document.querySelector('.wc-year-item--selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }

  function showMonthPicker() {
    monthPickerOpen = true;
    yearPickerOpen = false;
    renderMonthGrid();
    document.getElementById('wcMonthPicker').style.display = 'block';
    document.getElementById('wcYearPicker').style.display = 'none';
    document.getElementById('wcWeekdays').style.display = 'none';
    document.getElementById('wcDaysGrid').style.display = 'none';
  }

  function renderYearGrid() {
    const grid = document.getElementById('wcYearGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const nowYear = new Date().getFullYear();
    for (let y = MIN_YEAR; y <= nowYear; y++) {
      const btn = document.createElement('button');
      btn.className = 'wc-year-item' + (y === currentYear ? ' wc-year-item--selected' : '');
      btn.textContent = `${y}년`;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        currentYear = y;
        // 선택된 년도의 현재 월이 미래면 최근 유효 월로 조정
        const now = new Date();
        if (currentYear === now.getFullYear() && currentMonth > now.getMonth()) {
          currentMonth = now.getMonth();
        }
        showDayGrid();
        render();
      });
      grid.appendChild(btn);
    }
  }

  function renderMonthGrid() {
    const grid = document.getElementById('wcMonthsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const now = new Date();
    for (let m = 0; m < 12; m++) {
      const btn = document.createElement('button');
      btn.className = 'wc-month-item';
      btn.textContent = MONTHS_KO[m];
      const isFuture = currentYear > now.getFullYear() ||
        (currentYear === now.getFullYear() && m > now.getMonth());
      if (isFuture) {
        btn.classList.add('wc-month-item--disabled');
        btn.disabled = true;
      } else {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          currentMonth = m;
          showDayGrid();
          render();
        });
      }
      grid.appendChild(btn);
    }
  }

  function ensureOverlay() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = 'weeklyCalendarOverlay';
    overlay.className = 'wc-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <div class="wc-popup">
        <div class="wc-header">
          <button class="wc-nav-btn" id="wcPrevMonth">&#8592;</button>
          <div class="wc-month-label">
            <button class="wc-year-btn" id="wcYearBtn"></button>
            <button class="wc-month-btn" id="wcMonthBtn"></button>
          </div>
          <button class="wc-nav-btn" id="wcNextMonth">&#8594;</button>
        </div>
        <div class="wc-weekdays" id="wcWeekdays">
          <span>일</span><span>월</span><span>화</span>
          <span>수</span><span>목</span><span>금</span><span>토</span>
        </div>
        <div class="wc-days-grid" id="wcDaysGrid"></div>
        <div class="wc-year-picker" id="wcYearPicker" style="display:none;">
          <div class="wc-year-grid" id="wcYearGrid"></div>
        </div>
        <div class="wc-month-picker" id="wcMonthPicker" style="display:none;">
          <div class="wc-months-grid" id="wcMonthsGrid"></div>
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

    document.getElementById('wcPrevMonth').addEventListener('click', e => {
      e.stopPropagation();
      currentMonth--;
      if (currentMonth < 0) { currentMonth = 11; currentYear--; }
      hoveredWeekStart = null;
      render();
    });

    document.getElementById('wcNextMonth').addEventListener('click', e => {
      e.stopPropagation();
      const now = new Date();
      // 현재 달 이후로는 이동 불가
      if (currentYear < now.getFullYear() ||
          (currentYear === now.getFullYear() && currentMonth < now.getMonth())) {
        currentMonth++;
        if (currentMonth > 11) { currentMonth = 0; currentYear++; }
        hoveredWeekStart = null;
        render();
      }
    });

    document.getElementById('wcYearBtn').addEventListener('click', e => {
      e.stopPropagation();
      yearPickerOpen ? showDayGrid() : showYearPicker();
    });

    document.getElementById('wcMonthBtn').addEventListener('click', e => {
      e.stopPropagation();
      monthPickerOpen ? showDayGrid() : showMonthPicker();
    });
  }

  function open(currentWeekStart, onSelect) {
    ensureOverlay();
    onSelectCallback = onSelect;
    hoveredWeekStart = null;

    // 시작 달 = currentWeekStart 기준
    const [y, m] = currentWeekStart.split('-').map(Number);
    currentYear = y;
    currentMonth = m - 1; // 0-indexed

    render();
    overlay.style.display = 'flex';
  }

  function close() {
    if (overlay) overlay.style.display = 'none';
    hoveredWeekStart = null;
    showDayGrid();  // 다음 open 시 dayGrid 뷰로 시작
  }

  function render() {
    const yearBtn = document.getElementById('wcYearBtn');
    const monthBtn = document.getElementById('wcMonthBtn');
    const grid = document.getElementById('wcDaysGrid');
    const nextBtn = document.getElementById('wcNextMonth');
    if (!yearBtn || !monthBtn || !grid) return;

    yearBtn.textContent = `${currentYear}년`;
    monthBtn.textContent = MONTHS_KO[currentMonth];

    // 다음 달 버튼 비활성화 (현재 달 이후 이동 불가)
    const now = new Date();
    if (nextBtn) {
      nextBtn.disabled = (
        currentYear > now.getFullYear() ||
        (currentYear === now.getFullYear() && currentMonth >= now.getMonth())
      );
    }

    grid.innerHTML = '';

    const today = todayStr();
    const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay();
    const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();

    let day = 1 - firstDayOfWeek;

    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 7; col++) {
        const btn = document.createElement('button');

        if (day >= 1 && day <= lastDay) {
          const ds = makeDateStr(currentYear, currentMonth, day);
          btn.dataset.date = ds;
          btn.textContent = day;
          btn.className = 'wc-day';

          if (ds > today) {
            btn.classList.add('wc-day--disabled');
            btn.disabled = true;
          } else {
            // hover 하이라이트 적용
            if (hoveredWeekStart) {
              const ws = getWeekStart(ds);
              if (ws === hoveredWeekStart) {
                btn.classList.add('wc-day--in-range');
              }
            }

            btn.addEventListener('mouseenter', () => {
              hoveredWeekStart = getWeekStart(ds);
              updateHighlights();
            });
            btn.addEventListener('mouseleave', () => {
              hoveredWeekStart = null;
              updateHighlights();
            });
            btn.addEventListener('click', e => {
              e.stopPropagation();
              onDayClick(ds);
            });
          }
        } else {
          btn.className = 'wc-day wc-day--empty';
          btn.disabled = true;
        }

        grid.appendChild(btn);
        day++;
      }
    }
  }

  function updateHighlights() {
    const grid = document.getElementById('wcDaysGrid');
    if (!grid) return;
    const today = todayStr();

    grid.querySelectorAll('.wc-day[data-date]').forEach(btn => {
      btn.classList.remove('wc-day--in-range');
      if (hoveredWeekStart && btn.dataset.date <= today) {
        const ws = getWeekStart(btn.dataset.date);
        if (ws === hoveredWeekStart) {
          btn.classList.add('wc-day--in-range');
        }
      }
    });
  }

  function onDayClick(dateStr) {
    const ws = getWeekStart(dateStr);
    if (onSelectCallback) onSelectCallback(ws);
    close();
  }

  return { open, close };
})();
