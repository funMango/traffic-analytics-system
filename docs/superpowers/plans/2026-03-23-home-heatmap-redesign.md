# 홈 히트맵 & 라우팅 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서비스 시작 시 홈페이지가 먼저 나오도록 라우팅 변경, 홈 히트맵을 1달/1년 기간으로 단순화하고 교차로 단위 결측 통계 표시.

**Architecture:** Express static middleware 앞에 `/` 라우트를 추가해 home.html을 서빙. 홈 히트맵은 기존 행/열 구조에서 flex-wrap 30px 셀 구조로 전환. 백엔드 결측 계산을 방향별 → 교차로 단위로 변경하고, poller의 targetUpdateTime을 활용해 수신 중인 슬롯을 결측에서 제외.

**Tech Stack:** Node.js/Express, Vanilla JS, Oracle DB (oracledb)

---

## 파일 변경 목록

| 파일 | 동작 |
|---|---|
| `app.js` | `/` 라우트 추가 |
| `public/home.html` | 링크, 기간 버튼, 카드 문구, hmDatePicker hidden |
| `public/index.html` | nav-home-link href 변경 |
| `public/css/style.css` | 홈 히트맵 스타일 (30px, flex-wrap, 레이블 제거) |
| `services/hourly-poller.js` | `getTargetUpdateTime()` export 추가 |
| `services/daily-poller.js` | `getTargetUpdateTime()` export 추가, NULL threshold를 다음날 06:00으로 수정 |
| `routes/home.js` | PERIOD_CONFIG 1m/1y만, computeMissing 교차로 단위, preview 형식, NULL 규칙 |
| `public/js/home.js` | 기간 1m/1y, 히트맵 렌더링, 툴팁, 이상 교차로 표시 |

---

## Task 1: 라우팅 — `/` → home.html 서빙

**Files:**
- Modify: `app.js`

- [ ] **Step 1: app.js에 `/` 라우트 추가**

`app.use(express.static(...))` 앞에 다음 라우트를 추가한다.

```js
// app.js의 app.use(express.static(...)) 바로 앞에 삽입
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});
```

- [ ] **Step 2: 수동 확인**

서버 재시작 후 `http://localhost:3000/` 접속 → home.html이 표시되는지 확인.
`http://localhost:3000/index.html` 접속 → index.html이 표시되는지 확인.

---

## Task 2: home.html — 링크/버튼/카드/picker 변경

**Files:**
- Modify: `public/home.html`

- [ ] **Step 1: 교차로 링크 변경**

```html
<!-- 변경 전 -->
<a href="/" class="home-topnav-link">교차로 상세 →</a>
<!-- 변경 후 -->
<a href="/index.html" class="home-topnav-link">교차로 목록 →</a>
```

- [ ] **Step 2: 오늘 결측 수 카드 → 이상 교차로 카드로 변경**

```html
<!-- 변경 전 -->
<div class="content-section">
  <div class="heatmap-section-title">오늘 결측 수 <span class="chart-granularity">(시간 단위)</span></div>
  <div class="today-missing-card">
    <span class="today-missing-label">결측 수:</span>
    <span id="todayMissingCount" class="today-missing-count">—</span>
    <span class="today-missing-unit">건</span>
  </div>
</div>

<!-- 변경 후 -->
<div class="content-section">
  <div class="heatmap-section-title">오늘의 이상 교차로</div>
  <div class="today-missing-card">
    <span id="todayAbnormalCount" class="today-missing-count">—</span>
    <span class="today-missing-unit">개 교차로</span>
  </div>
</div>
```

- [ ] **Step 3: 히트맵 섹션 title에서 granularity span 제거**

```html
<!-- 변경 전 -->
<div class="heatmap-section-title">결측 정보 <span id="hmGranularity" class="chart-granularity">(5분 단위)</span></div>
<!-- 변경 후 -->
<div class="heatmap-section-title">결측 정보</div>
```

- [ ] **Step 4: 날짜 picker input hidden 처리 (CSS로 처리하므로 id만 유지)**

`#hmDatePicker` input은 그대로 두되 style.css에서 숨김 처리 (Task 4에서).

- [ ] **Step 5: 기간 버튼 1달/1년만 남기기**

```html
<!-- 변경 전 -->
<div class="period-bar">
  <button class="btn-period active" data-period="1d">1일</button>
  <button class="btn-period" data-period="1w">1주</button>
  <button class="btn-period" data-period="1m">1달</button>
  <button class="btn-period" data-period="1y">1년</button>
</div>

<!-- 변경 후 -->
<div class="period-bar">
  <button class="btn-period active" data-period="1m">1달</button>
  <button class="btn-period" data-period="1y">1년</button>
</div>
```

