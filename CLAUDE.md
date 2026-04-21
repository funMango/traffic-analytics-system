# 교통량 분석 시스템 — 코딩 규칙

## 레이아웃 간격 규칙

### 섹션 구조
- 콘텐츠는 `<div class="content-section">` 으로 묶는다.
- 섹션 간 간격: **24px**
  - `.main { gap: 12px }` + `.content-section { margin-top: 12px }` = 24px
- 섹션 내부 아이템 간격: `.content-section { gap: 12px }`

### 섹션 제목 (`.heatmap-section-title`)
- 섹션 제목과 바로 아래 콘텐츠(그래프/히트맵) 사이 간격: **16px**
  - `.content-section { gap: 12px }` + `.heatmap-section-title { margin-bottom: 4px }` = 16px
- 스타일: `font-size: 13px; font-weight: 600; color: var(--color-text-muted);`
- 그랜울래리티(단위) 표기: 제목과 같은 줄에 `<span class="chart-granularity">` 인라인으로 붙임
  - 예: `교통량 <span id="chartGranularity" class="chart-granularity">(5분 단위)</span>`

### 페이지 하단 여백
- 마지막 섹션(`.missing-heatmap`)에 `margin-bottom: 50px` 적용
