'use strict';

const { Router } = require('express');

function createTrafficRouter({ trafficController }) {
  const router = Router();

  router.get('/', (req, res) => trafficController.getTraffic(req, res));
  router.get('/weekly', (req, res) => trafficController.getWeeklyTraffic(req, res));
  router.get('/latest', (req, res) => trafficController.getLatestTraffic(req, res));
  router.get('/monthly', (req, res) => trafficController.getMonthlyTraffic(req, res));
  router.get('/yearly', (req, res) => trafficController.getYearlyTraffic(req, res));
  router.get('/approach', (req, res) => trafficController.getApproachTraffic(req, res));
  router.get('/approach/weekly', (req, res) => trafficController.getApproachWeeklyTraffic(req, res));
  router.get('/approach/monthly', (req, res) => trafficController.getApproachMonthlyTraffic(req, res));
  router.get('/approach/yearly', (req, res) => trafficController.getApproachYearlyTraffic(req, res));

  return router;
}

module.exports = {
  createTrafficRouter,
};

