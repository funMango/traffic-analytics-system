'use strict';

function createOracleTrafficRepository({ database }) {
  return {
    async findDailyTraffic(nodeId, dateStr, rangeEnd) {
      const result = await database.execute(
        `SELECT TOT_DT, TRF_QNTY, AVG_SPD, OCPN_RATE, CLBR_TRF_QNTY, PDST_QNTY, LOS
           FROM S_CRSRD_TRF_5MI
          WHERE NODE_ID = :nodeId
            AND TOT_DT >= TO_DATE(:dateStr, 'YYYY-MM-DD')
            AND TOT_DT <  :rangeEnd
            AND TRF_QNTY > 0
          ORDER BY TOT_DT`,
        { nodeId, dateStr, rangeEnd }
      );
      return result.rows;
    },

    async findWeeklyTraffic(nodeId, rangeStart, rangeEnd) {
      const result = await database.execute(
        `SELECT TOT_DT, TRF_QNTY, AVG_SPD, OCPN_RATE, CLBR_TRF_QNTY, PDST_QNTY, LOS
           FROM S_CRSRD_TRF_15MI
          WHERE NODE_ID = :nodeId
            AND TOT_DT >= :rangeStart
            AND TOT_DT <  :rangeEnd
          ORDER BY TOT_DT`,
        { nodeId, rangeStart, rangeEnd }
      );
      return result.rows;
    },

    async findLatestTraffic(nodeId) {
      const result = await database.execute(
        `SELECT TOT_DT, TRF_QNTY, AVG_SPD, OCPN_RATE, CLBR_TRF_QNTY, PDST_QNTY, LOS
           FROM S_CRSRD_TRF_5MI
          WHERE NODE_ID = :nodeId
            AND ROWNUM = 1
          ORDER BY TOT_DT DESC`,
        { nodeId }
      );
      return result.rows;
    },

    async findMonthlyTraffic(nodeId, rangeStart, rangeEnd) {
      const result = await database.execute(
        `SELECT TOT_DT, TRF_QNTY, AVG_SPD, OCPN_RATE, CLBR_TRF_QNTY, PDST_QNTY, LOS
           FROM S_CRSRD_TRF_1HH
          WHERE NODE_ID = :nodeId
            AND TOT_DT >= :rangeStart
            AND TOT_DT <  :rangeEnd
          ORDER BY TOT_DT`,
        { nodeId, rangeStart, rangeEnd }
      );
      return result.rows;
    },

    async findYearlyTraffic(nodeId, rangeStart, rangeEnd) {
      const result = await database.execute(
        `SELECT TOT_DT, TRF_QNTY, AVG_SPD, OCPN_RATE, CLBR_TRF_QNTY, PDST_QNTY, LOS
           FROM S_CRSRD_TRF_1DD
          WHERE NODE_ID = :nodeId
            AND TOT_DT >= :rangeStart
            AND TOT_DT <  :rangeEnd
          ORDER BY TOT_DT`,
        { nodeId, rangeStart, rangeEnd }
      );
      return result.rows;
    },

    async findApproaches(nodeId) {
      const result = await database.execute(
        `SELECT a.ACSR_ID, a.ACSR_NM, i.CRSRD_NM
           FROM M_CRSRD_ACSR_INF a
           JOIN M_CRSRD_INF i ON i.NODE_ID = a.NODE_ID
          WHERE a.NODE_ID = :nodeId
          ORDER BY a.ACSR_ID`,
        { nodeId }
      );
      return result.rows;
    },

    async findApproachDailyTraffic(nodeId, dateStr, rangeEnd) {
      const result = await database.execute(
        `SELECT ACSR_ID, TOT_DT, TRF_QNTY
           FROM S_CRSRD_ACSR_TRF_5MI
          WHERE NODE_ID = :nodeId
            AND TOT_DT >= TO_DATE(:dateStr, 'YYYY-MM-DD')
            AND TOT_DT <  :rangeEnd
            AND TRF_QNTY > 0
          ORDER BY TOT_DT`,
        { nodeId, dateStr, rangeEnd }
      );
      return result.rows;
    },

    async findApproachWeeklyTraffic(nodeId, rangeStart, rangeEnd) {
      const result = await database.execute(
        `SELECT ACSR_ID, TOT_DT, TRF_QNTY
           FROM S_CRSRD_ACSR_TRF_15MI
          WHERE NODE_ID = :nodeId
            AND TOT_DT >= :rangeStart
            AND TOT_DT <  :rangeEnd
          ORDER BY TOT_DT`,
        { nodeId, rangeStart, rangeEnd }
      );
      return result.rows;
    },

    async findApproachMonthlyTraffic(nodeId, rangeStart, rangeEnd) {
      const result = await database.execute(
        `SELECT ACSR_ID, TOT_DT, TRF_QNTY
           FROM S_CRSRD_ACSR_TRF_1HH
          WHERE NODE_ID = :nodeId
            AND TOT_DT >= :rangeStart
            AND TOT_DT <  :rangeEnd
          ORDER BY TOT_DT`,
        { nodeId, rangeStart, rangeEnd }
      );
      return result.rows;
    },

    async findApproachYearlyTraffic(nodeId, rangeStart, rangeEnd) {
      const result = await database.execute(
        `SELECT ACSR_ID, TOT_DT, TRF_QNTY
           FROM S_CRSRD_ACSR_TRF_1DD
          WHERE NODE_ID = :nodeId
            AND TOT_DT >= :rangeStart
            AND TOT_DT <  :rangeEnd
          ORDER BY TOT_DT`,
        { nodeId, rangeStart, rangeEnd }
      );
      return result.rows;
    },

    async findDirectionDailyTraffic(nodeId, acsrId, dateStr, rangeEnd) {
      const result = await database.execute(
        `SELECT NODE_ID, ACSR_ID, DRCT_CD, TOT_DT, TRF_QNTY,
                TO_CHAR(TOT_DT, 'HH24:MI') AS SLOT_LABEL
           FROM S_CRSRD_DRCT_TRF_5MI
          WHERE NODE_ID = :nodeId
            AND ACSR_ID = :acsrId
            AND DRCT_CD IN ('01', '02', '03')
            AND TOT_DT >= TO_DATE(:dateStr, 'YYYY-MM-DD')
            AND TOT_DT <  :rangeEnd
          ORDER BY TOT_DT, DRCT_CD`,
        { nodeId, acsrId, dateStr, rangeEnd }
      );
      return result.rows;
    },

    async findDirectionWeeklyTraffic(nodeId, acsrId, rangeStart, rangeEnd) {
      const result = await database.execute(
        `SELECT NODE_ID, ACSR_ID, DRCT_CD, TOT_DT, TRF_QNTY,
                TO_CHAR(TOT_DT, 'YYYY-MM-DD HH24:MI') AS SLOT_LABEL
           FROM S_CRSRD_DRCT_TRF_15MI
          WHERE NODE_ID = :nodeId
            AND ACSR_ID = :acsrId
            AND DRCT_CD IN ('01', '02', '03')
            AND TOT_DT >= :rangeStart
            AND TOT_DT <  :rangeEnd
          ORDER BY TOT_DT, DRCT_CD`,
        { nodeId, acsrId, rangeStart, rangeEnd }
      );
      return result.rows;
    },

    async findDirectionMonthlyTraffic(nodeId, acsrId, rangeStart, rangeEnd) {
      const result = await database.execute(
        `SELECT NODE_ID, ACSR_ID, DRCT_CD, TOT_DT, TRF_QNTY,
                TO_CHAR(TRUNC(TOT_DT, 'HH'), 'YYYY-MM-DD HH24:MI') AS SLOT_LABEL
           FROM S_CRSRD_DRCT_TRF_1HH
          WHERE NODE_ID = :nodeId
            AND ACSR_ID = :acsrId
            AND DRCT_CD IN ('01', '02', '03')
            AND TOT_DT >= :rangeStart
            AND TOT_DT <  :rangeEnd
          ORDER BY TOT_DT, DRCT_CD`,
        { nodeId, acsrId, rangeStart, rangeEnd }
      );
      return result.rows;
    },

    async findDirectionYearlyTraffic(nodeId, acsrId, rangeStart, rangeEnd) {
      const result = await database.execute(
        `SELECT NODE_ID, ACSR_ID, DRCT_CD, TOT_DT, TRF_QNTY,
                TO_CHAR(TOT_DT, 'YYYY-MM-DD') AS SLOT_LABEL
           FROM S_CRSRD_DRCT_TRF_1DD
          WHERE NODE_ID = :nodeId
            AND ACSR_ID = :acsrId
            AND DRCT_CD IN ('01', '02', '03')
            AND TOT_DT >= :rangeStart
            AND TOT_DT <  :rangeEnd
          ORDER BY TOT_DT, DRCT_CD`,
        { nodeId, acsrId, rangeStart, rangeEnd }
      );
      return result.rows;
    },
  };
}

module.exports = {
  createOracleTrafficRepository,
};
