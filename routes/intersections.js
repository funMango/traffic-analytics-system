'use strict';

const { Router } = require('express');
const { execute } = require('../db');

const router = Router();

// GET /api/intersections - 전체 교차로 목록
router.get('/', async (req, res) => {
  try {
    const result = await execute(
      `SELECT NODE_ID, CRSRD_NM, SGNL_CRSRD_NM
         FROM M_CRSRD_INF
        ORDER BY CRSRD_NM`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[intersections] 목록 조회 오류:', err);
    res.status(500).json({ error: '교차로 목록 조회 실패' });
  }
});

// GET /api/intersections/search?q= - 교차로 검색
router.get('/search', async (req, res) => {
  const term = (req.query.q || '').trim();
  if (!term) {
    return res.status(400).json({ error: '검색어를 입력하세요' });
  }

  try {
    const result = await execute(
      `SELECT NODE_ID, CRSRD_NM, SGNL_CRSRD_NM
         FROM M_CRSRD_INF
        WHERE UPPER(CRSRD_NM) LIKE UPPER('%' || :term || '%')
           OR UPPER(SGNL_CRSRD_NM) LIKE UPPER('%' || :term || '%')
        ORDER BY CRSRD_NM`,
      { term }
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[intersections] 검색 오류:', err);
    res.status(500).json({ error: '교차로 검색 실패' });
  }
});

module.exports = router;