---

## Task 3: index.html — 홈 링크 수정

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: nav-home-link href 변경**

```html
<!-- 변경 전 -->
<a href="/home.html" class="nav-home-link" title="홈으로">홈</a>
<!-- 변경 후 -->
<a href="/" class="nav-home-link" title="홈으로">홈</a>
```

---

## Task 4: style.css — 홈 히트맵 스타일 변경

**Files:**
- Modify: `public/css/style.css`

- [ ] **Step 1: #hmDatePicker hidden 처리**

기존에 `#datePicker`가 hidden 처리된 것과 동일하게 추가.

```css
/* 기존 #datePicker 스타일 아래에 추가 */
#hmDatePicker {
  position: absolute;
  top: 100%;
  left: 0;
  width: 1px;
  height: 1px;
  opacity: 0;
  border: none;
  padding: 0;
  pointer-events: none;
}
```

- [ ] **Step 2: 홈 히트맵 wrapper를 flex-wrap 구조로 변경**

```css
/* 기존 .home-heatmap-wrapper 교체 */
.home-heatmap-wrapper {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding-bottom: 4px;
}
```

- [ ] **Step 3: 홈 히트맵 셀 30px로 변경**

```css
/* 기존 .home-heatmap-cell 교체 */
.home-heatmap-cell {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 2px;
  border: 1px solid #e2e8f0;
  background: transparent;
  cursor: default;
  opacity: 1;
  transition: outline 0.05s;
}

/* 기존 .home-heatmap-cell-empty 교체 */
.home-heatmap-cell-empty {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 2px;
  background: #f8fafc;
  border: 1px solid #f1f5f9;
  cursor: default;
}
```

- [ ] **Step 4: 레이블/헤더 스타일 — 사용 안 하지만 남겨두기 (home.js에서 생성 안 함)**

행 레이블, 열 헤더 생성 코드를 home.js에서 제거하므로 CSS는 그대로 유지해도 무방.

---

## Task 5: poller exports — targetUpdateTime 노출

**Files:**
- Modify: `services/hourly-poller.js`
- Modify: `services/daily-poller.js`

### hourly-poller.js

- [ ] **Step 1: getTargetUpdateTime export 추가**

```js
// module.exports 교체
module.exports = {
  startHourlyPoller,
  stopHourlyPoller,
  initHourlyUpdateTimes,
  getNullSlotsForDate,
  getNullSlotsForMonth,
  getTargetUpdateTime: () => targetUpdateTime,
};
```

### daily-poller.js

- [ ] **Step 2: daily-poller NULL threshold를 다음날 06:00으로 수정**

기존 `NULL_THRESHOLD = 2` (2일 초과)는 부적절. 사용자 요구사항:
> "1일의 null 판단법은 만약 오늘이 03.25일이라면 03.26 06:00가 지나도록 데이터가 안들어오면 null로 판단한다"

`poll()` 함수 상단에 헬퍼 함수를 추가하고 `while` 루프 조건만 교체한다. **루프 body는 변경하지 않는다.**

```js
// ─── poll() 함수 위(파일 상단 유틸 섹션)에 추가 ────────────────────────────
function getNullDeadline(targetDt) {
  // targetDt 날짜의 다음날 06:00
  const d = new Date(targetDt);
  d.setDate(d.getDate() + 1);
  d.setHours(6, 0, 0, 0);
  return d;
}
```

그리고 `poll()` 내부의 타임아웃 체크 `while` 조건만 교체한다:

```js
// 변경 전 (기존 코드)
while (targetUpdateTime && now >= targetUpdateTime.getTime() + NULL_THRESHOLD * UPDATE_INTERVAL_MS) {
  const added = confirmNullSlot(targetUpdateTime, '타임아웃');
  if (added) newNullAdded = true;
  currentUpdateTime = new Date(targetUpdateTime);
  targetUpdateTime  = new Date(targetUpdateTime.getTime() + UPDATE_INTERVAL_MS);
}

// 변경 후 (while 조건만 교체, body 동일)
while (targetUpdateTime && now >= getNullDeadline(targetUpdateTime).getTime()) {
  const added = confirmNullSlot(targetUpdateTime, '타임아웃');
  if (added) newNullAdded = true;
  currentUpdateTime = new Date(targetUpdateTime);
  targetUpdateTime  = new Date(targetUpdateTime.getTime() + UPDATE_INTERVAL_MS);
}
```

> `NULL_THRESHOLD` 상수는 이제 사용되지 않으므로 파일 상단에서 제거한다.

- [ ] **Step 3: getTargetUpdateTime export 추가**

