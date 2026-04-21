'use strict';

const { Router } = require('express');

function createHealthRouter({ healthController }) {
  const router = Router();
  router.get('/health', (req, res) => healthController.getSystemHealth(req, res));
  return router;
}

module.exports = {
  createHealthRouter,
};

