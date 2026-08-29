'use strict';

class FamilyLinkError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'FamilyLinkError';
    this.code = code || 'UNKNOWN_ERROR';
    this.status = options.status ?? null;
    this.details = options.details ?? null;
  }
}

function serializeError(error) {
  if (error instanceof FamilyLinkError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      details: error.details
    };
  }

  return {
    code: 'UNEXPECTED_ERROR',
    message: error instanceof Error ? error.message : '发生未知错误',
    status: null,
    details: null
  };
}

module.exports = { FamilyLinkError, serializeError };
