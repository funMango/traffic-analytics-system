'use strict';

// ── 유틸 ────────────────────────────────────────────────────────────────────
function padZ(n) { return String(n).padStart(2, '0'); }
function dateToStr(d) { return `${d.getFullYear()}-${padZ(d.getMonth() + 1)}-${padZ(d.getDate())}`; }
function todayStr() { return dateToStr(new Date()); }

function isCurrentYear(yearStr) {
  return parseInt(yearStr, 10) === new Date().getFullYear();
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── 프론트엔드 캐시 (localStorage, stale-while-revalidate) ─────────────────
const HEATMAP_CACHE_PREFIX = 'home.hm.v1.';
const HEATMAP_CACHE_VERSION = 1;
const HEATMAP_CACHE_KEEP_YEARS = 3;
const TODAY_ABNORMAL_CACHE_PREFIX = 'home.ta.v1.';
const TODAY_ABNORMAL_CACHE_VERSION = 1;
const HEATMAP_TYPES = new Set(['node', 'direction']);

function getHeatmapCacheKey(year, type) {
  return `${HEATMAP_CACHE_PREFIX}${year}.${type}`;
}

function getTodayAbnormalCacheKey(dateStr) {
  return `${TODAY_ABNORMAL_CACHE_PREFIX}${dateStr}`;
}

function toHeatmapSlots(payload) {
  if (!payload || !Array.isArray(payload.slots)) return [];
  return payload.slots.filter(slot => slot && typeof slot.slotKey === 'string');
}

function pruneHeatmapCache() {
  try {
    const currentYear = new Date().getFullYear();
    const minYear = currentYear - (HEATMAP_CACHE_KEEP_YEARS - 1);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(HEATMAP_CACHE_PREFIX)) continue;

      const parts = key.split('.');
      if (parts.length !== 5) {
        localStorage.removeItem(key);
        continue;
      }

      const year = parseInt(parts[3], 10);
      const type = parts[4];
      if (!Number.isFinite(year) || !HEATMAP_TYPES.has(type) || year < minYear || year > currentYear) {
        localStorage.removeItem(key);
      }
    }
  } catch (e) {
    console.warn('[HomeApp] 히트맵 캐시 정리 실패:', e.name, e.message);
  }
}

function getCachedHeatmap(year, type) {
  if (!HEATMAP_TYPES.has(type)) return null;
  pruneHeatmapCache();
  try {
    const raw = localStorage.getItem(getHeatmapCacheKey(year, type));
    if (!raw) return null;

    const cached = JSON.parse(raw);
    if (!cached || typeof cached !== 'object') return null;
    if (cached.version !== HEATMAP_CACHE_VERSION) return null;
    if (String(cached.year) !== String(year)) return null;
    if (cached.type !== type) return null;

    return { ...cached, slots: toHeatmapSlots(cached) };
  } catch {
    return null;
  }
}

function setCachedHeatmap(year, type, data) {
  if (!HEATMAP_TYPES.has(type)) return;
  pruneHeatmapCache();
  try {
    const payload = {
      version: HEATMAP_CACHE_VERSION,
      year: String(year),
      type,
      cachedAt: Date.now(),
      slots: toHeatmapSlots(data),
    };
    localStorage.setItem(getHeatmapCacheKey(year, type), JSON.stringify(payload));
  } catch (e) {
    console.warn(`[HomeApp] 히트맵 캐시 저장 실패 (${year}/${type}):`, e.name, e.message);
  }
}

function mergeHeatmapPayload(cachedPayload, freshPayload) {
  const cachedSlots = toHeatmapSlots(cachedPayload);
  const freshSlots = toHeatmapSlots(freshPayload);

  if (freshSlots.length === 0) {
    return { slots: cachedSlots };
  }

  const merged = new Map();
  for (const slot of cachedSlots) merged.set(slot.slotKey, slot);
  for (const slot of freshSlots) merged.set(slot.slotKey, slot);

  return {
    slots: Array.from(merged.values()).sort((a, b) => a.slotKey.localeCompare(b.slotKey)),
  };
}

