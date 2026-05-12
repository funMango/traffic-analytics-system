'use strict';

const { HttpError } = require('../../../shared/domain/errors/http-errors');

function createTrafficController({ trafficUseCases, logger }) {
  async function run(res, runner, failMessage) {
    try {
      const body = await runner();
      res.json(body);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }

      logger.error(failMessage, err);
      res.status(500).json({ error: failMessage });
    }
  }

  return {
    async getTraffic(req, res) {
      await run(res, () => trafficUseCases.getTraffic(req.query), '교통량 데이터 조회 실패');
    },

    async getWeeklyTraffic(req, res) {
      await run(res, () => trafficUseCases.getWeeklyTraffic(req.query), '주간 교통량 데이터 조회 실패');
    },

    async getLatestTraffic(req, res) {
      await run(res, () => trafficUseCases.getLatestTraffic(req.query), '최신 데이터 조회 실패');
    },

    async getMonthlyTraffic(req, res) {
      await run(res, () => trafficUseCases.getMonthlyTraffic(req.query), '월간 교통량 데이터 조회 실패');
    },

    async getYearlyTraffic(req, res) {
      await run(res, () => trafficUseCases.getYearlyTraffic(req.query), '연간 교통량 데이터 조회 실패');
    },

    async getApproachTraffic(req, res) {
      await run(res, () => trafficUseCases.getApproachTraffic(req.query), '접근로 교통량 데이터 조회 실패');
    },

    async getApproachWeeklyTraffic(req, res) {
      await run(res, () => trafficUseCases.getApproachWeeklyTraffic(req.query), '접근로 주간 교통량 데이터 조회 실패');
    },

    async getApproachMonthlyTraffic(req, res) {
      await run(res, () => trafficUseCases.getApproachMonthlyTraffic(req.query), '접근로 월간 교통량 데이터 조회 실패');
    },

    async getApproachYearlyTraffic(req, res) {
      await run(res, () => trafficUseCases.getApproachYearlyTraffic(req.query), '접근로 연간 교통량 데이터 조회 실패');
    },

    async getDirectionTraffic(req, res) {
      await run(res, () => trafficUseCases.getDirectionTraffic(req.query), '방향별 교통량 데이터 조회 실패');
    },

    async getDirectionWeeklyTraffic(req, res) {
      await run(res, () => trafficUseCases.getDirectionWeeklyTraffic(req.query), '방향별 주간 교통량 데이터 조회 실패');
    },

    async getDirectionMonthlyTraffic(req, res) {
      await run(res, () => trafficUseCases.getDirectionMonthlyTraffic(req.query), '방향별 월간 교통량 데이터 조회 실패');
    },

    async getDirectionYearlyTraffic(req, res) {
      await run(res, () => trafficUseCases.getDirectionYearlyTraffic(req.query), '방향별 연간 교통량 데이터 조회 실패');
    },
  };
}

module.exports = {
  createTrafficController,
};
