'use strict';

function createOracleIntersectionRepository({ database }) {
  return {
    async findAll() {
      const result = await database.execute(
        `SELECT NODE_ID, CRSRD_NM, SGNL_CRSRD_NM
           FROM M_CRSRD_INF
          ORDER BY CRSRD_NM`
      );
      return result.rows;
    },
    async searchByName(term) {
      const result = await database.execute(
        `SELECT NODE_ID, CRSRD_NM, SGNL_CRSRD_NM
           FROM M_CRSRD_INF
          WHERE UPPER(CRSRD_NM) LIKE UPPER('%' || :term || '%')
             OR UPPER(SGNL_CRSRD_NM) LIKE UPPER('%' || :term || '%')
          ORDER BY CRSRD_NM`,
        { term }
      );
      return result.rows;
    },
  };
}

module.exports = {
  createOracleIntersectionRepository,
};