function pruneTodayAbnormalCache(today = todayStr()) {
  try {
    const keepKey = getTodayAbnormalCacheKey(today);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(TODAY_ABNORMAL_CACHE_PREFIX)) continue;
      if (key !== keepKey) localStorage.removeItem(key);
    }
  } catch (e) {
    console.warn('[HomeApp] today-abnormal 캐시 정리 실패:', e.name, e.message);
  }
}

function getCachedTodayAbnormal(dateStr = todayStr()) {
  pruneTodayAbnormalCache(dateStr);
  try {
    const raw = localStorage.getItem(getTodayAbnormalCacheKey(dateStr));
    if (!raw) return null;

    const cached = JSON.parse(raw);
    if (!cached || typeof cached !== 'object') return null;
    if (cached.version !== TODAY_ABNORMAL_CACHE_VERSION) return null;
    if (cached.date !== dateStr) return null;
    if (!cached.payload || typeof cached.payload !== 'object') return null;

    return cached.payload;
  } catch {
    return null;
  }
}

function setCachedTodayAbnormal(dateStr, payload) {
  pruneTodayAbnormalCache(dateStr);
  try {
    const value = {
      version: TODAY_ABNORMAL_CACHE_VERSION,
      date: dateStr,
      cachedAt: Date.now(),
      payload: payload && typeof payload === 'object' ? payload : {},
    };
    localStorage.setItem(getTodayAbnormalCacheKey(dateStr), JSON.stringify(value));
  } catch (e) {
    console.warn(`[HomeApp] today-abnormal 캐시 저장 실패 (${dateStr}):`, e.name, e.message);
  }
}

// ── 사이드바 ─────────────────────────────────────────────────────────────────
async function initSidebar() {
  const savedSidebarWidth = localStorage.getItem('sidebarWidth');
  if (savedSidebarWidth) document.getElementById('sidebar').style.width = savedSidebarWidth + 'px';

  const allItems = await API.getIntersections();

  let focusedIndex = -1;

  function renderList(items) {
    focusedIndex = -1;
    const ul = document.getElementById('intersectionList');
    if (!items.length) {
      ul.innerHTML = '<li class="px-3 py-2 text-xs text-outline">결과 없음</li>';
      return;
    }
    ul.innerHTML = items.map(i =>
      `<li class="px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-white hover:shadow-sm transition-all rounded-xl cursor-pointer" data-node="${i.NODE_ID}" data-name="${escHtml(i.CRSRD_NM)}">${escHtml(i.CRSRD_NM)}</li>`
    ).join('');
  }

  renderList(allItems);

  const filterInput = document.getElementById('sidebarFilter');
  const clearBtn = document.getElementById('filterClearBtn');

  let filterTimer;
  filterInput.addEventListener('input', function () {
    clearBtn.style.display = this.value ? 'block' : 'none';
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      const q = this.value.trim().toLowerCase();
      renderList(q ? allItems.filter(i => i.CRSRD_NM.toLowerCase().includes(q)) : allItems);
    }, 200);
  });

  clearBtn.addEventListener('click', () => {
    filterInput.value = '';
    clearBtn.style.display = 'none';
    renderList(allItems);
    filterInput.focus();
  });

  filterInput.addEventListener('keydown', e => {
    const items = document.querySelectorAll('#intersectionList li[data-node]');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusedIndex = Math.min(focusedIndex + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusedIndex = Math.max(focusedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      const target = focusedIndex >= 0 ? items[focusedIndex] : items[0];
      if (target) window.location.href = `/index.html?node_id=${encodeURIComponent(target.dataset.node)}`;
      return;
    } else {
      return;
    }

    items.forEach(li => li.classList.remove('bg-primary/10'));
    items[focusedIndex].classList.add('bg-primary/10');
    items[focusedIndex].scrollIntoView({ block: 'nearest' });
  });

  document.getElementById('intersectionList').addEventListener('click', e => {
    const li = e.target.closest('li[data-node]');
    if (!li) return;
    window.location.href = `/index.html?node_id=${encodeURIComponent(li.dataset.node)}`;
  });

  const sidebar = document.getElementById('sidebar');
  const openTab = document.getElementById('sidebarOpenTab');
  document.getElementById('sidebarToggleBtn').addEventListener('click', () => {
    sidebar.style.width = '0';
    sidebar.style.overflow = 'hidden';
    openTab.style.display = 'flex';
    document.querySelector('main').style.marginLeft = '0';
  });
  openTab.addEventListener('click', () => {
    const saved = localStorage.getItem('sidebarWidth');
    sidebar.style.width = saved ? saved + 'px' : '16rem';
    sidebar.style.overflow = '';
    openTab.style.display = 'none';
    document.querySelector('main').style.marginLeft = saved ? saved + 'px' : '16rem';
  });

  initSidebarResize();
}

