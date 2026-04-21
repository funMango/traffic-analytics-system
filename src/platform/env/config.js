'use strict';

function getConfig() {
  return {
    port: Number(process.env.PORT || 3000),
  };
}

module.exports = {
  getConfig,
};

