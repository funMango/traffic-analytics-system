'use strict';

function createHealthController({ getSystemHealthUseCase }) {
  return {
    async getSystemHealth(req, res) {
      const { statusCode, body } = await getSystemHealthUseCase();
      res.status(statusCode).json(body);
    },
  };
}

module.exports = {
  createHealthController,
};