function initSidebarResize() {
  const sidebar = document.getElementById('sidebar');
  const handle = document.getElementById('sidebarResizeHandle');
  if (!handle || !sidebar) return;
  let startX, startWidth;
  handle.addEventListener('mousedown', e => {
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
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
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    localStorage.setItem('sidebarWidth', sidebar.offsetWidth);
  }
}

// ── 상태 ────────────────────────────────────────────────────────────────────
const state = {
  currentYearStr: String(new Date().getFullYear()),
  pollTimer: null,
};

// ── 오늘의 이상 교차로/방향 ────────────────────────────────────────────────
let todayAbnormalNodes = [];
let todayAbnormalDirs = [];

function applyTodayAbnormalData(data) {
  const count = Number(data?.count ?? 0);
  const directionCount = Number(data?.directionCount ?? 0);
  document.getElementById('todayAbnormalCount').textContent =
    Number.isFinite(count) ? count.toLocaleString() : '0';
  document.getElementById('todayAbnormalDirCount').textContent =
    Number.isFinite(directionCount) ? directionCount.toLocaleString() : '0';
  todayAbnormalNodes = Array.isArray(data?.nodes) ? data.nodes : [];
  todayAbnormalDirs = Array.isArray(data?.directions) ? data.directions : [];
  renderAbnormalKeyList();
}

async function loadTodayAbnormal() {
  const today = todayStr();
  const cached = getCachedTodayAbnormal(today);
  if (cached) {
    applyTodayAbnormalData(cached);
  }

  try {
    const data = await API.getHomeTodayAbnormal();
    setCachedTodayAbnormal(today, data);
    applyTodayAbnormalData(data);
  } catch (err) {
    console.error('[HomeApp] 이상 교차로 수 로드 오류:', err);
    if (!cached) {
      document.getElementById('todayAbnormalCount').textContent = '—';
      document.getElementById('todayAbnormalDirCount').textContent = '—';
    }
  }
}

// ── 주요 결측 지점 카드 렌더링 ───────────────────────────────────────────
const SEVERITY_LABELS = { danger: '위험', caution: '경고', warn: '주의' };

function severityCardStyle(severity) {
  if (severity === 'danger')  return { iconBg: 'bg-red-50 text-red-500',    badgeColor: 'text-red-500',    borderHover: 'hover:border-red-200' };
  if (severity === 'caution') return { iconBg: 'bg-orange-50 text-orange-400', badgeColor: 'text-orange-400', borderHover: 'hover:border-orange-200' };
  return                             { iconBg: 'bg-yellow-50 text-yellow-600', badgeColor: 'text-yellow-600', borderHover: 'hover:border-yellow-200' };
}

const SEVERITY_SORT_ORDER = { danger: 0, caution: 1, warn: 2 };

function renderAbnormalKeyList() {
  const container = document.getElementById('abnormalKeyList');
  if (!container) return;

  const today = todayStr();

  // nodes + dirs 통합 풀 구성
  const pool = [];
  for (const n of todayAbnormalNodes) {
    pool.push({ nodeId: n.nodeId, label: n.nodeName, sub: '전 방향 결측',
      severity: n.severity, missingCount: n.missingCount, sortName: n.nodeName });
  }
  for (const d of todayAbnormalDirs) {
    pool.push({ nodeId: d.nodeId, label: d.nodeName, sub: `${d.acsrName} 방향 결측`,
      severity: d.severity, missingCount: d.missingCount, sortName: `${d.nodeName} ${d.acsrName}` });
  }

  // 유효한 severity를 가진 아이템만 필터 (구버전 캐시 데이터 방어)
  const validPool = pool.filter(item => SEVERITY_LABELS[item.severity]);

  // 위험→경고→주의, missingCount 내림, 이름 오름
  validPool.sort((a, b) => {
    const sd = SEVERITY_SORT_ORDER[a.severity] - SEVERITY_SORT_ORDER[b.severity];
    if (sd !== 0) return sd;
    const cd = b.missingCount - a.missingCount;
    if (cd !== 0) return cd;
    return a.sortName.localeCompare(b.sortName, 'ko');
  });

  const items = validPool.slice(0, 4);

  if (items.length === 0) {
    container.innerHTML = '<div class="flex items-center justify-center p-8 text-xs text-outline col-span-2">이상 교차로 없음</div>';
    return;
  }

  container.innerHTML = items.map(item => {
    const { iconBg, badgeColor, borderHover } = severityCardStyle(item.severity);
    const badge = SEVERITY_LABELS[item.severity] || item.severity;
    return `
      <div class="flex items-center justify-between p-4 bg-surface-container-low border border-transparent ${borderHover} transition-all rounded-2xl cursor-pointer"
           onclick="window.location.href='/index.html?node_id=${encodeURIComponent(item.nodeId)}&date=${today}'">
        <div class="flex items-center">
          <div class="w-10 h-10 rounded-full ${iconBg} flex items-center justify-center mr-4">
            <span class="material-symbols-outlined">location_on</span>
          </div>
          <div>
            <p class="text-sm font-bold">${escHtml(item.label)}</p>
            <p class="text-xs text-on-surface-variant">${escHtml(item.sub)}</p>
          </div>
        </div>
        <div class="text-right">
          <p class="text-xs font-bold ${badgeColor}">${badge}</p>
          <p class="text-[10px] text-outline">오늘</p>
        </div>
      </div>`;
  }).join('');
}

function severityBadgeHtml(severity) {
  if (!severity || !SEVERITY_LABELS[severity]) return '';
  return `<span class="severity-badge severity-${severity}">${SEVERITY_LABELS[severity]}</span>`;
}

function openAbnormalModal(nodes) {
  const today = todayStr();
  document.getElementById('missingModalTitle').textContent = `오늘의 이상 교차로 (${today})`;
  const list = document.getElementById('missingModalList');
  list.innerHTML = '';
  for (const { nodeId, nodeName, severity } of nodes) {
    const el = document.createElement('div');
    el.className = 'missing-modal-item';
    el.innerHTML = `${severityBadgeHtml(severity)}${escHtml(nodeName)}`;
    el.addEventListener('click', () => {
      window.location.href = `/index.html?node_id=${encodeURIComponent(nodeId)}&date=${today}`;
    });
    list.appendChild(el);
  }
  document.getElementById('missingModal').classList.add('visible');
}

function openAbnormalDirModal(dirs) {
  const today = todayStr();
  document.getElementById('missingModalTitle').textContent = `오늘의 이상 방향 (${today})`;
  const list = document.getElementById('missingModalList');
  list.innerHTML = '';
  for (const { nodeId, nodeName, acsrName, severity } of dirs) {
    const el = document.createElement('div');
    el.className = 'missing-modal-item';
    el.innerHTML = `${severityBadgeHtml(severity)}${escHtml(nodeName)}-${escHtml(acsrName)}`;
    el.addEventListener('click', () => {
      window.location.href = `/index.html?node_id=${encodeURIComponent(nodeId)}&date=${today}`;
    });
    list.appendChild(el);
  }
  document.getElementById('missingModal').classList.add('visible');
}

// ── 연간 그리드 계산 ──────────────────────────────────────────────────────
const MONTH_LABELS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
const DOW_LABELS = ['일', '', '화', '', '목', '', '토'];

function buildYearGrid(year) {
  const y = parseInt(year, 10);
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
    const isInYear = cur.getFullYear() === y;
    cells.push({
      date: new Date(cur),
      slotKey: isInYear ? dateToStr(cur) : null,
      isCurrentYear: isInYear,
      dayOfWeek: cur.getDay(),
      weekIdx: Math.floor(i / 7),
    });
    cur.setDate(cur.getDate() + 1);
  }

  const monthLabels = [];
  for (let m = 0; m < 12; m++) {
    const monthStart = new Date(y, m, 1);
    const weekIdx = Math.floor(Math.round((monthStart - gridStart) / 86400000) / 7);
    monthLabels.push({ month: m, weekIdx, label: MONTH_LABELS[m] });
  }

  return { cells, monthLabels, totalWeeks };
}

