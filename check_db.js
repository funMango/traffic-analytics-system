const { initPool, execute, closePool } = require('./db');
require('dotenv').config();

async function check() {
    try {
        await initPool();

        // 제외 대상 3개 교차로의 실제 ACSR_NM 값 확인
        const acsrRes = await execute(
            `SELECT i.CRSRD_NM, a.ACSR_ID, a.ACSR_NM
               FROM M_CRSRD_ACSR_INF a
               JOIN M_CRSRD_INF i ON i.NODE_ID = a.NODE_ID
              WHERE i.CRSRD_NM IN ('남부천신협앞', '역곡남부역삼거리', '부천여중사거리')
              ORDER BY i.CRSRD_NM, a.ACSR_ID`,
            {}
        );
        console.log('\n=== 제외 대상 교차로 접근로 목록 ===');
        console.table(acsrRes.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await closePool().catch(() => {});
        process.exit(0);
    }
}
check();
