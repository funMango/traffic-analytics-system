'use strict';

const YearlyNavigator = (() => {
  let overlay = null;
  let onSelectCallback = null;
  let currentYearInt = 0;
  const MIN_YEAR = 2000;

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'mc-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <div class="mc-popup">
        <div class="mc-header">
          <span class="mc-year-btn" style="cursor:default">년도 선택</span>
        </div>
        <div class="yn-year-grid" id="ynYearGrid"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay.style.display !== 'none') close();
    });
  }

  function open(yearStr, onSelect) {
    ensureOverlay();
    onSelectCallback = onSelect;
    currentYearInt = parseInt(yearStr, 10);
    renderGrid();
    overlay.style.display = 'flex';
    const selected = document.querySelector('.yn-year-item--selected');
    if (selected) selected.scrollIntoView({ block: 'center' });
  }

  function close() {
    if (overlay) overlay.style.display = 'none';
  }

  function renderGrid() {
    const grid = document.getElementById('ynYearGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const nowYear = new Date().getFullYear();
    for (let y = MIN_YEAR; y <= nowYear; y++) {
      const btn = document.createElement('button');
      btn.className = 'yn-year-item' + (y === currentYearInt ? ' yn-year-item--selected' : '');
      btn.textContent = `${y}년`;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (onSelectCallback) onSelectCallback(String(y));
        close();
      });
      grid.appendChild(btn);
    }
  }

  return { open, close };
})();