```js
// module.exports 교체
module.exports = {
  startDailyPoller,
  stopDailyPoller,
  initDailyUpdateTimes,
  getNullSlotsForMonth,
  getTargetUpdateTime: () => targetUpdateTime,
};
```

---

## Task 6: routes/home.js — 교차로 단위 결측, NULL 규칙, 1m/1y만

**Files:**
- Modify: `routes/home.js`

이 Task는 가장 중요한 변경이다. 전체 파일을 재작성한다.

### 변경 사항 요약

1. PERIOD_CONFIG: '1d', '1w' 항목 제거
2. computeMissing: 교차로 단위로만 카운트 (방향별 결측 제거)
3. preview 형식: `[{ nodeName, missingDirs }]` 구조 → 툴팁에서 사용
4. count: 방향 수 아닌 교차로 수
5. getRangeFromParams: poller targetUpdateTime 참조하여 수신 중인 슬롯 제외
6. validateParams: '1m', '1y'만 허용
7. 오늘 이상 교차로 수 API: GET /api/home/today-abnormal

- [ ] **Step 1: 파일 상단 require 블록 전체 (재작성이므로 전체 헤더를 명시)**

`routes/home.js`를 재작성할 때 파일 최상단은 다음과 같아야 한다:

```js
'use strict';

const { Router } = require('express');
const { execute } = require('../db');
const { getTargetUpdateTime: getHourlyTarget } = require('../services/hourly-poller');
const { getTargetUpdateTime: getDailyTarget }  = require('../services/daily-poller');

const router = Router();
```

> `execute`와 `Router` import를 반드시 유지한다.

- [ ] **Step 2: 유틸 함수 정의 (재작성 시 반드시 포함)**

```js
function padZ(n) { return String(n).padStart(2, '0'); }

function dateToStr(date) {
  return `${date.getFullYear()}-${padZ(date.getMonth() + 1)}-${padZ(date.getDate())}`;
}
```

- [ ] **Step 3: PERIOD_CONFIG를 1m, 1y만으로 변경**

```js
const PERIOD_CONFIG = {
  '1m': {
    nodeTable: 'S_CRSRD_TRF_1HH',
    acsrTable: 'S_CRSRD_ACSR_TRF_1HH',
    slotExpr:  `TO_CHAR(TOT_DT, 'YYYY-MM-DD HH24') || ':00'`,
    intervalMs: 60 * 60 * 1000,
  },
  '1y': {
    nodeTable: 'S_CRSRD_TRF_1DD',
    acsrTable: 'S_CRSRD_ACSR_TRF_1DD',
    slotExpr:  `TO_CHAR(TOT_DT, 'YYYY-MM-DD')`,
    intervalMs: 24 * 60 * 60 * 1000,
  },
};
```

- [ ] **Step 4: getRangeFromParams를 NULL 규칙 적용 버전으로 교체**

```js
function getRangeFromParams(period, query) {
  if (period === '1m') {
    const [y, m] = query.month.split('-').map(Number);
    const s = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const e = new Date(y, m, 1, 0, 0, 0, 0); // 다음 달 첫날

    // 수신 중인 슬롯 제외: targetUpdateTime이 있으면 그것을 rangeEnd로 제한
    const target = getHourlyTarget();
    let rangeEnd = e;
    if (target && target < e) rangeEnd = target;
    const now = new Date();
    if (now < rangeEnd) rangeEnd = now;
    return { rangeStart: s, rangeEnd };
  }
  // '1y'
  const y = parseInt(query.year, 10);
  const s = new Date(y, 0, 1, 0, 0, 0, 0);
  const e = new Date(y + 1, 0, 1, 0, 0, 0, 0);

  const target = getDailyTarget();
  let rangeEnd = e;
  // 과거 연도 조회 시 target이 해당 연도 범위 안에 있을 때만 적용
  if (target && target >= s && target < e) rangeEnd = target;
  const now = new Date();
  if (now < rangeEnd) rangeEnd = now;
  return { rangeStart: s, rangeEnd };
}
```

- [ ] **Step 5: generateSlots를 1m/1y만으로 교체**

```js
function generateSlots(period, query, rangeEnd) {
  const slots = [];
  let cur, intervalMs, endBoundary, keyFn;

  if (period === '1m') {
    const [y, m] = query.month.split('-').map(Number);
    cur = new Date(y, m - 1, 1, 0, 0, 0, 0);
    // 전체 달의 모든 슬롯을 생성 (미래 포함) — 미래는 rangeEnd 이후이므로 DB에 없어 count=0
    endBoundary = new Date(y, m, 1, 0, 0, 0, 0);
    intervalMs = 60 * 60 * 1000;
    keyFn = d => `${dateToStr(d)} ${padZ(d.getHours())}:00`;
  } else {
    const y = parseInt(query.year, 10);
    cur = new Date(y, 0, 1, 0, 0, 0, 0);
    endBoundary = new Date(y + 1, 0, 1, 0, 0, 0, 0);
    intervalMs = 24 * 60 * 60 * 1000;
    keyFn = d => dateToStr(d);
  }

  // 전체 기간의 슬롯 생성 (미래 포함)
  while (cur < endBoundary) {
    slots.push(keyFn(new Date(cur)));
    cur = new Date(cur.getTime() + intervalMs);
  }
  return slots;
}
```