// ── GitHub 잔디 히트맵 렌더링 ─────────────────────────────────────────────
function renderYearHeatmap(wrapperId, slots) {
  const wrapper = document.getElementById(wrapperId);

  const slotMap = new Map();
  let maxCount = 0;
  for (const s of slots) {
    slotMap.set(s.slotKey, s);
    if (s.count > maxCount) maxCount = s.count;
  }
  if (maxCount === 0) maxCount = 1;

  const { cells, monthLabels, totalWeeks } = buildYearGrid(state.currentYearStr);
  const colWidth = 14;

  const container = document.createElement('div');
  container.className = 'gh-heatmap-container';

  // 월 레이블 행
  const monthRow = document.createElement('div');
  monthRow.className = 'gh-month-row';
  monthRow.style.gridTemplateColumns = `repeat(${totalWeeks}, ${colWidth}px)`;
  for (const { weekIdx, label } of monthLabels) {
    const lbl = document.createElement('div');
    lbl.className = 'gh-month-label';
    lbl.style.gridColumn = weekIdx + 1;
    lbl.textContent = label;
    monthRow.appendChild(lbl);
  }
  container.appendChild(monthRow);

  // 그리드 본체
  const grid = document.createElement('div');
  grid.className = 'gh-heatmap-grid';
  grid.style.gridTemplateColumns = `24px repeat(${totalWeeks}, ${colWidth}px)`;

  for (let dow = 0; dow < 7; dow++) {
    const label = document.createElement('div');
    label.className = 'gh-day-label';
    label.style.gridColumn = '1';
    label.style.gridRow = String(dow + 1);
    label.textContent = DOW_LABELS[dow];
    grid.appendChild(label);
  }

  for (const cell of cells) {
    const div = document.createElement('div');
    div.style.gridColumn = String(cell.weekIdx + 2);
    div.style.gridRow = String(cell.dayOfWeek + 1);

    if (!cell.isCurrentYear) {
      div.className = 'gh-cell-pad';
    } else {
      div.className = 'gh-cell';
      div.dataset.slotKey = cell.slotKey;

      const slotData = slotMap.get(cell.slotKey);
      const count = slotData ? slotData.count : 0;
      div.dataset.count = count;

      if (slotData && slotData.future) {
        div.classList.add('gh-cell-future');
      } else if (count > 0) {
        const opacity = Math.max(0.2, count / maxCount);
        div.style.backgroundColor = 'var(--tw-color-primary, #0041c8)';
        div.style.opacity = opacity;
        div.dataset.preview = JSON.stringify(slotData.preview);
        div.dataset.hasMore = String(slotData.hasMore === true);
      } else {
        div.style.cursor = 'default';
      }
    }

    grid.appendChild(div);
  }

  container.appendChild(grid);
  // replaceChildren: 기존 내용을 새 내용으로 원자적 교체 (innerHTML='' 후 append 방식의 빈 화면 플래시 방지)
  wrapper.replaceChildren(container);
}

