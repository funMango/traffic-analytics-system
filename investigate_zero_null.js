'use strict';

require('dotenv').config();
const { initPool, execute, closePool } = require('./db');

async function main() {
  await initPool();

  // ── 쿼리 1: 전체 0값 개수 ──────────────────────────────────────────
  console.log('\n========== [1] 전체 TRF_QNTY = 0 개수 ==========');
  const q1 = await execute(`
    SELECT COUNT(*) AS ZERO_CNT
      FROM S_CRSRD_ACSR_TRF_5MI
     WHERE TRF_QNTY = 0
  `);
  console.log('0값 총 건수:', q1.rows[0].ZERO_CNT);

  // ── 쿼리 2: 0값이 있는 교차로·방향 목록 ───────────────────────────
  console.log('\n========== [2] 0값 존재하는 교차로·방향 목록 ==========');
  const q2 = await execute(`
    SELECT t.NODE_ID, t.ACSR_ID, i.CRSRD_NM, a.ACSR_NM,
           COUNT(*) AS ZERO_CNT,
           TO_CHAR(MIN(t.TOT_DT), 'YYYY-MM-DD HH24:MI') AS FIRST_ZERO,
           TO_CHAR(MAX(t.TOT_DT), 'YYYY-MM-DD HH24:MI') AS LAST_ZERO
      FROM S_CRSRD_ACSR_TRF_5MI t
      LEFT JOIN M_CRSRD_INF i       ON i.NODE_ID = t.NODE_ID
      LEFT JOIN M_CRSRD_ACSR_INF a  ON a.NODE_ID = t.NODE_ID AND a.ACSR_ID = t.ACSR_ID
     WHERE t.TRF_QNTY = 0
     GROUP BY t.NODE_ID, t.ACSR_ID, i.CRSRD_NM, a.ACSR_NM
     ORDER BY ZERO_CNT DESC
  `);

  if (q2.rows.length === 0) {
    console.log('→ 0값 없음. TRF_QNTY = 0 인 레코드 존재하지 않음.');
  } else {
    console.log(`→ ${q2.rows.length}개 교차로·방향 조합에서 0값 발견\n`);
    console.log(
      '교차로명'.padEnd(20),
      '접근로명'.padEnd(12),
      'NODE_ID'.padEnd(14),
      'ACSR_ID'.padEnd(8),
      '0건수'.padEnd(8),
      '최초 0',
      '           최근 0'
    );
    console.log('-'.repeat(100));
    for (const r of q2.rows) {
      console.log(
        String(r.CRSRD_NM || '').padEnd(20),
        String(r.ACSR_NM  || '').padEnd(12),
        String(r.NODE_ID  || '').padEnd(14),
        String(r.ACSR_ID  || '').padEnd(8),
        String(r.ZERO_CNT || '').padEnd(8),
        String(r.FIRST_ZERO || '').padEnd(18),
        String(r.LAST_ZERO  || '')
      );
    }
  }

  // ── 쿼리 3: 교차로·방향별 NULL / 0 / 양수 분포 ───────────────────
  console.log('\n========== [3] 교차로·방향별 NULL / 0 / 양수 분포 ==========');
  const q3 = await execute(`
    SELECT t.NODE_ID, i.CRSRD_NM, t.ACSR_ID, a.ACSR_NM,
           SUM(CASE WHEN t.TRF_QNTY IS NULL THEN 1 ELSE 0 END) AS NULL_CNT,
           SUM(CASE WHEN t.TRF_QNTY = 0     THEN 1 ELSE 0 END) AS ZERO_CNT,
           SUM(CASE WHEN t.TRF_QNTY > 0     THEN 1 ELSE 0 END) AS POS_CNT,
           COUNT(*) AS TOTAL_CNT
      FROM S_CRSRD_ACSR_TRF_5MI t
      LEFT JOIN M_CRSRD_INF i       ON i.NODE_ID = t.NODE_ID
      LEFT JOIN M_CRSRD_ACSR_INF a  ON a.NODE_ID = t.NODE_ID AND a.ACSR_ID = t.ACSR_ID
     GROUP BY t.NODE_ID, i.CRSRD_NM, t.ACSR_ID, a.ACSR_NM
     ORDER BY t.NODE_ID, t.ACSR_ID
  `);

  console.log(
    '교차로명'.padEnd(20),
    '접근로명'.padEnd(12),
    'NULL건'.padEnd(8),
    '0건'.padEnd(8),
    '양수건'.padEnd(8),
    '합계'
  );
  console.log('-'.repeat(80));
  for (const r of q3.rows) {
    const nullCnt = Number(r.NULL_CNT);
    const zeroCnt = Number(r.ZERO_CNT);
    const posCnt  = Number(r.POS_CNT);
    const total   = Number(r.TOTAL_CNT);
    // 0값이 존재하는 행은 강조
    const mark = zeroCnt > 0 ? ' ◀ 0값있음' : '';
    console.log(
      String(r.CRSRD_NM || '').padEnd(20),
      String(r.ACSR_NM  || '').padEnd(12),
      String(nullCnt).padEnd(8),
      String(zeroCnt).padEnd(8),
      String(posCnt).padEnd(8),
      String(total) + mark
    );
  }

  await closePool();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