> 중요: `generateSlots`는 전체 달/년의 슬롯을 생성한다 (미래 포함). 하지만 `rangeEnd` 이후의 슬롯은 DB에 데이터가 없으므로 count=0으로 표시됨. 미래 빈 셀을 히트맵에 표시하기 위한 것.

- [ ] **Step 6: computeMissing을 교차로 단위로 교체**

```js
function computeMissing(slots, existingBySlot, intersections, rangeEnd) {
  const rangeEndStr = rangeEnd ? rangeEnd.toISOString() : null;

  return slots.map(slotKey => {
    // rangeEnd 이후 슬롯 → 미래 빈 셀 (count=0, future=true)
    const slotTime = slotKeyToDate(slotKey);
    if (rangeEndStr && slotTime >= rangeEnd) {
      return { slotKey, count: 0, preview: [], future: true };
    }

    const existingNodes = existingBySlot.get(slotKey) || new Set();
    let count = 0;
    const previewItems = []; // [{ nodeName, missingDirs }]

    for (const { nodeId, nodeName } of intersections) {
      if (!existingNodes.has(nodeId)) {
        count++;
        if (previewItems.length < 5) {
          previewItems.push({ nodeName, missingDirs: null }); // 전체 결측
        }
      }
    }

    return { slotKey, count, preview: previewItems };
  });
}

function slotKeyToDate(slotKey) {
  // '2026-03-01 10:00' 또는 '2026-03-01'
  if (slotKey.length === 10) return new Date(slotKey + 'T00:00:00');
  return new Date(slotKey.replace(' ', 'T') + ':00');
}
```

> 주의: 방향별 결측은 이제 제거한다. 교차로 단위로만 결측을 계산한다.
> preview는 최대 5개까지 담는다 (툴팁에 표시할 교차로 목록).

- [ ] **Step 7: queryExisting — slotExpr 파라미터로 받도록 구현**

방향별 쿼리를 제거하고 교차로 단위 쿼리만 남긴다. `slotExpr`은 파라미터로 전달받는다.

```js
async function queryExisting(nodeTable, slotExpr, rangeStart, rangeEnd) {
  const nodeResult = await execute(
    `SELECT DISTINCT NODE_ID, ${slotExpr} AS SLOT_KEY
       FROM ${nodeTable}
      WHERE TOT_DT >= :rangeStart AND TOT_DT < :rangeEnd`,
    { rangeStart, rangeEnd }
  );

  const existingBySlot = new Map();
  for (const r of nodeResult.rows) {
    if (!existingBySlot.has(r.SLOT_KEY)) existingBySlot.set(r.SLOT_KEY, new Set());
    existingBySlot.get(r.SLOT_KEY).add(r.NODE_ID);
  }
  return existingBySlot;
}
```

- [ ] **Step 8: validateParams 1m/1y만 허용으로 변경**

```js
function validateParams(period, query) {
  if (!['1m', '1y'].includes(period)) return 'period는 1m|1y 중 하나여야 합니다';
  if (period === '1m' && !query.month) return 'month 파라미터가 필요합니다';
  if (period === '1y' && !query.year)  return 'year 파라미터가 필요합니다';
  return null;
}
```

- [ ] **Step 9: GET /missing/summary 라우트 수정**

```js
router.get('/missing/summary', async (req, res) => {
  const { period } = req.query;
  const errMsg = validateParams(period, req.query);
  if (errMsg) return res.status(400).json({ error: errMsg });

  try {
    const { intersections } = await getMasterData();
    const { rangeStart, rangeEnd } = getRangeFromParams(period, req.query);
    const { nodeTable, slotExpr } = PERIOD_CONFIG[period];

    const existingBySlot = await queryExisting(nodeTable, slotExpr, rangeStart, rangeEnd);
    const slots = generateSlots(period, req.query, rangeEnd);
    const result = computeMissing(slots, existingBySlot, intersections, rangeEnd);

    res.json({ slots: result });
  } catch (err) {
    console.error('[home] summary 조회 오류:', err);
    res.status(500).json({ error: '결측 요약 조회 실패' });
  }
});
```