// ── 히트맵 로드 (stale-while-revalidate) ─────────────────────────────────
function setLoading(wrapperId) {
  document.getElementById(wrapperId).innerHTML =
    '<div class="loading-placeholder"><div class="loading-spinner"></div></div>';
}

async function loadHeatmap(type, wrapperId, silent = false) {
  const year = state.currentYearStr;
  const cached = getCachedHeatmap(year, type);

  if (cached) {
    renderYearHeatmap(wrapperId, cached.slots);
    API.getHomeMissingSummary({ year, type })
      .then(fresh => {
        const merged = mergeHeatmapPayload(cached, fresh);
        setCachedHeatmap(year, type, merged);
        renderYearHeatmap(wrapperId, merged.slots);
      })
      .catch(err => console.error(`[HomeApp] ${type} 히트맵 갱신 오류:`, err));
    return;
  }

  if (!silent) setLoading(wrapperId);
  try {
    const fresh = await API.getHomeMissingSummary({ year, type });
    const merged = mergeHeatmapPayload(null, fresh);
    setCachedHeatmap(year, type, merged);
    renderYearHeatmap(wrapperId, merged.slots);
  } catch (err) {
    console.error(`[HomeApp] ${type} 히트맵 로드 오류:`, err);
    document.getElementById(wrapperId).innerHTML =
      '<div class="loading-placeholder"><span class="text-xs text-outline">데이터 준비 중...</span></div>';
  }
}

