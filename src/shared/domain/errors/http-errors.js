'use strict';

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || null;
  }
}

class BadRequestError extends HttpError {
  constructor(message) {
    super(400, message, 'BAD_REQUEST');
  }
}

class NotFoundError extends HttpError {
  constructor(message) {
    super(404, message, 'NOT_FOUND');
  }
}

module.exports = {
  HttpError,
  BadRequestError,
  NotFoundError,
};

