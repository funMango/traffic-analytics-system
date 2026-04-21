'use strict';

const SidebarComponent = {
  render: function (containerId, activeMenu) {
    const isDashboard = activeMenu === 'dashboard';
    const isTraffic = activeMenu === 'traffic';

    const html = `
<!-- 사이드바 열기 탭 -->
<button id="sidebarOpenTab" style="display:none;"
  class="fixed left-0 top-1/2 -translate-y-1/2 z-50 w-5 h-10 bg-surface-container-low border border-outline-variant/20 rounded-r-lg flex items-center justify-center text-outline hover:text-primary transition-colors shadow-sm">
  <svg width="6" height="10" viewBox="0 0 6 10" fill="none"><path d="M1 1L5 5L1 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
</button>

<!-- 좌측 사이드바 -->
<aside id="sidebar"
  class="fixed left-0 top-0 h-full w-64 flex flex-col bg-surface-container-low z-50 border-r border-outline-variant/10"
  style="overflow:hidden; transition: width 0.25s ease;">
  <div class="flex flex-col h-full p-4 space-y-2">

    <!-- 브랜드 + 닫기 버튼 -->
    <div class="px-4 py-6 mb-4 flex items-start justify-between">
      <div>
        <h1 class="font-headline font-bold text-primary text-xl tracking-tight">교통량 분석 시스템</h1>
        <p class="text-xs text-on-surface-variant font-medium">Traffic Management</p>
      </div>
      <button id="sidebarToggleBtn"
        class="mt-1 w-7 h-7 rounded-full bg-surface-container flex items-center justify-center text-outline hover:text-primary hover:bg-surface-container-high transition-colors"
        title="사이드바 닫기">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <!-- 네비게이션 -->
    <nav class="space-y-1">
      <a href="/home.html"
        class="flex items-center px-4 py-3 transition-all duration-200 ${isDashboard ? 'bg-white text-primary font-bold shadow-sm translate-x-1 rounded-2xl' : 'text-slate-500 hover:bg-slate-200 rounded-xl'}">
        <span class="material-symbols-outlined mr-3" style="font-size:18px;">dashboard</span>
        <span class="font-label text-sm">대시보드</span>
      </a>
      <a href="/index.html"
        class="flex items-center px-4 py-3 transition-all duration-200 ${isTraffic ? 'bg-white text-primary font-bold shadow-sm translate-x-1 rounded-2xl' : 'text-slate-500 hover:bg-slate-200 rounded-xl'}">
        <span class="material-symbols-outlined mr-3" style="font-size:18px;">traffic</span>
        <span class="font-label text-sm">교차로 분석</span>
      </a>
      <div class="h-3"></div>
    </nav>

    <!-- 검색 + 목록 -->
    <div class="px-2 flex-1 flex flex-col min-h-0">
      <div class="relative mb-3">
        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline"
          style="font-size:16px;">search</span>
        <input id="sidebarFilter" type="text"
          class="w-full pl-9 pr-8 py-2 bg-surface-container-lowest border-none ring-1 ring-outline-variant/15 focus:ring-primary/40 text-xs font-label rounded-2xl outline-none"
          placeholder="교차로 검색..." autocomplete="off" />
        <button id="filterClearBtn" style="display:none;"
          class="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface" title="지우기">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1 1L7 7M7 1L1 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      <p class="text-[10px] uppercase tracking-wider text-outline font-bold px-2 mb-2">교차로 목록</p>
      <ul id="intersectionList" class="space-y-0.5 overflow-y-auto flex-1 pr-1">
        <li class="px-3 py-2 text-xs text-outline">데이터 로딩 중...</li>
      </ul>
    </div>

  </div>
  <div id="sidebarResizeHandle"
    class="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors"></div>
</aside>
    `;

    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = html;
    } else {
      console.error('Sidebar container not found:', containerId);
    }
  }
};