async function loadNodeHeatmap(silent = false) {
  await loadHeatmap('node', 'nodeHeatmapWrapper', silent);
}

async function loadDirHeatmap(silent = false) {
  await loadHeatmap('direction', 'dirHeatmapWrapper', silent);
}

async function loadBothHeatmaps(silent = false) {
  await Promise.all([loadNodeHeatmap(silent), loadDirHeatmap(silent)]);
}

// ── 툴팁 ────────────────────────────────────────────────────────────────────
function initTooltip() {
  const tooltip = document.getElementById('homeTooltip');

  function handleMouseMove(e) {
    const cell = e.target.closest('.gh-cell');
    if (!cell || !cell.dataset.slotKey) { tooltip.classList.remove('visible'); return; }

    const isFuture = cell.classList.contains('gh-cell-future');
    const count = parseInt(cell.dataset.count || 0);

    const slotKey = cell.dataset.slotKey;
    const [, mo, d] = slotKey.split('-');
    const timeLabel = `${mo}.${d}`;

    let html;
    if (isFuture) {
      html = `<div class="htt-time">${escHtml(timeLabel)}</div>`;
    } else {
      let countText = ` [${count}건]`;

      const previewText = cell.dataset.preview;
      const preview = previewText ? JSON.parse(previewText) : [];
      const hasMore = cell.dataset.hasMore === 'true';
      html = `<div class="htt-time">${escHtml(timeLabel)}<span class="htt-count">${countText}</span></div>`;
      for (const name of preview) {
        html += `<div class="htt-name">${escHtml(name)}</div>`;
      }
      if (hasMore) html += `<div class="htt-more">...</div>`;
    }

    tooltip.innerHTML = html;
    tooltip.classList.add('visible');

    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    let tx = e.clientX + 14;
    let ty = e.clientY - 10;
    if (tx + tw > window.innerWidth - 8) tx = e.clientX - tw - 14;
    if (ty + th > window.innerHeight - 8) ty = e.clientY - th;
    tooltip.style.left = `${tx}px`;
    tooltip.style.top = `${ty}px`;
  }

  function handleMouseLeave() {
    tooltip.classList.remove('visible');
  }

  for (const wrapperId of ['nodeHeatmapWrapper', 'dirHeatmapWrapper']) {
    const wrapper = document.getElementById(wrapperId);
    wrapper.addEventListener('mousemove', handleMouseMove);
    wrapper.addEventListener('mouseleave', handleMouseLeave);
  }
}

// ── 날짜 표시 및 네비게이션 ────────────────────────────────────────────────
function updateDateDisplay() {
  const dateBtn = document.getElementById('hmDateBtn');
  const nextBtn = document.getElementById('hmNextBtn');
  dateBtn.textContent = `${state.currentYearStr}년`;
  nextBtn.disabled = isCurrentYear(state.currentYearStr);
  nextBtn.classList.toggle('opacity-30', nextBtn.disabled);
  nextBtn.classList.toggle('cursor-not-allowed', nextBtn.disabled);
}

function bindDateNav() {
  document.getElementById('hmPrevBtn').addEventListener('click', () => changeYear(-1));
  document.getElementById('hmNextBtn').addEventListener('click', () => changeYear(1));

  document.getElementById('hmDateBtn').addEventListener('click', () => {
    YearlyNavigator.open(state.currentYearStr, ys => {
      state.currentYearStr = ys;
      updateDateDisplay();
      Promise.all([
        loadNodeHeatmap(),
        loadDirHeatmap(),
      ]);
    });
  });
}

