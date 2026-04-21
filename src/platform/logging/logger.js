'use strict';

function info(message, meta) {
  if (meta) {
    console.log(message, meta);
    return;
  }
  console.log(message);
}

function warn(message, meta) {
  if (meta) {
    console.warn(message, meta);
    return;
  }
  console.warn(message);
}

function error(message, meta) {
  if (meta) {
    console.error(message, meta);
    return;
  }
  console.error(message);
}

module.exports = {
  logger: {
    info,
    warn,
    error,
  },
};