- [ ] **Step 10: GET /today-abnormal 라우트 추가 (오늘 이상 교차로 수)**

오늘 1시간이라도 결측이 있는 교차로 수를 반환. 단일 DB 쿼리로 구현한다.

```js
router.get('/today-abnormal', async (req, res) => {
  try {
    const { intersections } = await getMasterData();
    const today = dateToStr(new Date());

    const todayStart = new Date(today + 'T00:00:00');
    // todayEnd: targetUpdateTime 또는 다음날 자정 중 작은 값
    const tomorrow = new Date(todayStart);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const target = getHourlyTarget();
    const todayEnd = (target && target < tomorrow) ? target : tomorrow;

    // 시간 슬롯별 교차로 존재 여부 수집
    const slotResult = await execute(
      `SELECT DISTINCT NODE_ID, TO_CHAR(TOT_DT, 'HH24') AS SLOT_HOUR
         FROM S_CRSRD_TRF_1HH
        WHERE TOT_DT >= :todayStart AND TOT_DT < :todayEnd`,
      { todayStart, todayEnd }
    );

    // 시간 슬롯별로 존재하는 교차로 수집
    const slotNodes = new Map(); // 'HH' → Set<nodeId>
    for (const r of slotResult.rows) {
      const h = r.SLOT_HOUR;
      if (!slotNodes.has(h)) slotNodes.set(h, new Set());
      slotNodes.get(h).add(r.NODE_ID);
    }

    // 완료된 시간 슬롯들 (todayEnd 이전)
    const completedHours = [];
    for (let h = 0; h < 24; h++) {
      const slotTime = new Date(today + `T${padZ(h)}:00:00`);
      if (slotTime < todayEnd) completedHours.push(padZ(h));
    }

    // 1번이라도 결측인 교차로 집합
    const abnormalNodes = new Set();
    for (const h of completedHours) {
      const existing = slotNodes.get(h) || new Set();
      for (const { nodeId } of intersections) {
        if (!existing.has(nodeId)) abnormalNodes.add(nodeId);
      }
    }

    res.json({ count: abnormalNodes.size });
  } catch (err) {
    console.error('[home] today-abnormal 조회 오류:', err);
    res.status(500).json({ error: '이상 교차로 조회 실패' });
  }
});
```

- [ ] **Step 11: GET /missing/detail 라우트 — 1m/1y만으로 수정**

detail 라우트의 `slotStart` 계산을 1m/1y에 맞게 유지:

```js
router.get('/missing/detail', async (req, res) => {
  const { period, slot } = req.query;
  const errMsg = validateParams(period, req.query);
  if (errMsg) return res.status(400).json({ error: errMsg });
  if (!slot) return res.status(400).json({ error: 'slot 파라미터가 필요합니다' });

  try {
    const { intersections } = await getMasterData();
    const { nodeTable, intervalMs } = PERIOD_CONFIG[period];

    let slotStart;
    if (period === '1m') {
      slotStart = new Date(slot.replace(' ', 'T') + ':00');
    } else {
      slotStart = new Date(slot + 'T00:00:00');
    }
    const slotEnd = new Date(slotStart.getTime() + intervalMs);

    const nodeResult = await execute(
      `SELECT DISTINCT NODE_ID FROM ${nodeTable}
        WHERE TOT_DT >= :slotStart AND TOT_DT < :slotEnd`,
      { slotStart, slotEnd }
    );

    const existingNodes = new Set(nodeResult.rows.map(r => r.NODE_ID));

    const items = [];
    for (const { nodeId, nodeName } of intersections) {
      if (!existingNodes.has(nodeId)) {
        items.push({ nodeId, nodeName });
      }
    }

    res.json({ slotKey: slot, items });
  } catch (err) {
    console.error('[home] detail 조회 오류:', err);
    res.status(500).json({ error: '결측 상세 조회 실패' });
  }
});
```

---

## Task 7: public/js/api.js — today-abnormal API 추가

**Files:**
- Modify: `public/js/api.js`

- [ ] **Step 1: getHomeTodayAbnormal 함수 추가**

```js
function getHomeTodayAbnormal() {
  return fetchJSON('/api/home/today-abnormal');
}
```

`return { ... }` 블록에도 추가:
```js
getHomeTodayAbnormal,
```

---

## Task 8: public/js/home.js — 전체 재작성 (1m/1y, 새 히트맵, 툴팁, 이상 교차로)

**Files:**
- Modify: `public/js/home.js`

이 파일은 변경이 매우 많으므로 전체를 재작성한다.

### 핵심 변경 사항

