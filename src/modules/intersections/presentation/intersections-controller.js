'use strict';

const { HttpError } = require('../../../shared/domain/errors/http-errors');

function createIntersectionsController({
  getIntersectionsUseCase,
  searchIntersectionsUseCase,
  logger,
}) {
  return {
    async getIntersections(req, res) {
      try {
        const rows = await getIntersectionsUseCase();
        res.json(rows);
      } catch (err) {
        logger.error('[intersections] 목록 조회 오류:', err);
        res.status(500).json({ error: '교차로 목록 조회 실패' });
      }
    },

    async searchIntersections(req, res) {
      try {
        const rows = await searchIntersectionsUseCase(req.query.q);
        res.json(rows);
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        logger.error('[intersections] 검색 오류:', err);
        res.status(500).json({ error: '교차로 검색 실패' });
      }
    },
  };
}

module.exports = {
  createIntersectionsController,
};

