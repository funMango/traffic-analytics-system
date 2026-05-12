'use strict';

/**
 * API 클라이언트 + SSE 연결 관리
 */
const API = (() => {
  const BASE = '';

  let _globalSignal = null;
  function setAbortSignal(signal) { _globalSignal = signal; }

  async function fetchJSON(path) {
    const res = await fetch(BASE + path, _globalSignal ? { signal: _globalSignal } : undefined);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  function getIntersections() {
    return fetchJSON('/api/intersections');
  }

  function searchIntersections(term) {
    return fetchJSON(`/api/intersections/search?q=${encodeURIComponent(term)}`);
  }

  function getTraffic(nodeId, date) {
    return fetchJSON(`/api/traffic?node_id=${encodeURIComponent(nodeId)}&date=${date}`);
  }

  function getLatest(nodeId) {
    return fetchJSON(`/api/traffic/latest?node_id=${encodeURIComponent(nodeId)}`);
  }

  function getWeeklyTraffic(nodeId, weekStart) {
    return fetchJSON(`/api/traffic/weekly?node_id=${encodeURIComponent(nodeId)}&week_start=${weekStart}`);
  }

  function getMonthlyTraffic(nodeId, monthStr) {
    return fetchJSON(`/api/traffic/monthly?node_id=${encodeURIComponent(nodeId)}&month=${monthStr}`);
  }

  function getYearlyTraffic(nodeId, yearStr) {
    return fetchJSON(`/api/traffic/yearly?node_id=${encodeURIComponent(nodeId)}&year=${yearStr}`);
  }

  function getApproachTraffic(nodeId, date) {
    return fetchJSON(`/api/traffic/approach?node_id=${encodeURIComponent(nodeId)}&date=${date}`);
  }

  function getApproachWeeklyTraffic(nodeId, weekStart) {
    return fetchJSON(`/api/traffic/approach/weekly?node_id=${encodeURIComponent(nodeId)}&week_start=${weekStart}`);
  }

  function getApproachMonthlyTraffic(nodeId, month) {
    return fetchJSON(`/api/traffic/approach/monthly?node_id=${encodeURIComponent(nodeId)}&month=${month}`);
  }

  function getApproachYearlyTraffic(nodeId, year) {
    return fetchJSON(`/api/traffic/approach/yearly?node_id=${encodeURIComponent(nodeId)}&year=${year}`);
  }

  function getDirectionTraffic(nodeId, acsrId, date) {
    return fetchJSON(`/api/traffic/direction?node_id=${encodeURIComponent(nodeId)}&acsr_id=${encodeURIComponent(acsrId)}&date=${date}`);
  }

  function getDirectionWeeklyTraffic(nodeId, acsrId, weekStart) {
    return fetchJSON(`/api/traffic/direction/weekly?node_id=${encodeURIComponent(nodeId)}&acsr_id=${encodeURIComponent(acsrId)}&week_start=${weekStart}`);
  }

  function getDirectionMonthlyTraffic(nodeId, acsrId, month) {
    return fetchJSON(`/api/traffic/direction/monthly?node_id=${encodeURIComponent(nodeId)}&acsr_id=${encodeURIComponent(acsrId)}&month=${month}`);
  }

  function getDirectionYearlyTraffic(nodeId, acsrId, year) {
    return fetchJSON(`/api/traffic/direction/yearly?node_id=${encodeURIComponent(nodeId)}&acsr_id=${encodeURIComponent(acsrId)}&year=${year}`);
  }

  function getHomeMissingSummary({ year, type }) {
    const params = new URLSearchParams({ period: '1y' });
    if (year) params.set('year', year);
    if (type) params.set('type', type);
    return fetchJSON(`/api/home/missing/summary?${params}`);
  }

  function getHomeMissingDetail({ year, slot, type }) {
    const params = new URLSearchParams({ period: '1y', slot });
    if (year) params.set('year', year);
    if (type) params.set('type', type);
    return fetchJSON(`/api/home/missing/detail?${params}`);
  }

  function getHomeTodayAbnormal() {
    return fetchJSON('/api/home/today-abnormal');
  }

  async function getSystemHealth() {
    const res = await fetch(BASE + '/api/system/health', _globalSignal ? { signal: _globalSignal } : undefined);
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

  // SSE 연결
  let es = null;
  const listeners = {};

  function on(event, cb) {
    listeners[event] = listeners[event] || [];
    listeners[event].push(cb);
  }

  function off(event, cb) {
    if (listeners[event]) {
      listeners[event] = listeners[event].filter(fn => fn !== cb);
    }
  }

  function connectSSE(onStatusChange) {
    if (es) es.close();

    es = new EventSource('/api/sse');

    es.addEventListener('connected', () => {
      console.log('[SSE] 연결됨');
      onStatusChange && onStatusChange('connected');
    });

    es.addEventListener('traffic-update', (e) => {
      const data = JSON.parse(e.data);
      (listeners['traffic-update'] || []).forEach(cb => cb(data));
    });

    es.addEventListener('null-slots', (e) => {
      const data = JSON.parse(e.data);
      (listeners['null-slots'] || []).forEach(cb => cb(data));
    });

    es.addEventListener('hourly-traffic-update', (e) => {
      const data = JSON.parse(e.data);
      (listeners['hourly-traffic-update'] || []).forEach(cb => cb(data));
    });

    es.addEventListener('hourly-null-slots', (e) => {
      const data = JSON.parse(e.data);
      (listeners['hourly-null-slots'] || []).forEach(cb => cb(data));
    });

    es.addEventListener('daily-traffic-update', (e) => {
      const data = JSON.parse(e.data);
      (listeners['daily-traffic-update'] || []).forEach(cb => cb(data));
    });

    es.addEventListener('daily-null-slots', (e) => {
      const data = JSON.parse(e.data);
      (listeners['daily-null-slots'] || []).forEach(cb => cb(data));
    });

    es.addEventListener('fifteen-min-traffic-update', (e) => {
      const data = JSON.parse(e.data);
      (listeners['fifteen-min-traffic-update'] || []).forEach(cb => cb(data));
    });

    es.addEventListener('fifteen-min-null-slots', (e) => {
      const data = JSON.parse(e.data);
      (listeners['fifteen-min-null-slots'] || []).forEach(cb => cb(data));
    });

    es.addEventListener('approach-traffic-update', (e) => {
      const data = JSON.parse(e.data);
      (listeners['approach-traffic-update'] || []).forEach(cb => cb(data));
    });

    es.addEventListener('direction-traffic-update', (e) => {
      const data = JSON.parse(e.data);
      (listeners['direction-traffic-update'] || []).forEach(cb => cb(data));
    });

    es.addEventListener('direction-fifteen-min-traffic-update', (e) => {
      const data = JSON.parse(e.data);
      (listeners['direction-fifteen-min-traffic-update'] || []).forEach(cb => cb(data));
    });

    es.addEventListener('direction-hourly-traffic-update', (e) => {
      const data = JSON.parse(e.data);
      (listeners['direction-hourly-traffic-update'] || []).forEach(cb => cb(data));
    });

    es.addEventListener('direction-daily-traffic-update', (e) => {
      const data = JSON.parse(e.data);
      (listeners['direction-daily-traffic-update'] || []).forEach(cb => cb(data));
    });

    es.onerror = () => {
      console.warn('[SSE] 연결 오류 - 재연결 대기');
      onStatusChange && onStatusChange('disconnected');
    };

    es.onopen = () => {
      onStatusChange && onStatusChange('connected');
    };

    return es;
  }

  function disconnectSSE() {
    if (es) {
      es.close();
      es = null;
    }
  }

  return {
    getIntersections,
    searchIntersections,
    getTraffic,
    getLatest,
    getWeeklyTraffic,
    getMonthlyTraffic,
    getYearlyTraffic,
    getApproachTraffic,
    getApproachWeeklyTraffic,
    getApproachMonthlyTraffic,
    getApproachYearlyTraffic,
    getDirectionTraffic,
    getDirectionWeeklyTraffic,
    getDirectionMonthlyTraffic,
    getDirectionYearlyTraffic,
    getHomeMissingSummary,
    getHomeMissingDetail,
    getHomeTodayAbnormal,
    getSystemHealth,
    setAbortSignal,
    connectSSE,
    disconnectSSE,
    on,
    off,
  };
})();