1. `state.currentPeriod` 기본값: `'1m'`
2. 1d, 1w 관련 상태/함수 제거
3. `loadTodayMissingCount()` → `loadTodayAbnormal()` (이상 교차로 수)
4. `renderHeatmap()`: 1m → `renderMonthly()`, 1y → `renderYearly()`
5. `renderMonthly()`: 행/열 레이블 없이 30px flex-wrap, 미래 포함 전체 칸
6. `renderYearly()`: 레이블 없이 365/366 칸 모두 flex-wrap
7. 툴팁: 교차로 단위 count + 방향 정보 표시
8. `updateDateDisplay()`: 1m, 1y만
9. `bindPeriodButtons()`: 1m, 1y만
10. `startPolling()`: 1m의 현재 달만 폴링

- [ ] **Step 1: 상태 초기값 변경 (state 객체)**

```js
const state = {
  currentPeriod:   '1m',
  currentDate:     todayStr(),      // 1d용 (미사용이나 유틸용으로 유지)
  currentMonthStr: null,
  currentYearStr:  null,
  summarySlots:    [],
  pollTimer:       null,
  detailParams:    null,
};
```

- [ ] **Step 2: 유틸 함수 — 1w 관련 제거, 1m/1y만**

제거: `getWeekStart`, `getWeekEnd`, `isCurrentWeek`, `shiftWeek`, `weekDisplayLabel`

유지: `padZ`, `dateToStr`, `todayStr`, `shiftMonth`, `isCurrentMonth`, `isCurrentYear`

- [ ] **Step 3: loadTodayAbnormal() — 이상 교차로 수 표시**

```js
async function loadTodayAbnormal() {
  try {
    const data = await API.getHomeTodayAbnormal();
    document.getElementById('todayAbnormalCount').textContent = data.count.toLocaleString();
  } catch (err) {
    console.error('[HomeApp] 이상 교차로 수 로드 오류:', err);
    document.getElementById('todayAbnormalCount').textContent = '—';
  }
}
```

- [ ] **Step 4: buildSummaryParams() — 1m/1y만**

```js
function buildSummaryParams() {
  if (state.currentPeriod === '1m') return { period: '1m', month: state.currentMonthStr };
  return { period: '1y', year: state.currentYearStr };
}
```

- [ ] **Step 5: renderHeatmap() — 1m/1y로 분기**

```js
function renderHeatmap(slots) {
  const wrapper = document.getElementById('homeHeatmapWrapper');
  wrapper.innerHTML = '';

  const slotMap = new Map();
  let maxCount = 0;
  for (const s of slots) {
    slotMap.set(s.slotKey, s);
    if (s.count > maxCount) maxCount = s.count;
  }
  if (maxCount === 0) maxCount = 1;

  if (state.currentPeriod === '1m') renderMonthly(wrapper, slotMap, maxCount);
  else                               renderYearly(wrapper, slotMap, maxCount);
}
```

- [ ] **Step 6: renderMonthly() — 레이블 없이 전체 칸 flex-wrap**

