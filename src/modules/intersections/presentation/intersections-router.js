'use strict';

const { Router } = require('express');

function createIntersectionsRouter({ intersectionsController }) {
  const router = Router();

  router.get('/', (req, res) => intersectionsController.getIntersections(req, res));
  router.get('/search', (req, res) => intersectionsController.searchIntersections(req, res));

  return router;
}

module.exports = {
  createIntersectionsRouter,
};