function changeYear(delta) {
  const newY = String(parseInt(state.currentYearStr, 10) + delta);
  if (parseInt(newY, 10) > new Date().getFullYear()) return;
  state.currentYearStr = newY;
  updateDateDisplay();
  Promise.all([
    loadNodeHeatmap(),
    loadDirHeatmap(),
  ]);
}

// ── 폴링 ────────────────────────────────────────────────────────────────────
function startPolling() {
  state.pollTimer = setInterval(() => {
    loadTodayAbnormal();
    if (isCurrentYear(state.currentYearStr)) {
      loadBothHeatmaps(true);
    }
  }, 60_000);
}

// ── 셀 클릭 (결측 상세 모달) ──────────────────────────────────────────────
function initCellClick(wrapperId, type) {
  document.getElementById(wrapperId).addEventListener('click', async (e) => {
    const cell = e.target.closest('.gh-cell');
    if (!cell || !cell.dataset.slotKey) return;
    if (parseInt(cell.dataset.count || 0) === 0) return;
    if (cell.classList.contains('gh-cell-future')) return;

    const slotKey = cell.dataset.slotKey;
    try {
      const data = await API.getHomeMissingDetail({
        year: state.currentYearStr,
        slot: slotKey,
        type,
      });
      openMissingModal(slotKey, data.items, type);
    } catch (err) {
      console.error('[HomeApp] detail 조회 오류:', err);
    }
  });
}

function openMissingModal(slotKey, items, type) {
  document.getElementById('missingModalTitle').textContent = `${slotKey} [${items.length}건]`;
  const list = document.getElementById('missingModalList');
  list.innerHTML = '';

  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'missing-modal-item';
    const nameText = (type === 'node') ? escHtml(item.nodeName) : `${escHtml(item.nodeName)}-${escHtml(item.acsrName)}`;
    el.innerHTML = `${severityBadgeHtml(item.severity)}${nameText}`;
    el.addEventListener('click', () => {
      window.location.href = `/index.html?node_id=${encodeURIComponent(item.nodeId)}&date=${slotKey}`;
    });
    list.appendChild(el);
  }

  document.getElementById('missingModal').classList.add('visible');
}

// ── 모달 닫기 ─────────────────────────────────────────────────────────────
function initModalClose() {
  document.getElementById('missingModalClose').addEventListener('click', () => {
    document.getElementById('missingModal').classList.remove('visible');
  });
  document.getElementById('missingModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('missingModal')) {
      document.getElementById('missingModal').classList.remove('visible');
    }
  });
}

// ── 초기화 ────────────────────────────────────────────────────────────────
async function init() {
  SidebarComponent.render('sidebar-container', 'dashboard');
  state.currentYearStr = todayStr().slice(0, 4);
  pruneHeatmapCache();
  pruneTodayAbnormalCache(todayStr());

  await initSidebar();
  bindDateNav();
  updateDateDisplay();
  initTooltip();
  initCellClick('nodeHeatmapWrapper', 'node');
  initCellClick('dirHeatmapWrapper', 'direction');
  initModalClose();

  document.getElementById('todayAbnormalCard').addEventListener('click', () => {
    if (todayAbnormalNodes.length) openAbnormalModal(todayAbnormalNodes);
  });

  document.getElementById('todayAbnormalDirCard').addEventListener('click', () => {
    if (todayAbnormalDirs.length) openAbnormalDirModal(todayAbnormalDirs);
  });

  await loadTodayAbnormal();
  await Promise.all([
    loadNodeHeatmap(),
    loadDirHeatmap(),
  ]);
  startPolling();

  // ─── 페이지 생명주기 관리 (bfcache polling 누적 방지) ─────────────────
  window.addEventListener('pagehide', () => {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  });

  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    loadTodayAbnormal();
    if (isCurrentYear(state.currentYearStr)) loadBothHeatmaps(true);
    startPolling();
  });
}

document.addEventListener('DOMContentLoaded', init);