```js
// 1달: 전체 일수×24시간 칸 (미래 포함). 레이블 없음.
function renderMonthly(wrapper, slotMap, maxCount) {
  const [y, m] = state.currentMonthStr.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${state.currentMonthStr}-${padZ(d)}`;
    for (let h = 0; h < 24; h++) {
      const slotKey = `${dateStr} ${padZ(h)}:00`;
      wrapper.appendChild(makeCell(slotKey, slotMap.get(slotKey), maxCount));
    }
  }
}
```

- [ ] **Step 7: renderYearly() — 365/366 칸 flex-wrap**

```js
// 1년: 365 또는 366칸 (미래 포함). 레이블 없음.
function renderYearly(wrapper, slotMap, maxCount) {
  const y = parseInt(state.currentYearStr, 10);
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
  const totalDays = isLeap ? 366 : 365;

  const startDate = new Date(y, 0, 1);
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const slotKey = dateToStr(d);
    wrapper.appendChild(makeCell(slotKey, slotMap.get(slotKey), maxCount));
  }
}
```

- [ ] **Step 8: makeCell() — future 셀 처리 추가**

```js
function makeCell(slotKey, slotData, maxCount) {
  const cell = document.createElement('div');
  cell.className = 'home-heatmap-cell';
  cell.dataset.slotKey = slotKey;

  const count = slotData ? slotData.count : 0;
  cell.dataset.count = count;

  if (slotData && slotData.future) {
    // 미래 칸 — 연하게 표시
    cell.classList.add('home-heatmap-cell-future');
  } else if (count > 0) {
    const opacity = Math.max(0.15, count / maxCount);
    cell.style.backgroundColor = 'var(--color-primary)';
    cell.style.opacity = opacity;
    cell.dataset.preview = JSON.stringify(slotData.preview);
    cell.dataset.hasMore = String(slotData.preview.length >= 5);
  }
  return cell;
}
```

- [ ] **Step 9: 툴팁 — 교차로 단위 count + 방향 정보**

```js
function initTooltip() {
  const tooltip = document.getElementById('homeTooltip');

  document.getElementById('homeHeatmapWrapper').addEventListener('mousemove', (e) => {
    const cell = e.target.closest('.home-heatmap-cell');
    if (!cell || parseInt(cell.dataset.count || 0) === 0) {
      tooltip.classList.remove('visible');
      return;
    }

    const count   = parseInt(cell.dataset.count);
    const preview = JSON.parse(cell.dataset.preview || '[]');
    const hasMore = cell.dataset.hasMore === 'true';
    const slotKey = cell.dataset.slotKey;

    // 시간 표시 형식
    let timeLabel = slotKey;
    if (state.currentPeriod === '1m') {
      // 'YYYY-MM-DD HH:00' → 'MM.DD HH:00'
      const parts = slotKey.split(' ');
      const [y, mo, d] = parts[0].split('-');
      timeLabel = `${mo}.${d} ${parts[1]}`;
    } else {
      // 'YYYY-MM-DD' → 'MM.DD'
      const [y, mo, d] = slotKey.split('-');
      timeLabel = `${mo}.${d}`;
    }

    let html = `<div class="htt-time">${escHtml(timeLabel)}<span class="htt-count"> ${count}개 교차로</span></div>`;

    for (const item of preview) {
      if (item.missingDirs === null) {
        // 교차로 전체 결측
        html += `<div class="htt-name">${escHtml(item.nodeName)}</div>`;
      } else {
        // 일부 방향 결측
        html += `<div class="htt-name">${escHtml(item.nodeName)} - ${escHtml(item.missingDirs.join(', '))}</div>`;
      }
    }
    if (hasMore) html += `<div class="htt-more">...</div>`;

    tooltip.innerHTML = html;
    tooltip.classList.add('visible');

    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    let tx = e.clientX + 14;
    let ty = e.clientY - 10;
    if (tx + tw > window.innerWidth  - 8) tx = e.clientX - tw - 14;
    if (ty + th > window.innerHeight - 8) ty = e.clientY - th;
    tooltip.style.left = `${tx}px`;
    tooltip.style.top  = `${ty}px`;
  });

  document.getElementById('homeHeatmapWrapper').addEventListener('mouseleave', () => {
    tooltip.classList.remove('visible');
  });
}
```

- [ ] **Step 10: updateDateDisplay() — 1m/1y만**

```js
function updateDateDisplay() {
  const dateBtn = document.getElementById('hmDateBtn');
  const nextBtn = document.getElementById('hmNextBtn');

  if (state.currentPeriod === '1m') {
    const [y, m] = state.currentMonthStr.split('-');
    dateBtn.textContent = `${y}.${m}`;
    nextBtn.disabled = isCurrentMonth(state.currentMonthStr);
  } else {
    dateBtn.textContent = `${state.currentYearStr}년`;
    nextBtn.disabled = isCurrentYear(state.currentYearStr);
  }
}
```

- [ ] **Step 11: bindDateNav() — 1m/1y만**

```js
function bindDateNav() {
  document.getElementById('hmPrevBtn').addEventListener('click', () => changeDate(-1));
  document.getElementById('hmNextBtn').addEventListener('click', () => changeDate(1));

  document.getElementById('hmDateBtn').addEventListener('click', () => {
    if (state.currentPeriod === '1m') {
      MonthlyCalendar.open(state.currentMonthStr, ms => {
        state.currentMonthStr = ms;
        updateDateDisplay();
        loadHeatmapData();
      });
    } else {
      YearlyNavigator.open(state.currentYearStr, ys => {
        state.currentYearStr = ys;
        updateDateDisplay();
        loadHeatmapData();
      });
    }
  });
  // hmDatePicker는 hidden이므로 change 이벤트 불필요
}
```

- [ ] **Step 12: changeDate() — 1m/1y만**

```js
function changeDate(delta) {
  if (state.currentPeriod === '1m') {
    const newM = shiftMonth(state.currentMonthStr, delta);
    if (newM > todayStr().slice(0, 7)) return;
    state.currentMonthStr = newM;
  } else {
    const newY = String(parseInt(state.currentYearStr, 10) + delta);
    if (parseInt(newY, 10) > new Date().getFullYear()) return;
    state.currentYearStr = newY;
  }
  updateDateDisplay();
  loadHeatmapData();
}
```

- [ ] **Step 13: bindPeriodButtons() — 1m/1y만**

```js
function bindPeriodButtons() {
  document.querySelectorAll('.btn-period').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-period').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentPeriod = btn.dataset.period;

      document.getElementById('homeHeatmapWrapper').innerHTML = '';

      if (state.currentPeriod === '1y') {
        state.currentYearStr = state.currentDate.slice(0, 4);
      } else {
        state.currentMonthStr = state.currentDate.slice(0, 7);
      }

      updateDateDisplay();
      loadHeatmapData();
    });
  });
}
```

- [ ] **Step 14: startPolling() — 1m 현재 달만 폴링**

```js
function startPolling() {
  state.pollTimer = setInterval(() => {
    loadTodayAbnormal();
    if (state.currentPeriod === '1m') {
      const currentMonth = todayStr().slice(0, 7);
      if (state.currentMonthStr === currentMonth) {
        loadHeatmapData();
      }
    }
  }, 60_000);
}
```

- [ ] **Step 15: initCellClick() — 셀 클릭으로 상세 모달 열기 (기존 로직 유지, 링크만 수정)**

```js
function initCellClick() {
  document.getElementById('homeHeatmapWrapper').addEventListener('click', async (e) => {
    const cell = e.target.closest('.home-heatmap-cell');
    if (!cell || parseInt(cell.dataset.count || 0) === 0) return;
    if (cell.classList.contains('home-heatmap-cell-future')) return;

    const slotKey = cell.dataset.slotKey;
    const params  = { ...state.detailParams, slot: slotKey };

    try {
      const data = await API.getHomeMissingDetail(params);
      openMissingModal(slotKey, data.items);
    } catch (err) {
      console.error('[HomeApp] detail 조회 오류:', err);
    }
  });

  document.getElementById('missingModalClose').addEventListener('click', () => {
    document.getElementById('missingModal').classList.remove('visible');
  });
  document.getElementById('missingModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('missingModal')) {
      document.getElementById('missingModal').classList.remove('visible');
    }
  });
}
```

- [ ] **Step 16: init() — 변경된 함수명 반영, initCellClick 포함**

```js
async function init() {
  state.currentMonthStr = state.currentDate.slice(0, 7);
  state.currentYearStr  = state.currentDate.slice(0, 4);

  bindDateNav();
  bindPeriodButtons();
  updateDateDisplay();
  initTooltip();
  initCellClick();

  await loadTodayAbnormal();
  await loadHeatmapData();
  startPolling();
}
```

- [ ] **Step 17: openMissingModal() — detail API 결과 형식 변경**

detail 라우트에서 이제 `items: [{ nodeId, nodeName }]`만 반환하므로 modal 렌더링 수정:

```js
function openMissingModal(slotKey, items) {
  document.getElementById('missingModalTitle').textContent = slotKey;
  const list = document.getElementById('missingModalList');
  list.innerHTML = '';

  const navDate = getDateFromSlotKey(slotKey);
  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'missing-modal-item';
    el.textContent = item.nodeName;
    el.addEventListener('click', () => {
      window.location.href = `/index.html?node_id=${encodeURIComponent(item.nodeId)}&date=${navDate}`;
    });
    list.appendChild(el);
  }

  document.getElementById('missingModal').classList.add('visible');
}
```

- [ ] **Step 18: getDateFromSlotKey() — 1m/1y만**

```js
function getDateFromSlotKey(slotKey) {
  if (state.currentPeriod === '1y') return slotKey; // 'YYYY-MM-DD'
  return slotKey.slice(0, 10); // 'YYYY-MM-DD HH:00' → 'YYYY-MM-DD'
}
```

---

## Task 9: style.css — future 셀 스타일 추가

**Files:**
- Modify: `public/css/style.css`

- [ ] **Step 1: future 셀 스타일 추가**

```css
.home-heatmap-cell-future {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 2px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  cursor: default;
  opacity: 0.4;
}
```

---

## Task 10: 최종 확인

- [ ] **Step 1: 서버 재시작 후 동작 확인**

1. `http://localhost:3000/` → home.html 표시
2. 교차로 목록 링크 클릭 → `/index.html` 표시
3. `index.html` 상단 "홈" 링크 → `/` 이동
4. 홈 히트맵: 1달 기간 선택 시 24×일수 flex-wrap 셀 표시
5. 홈 히트맵: 1년 기간 선택 시 365/366 flex-wrap 셀 표시
6. 툴팁: 이상 교차로 수 + 교차로명 표시
7. "오늘의 이상 교차로: X개 교차로" 표시
8. 미래 셀은 연한 회색으로 표시
9. 날짜 옆 달력 입력칸 미표시

- [ ] **Step 2: NULL 규칙 로그 확인**

서버 콘솔에서 `[HourlyPoller] NULL 슬롯 확정` 로그가 정상 동작하는지 확인.
