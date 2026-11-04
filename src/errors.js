export class ConnectorError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'ConnectorError';
    this.code = code;
  }
}

/**
 * @param {unknown} error
 * @param {string} code
 */
export function hasCode(error, code) {
  return error instanceof Error && 'code' in error && error.code === code;
}

/**
 * @param {unknown} condition
 * @param {string} code
 * @param {string} message
 * @returns {asserts condition}
 */
export function ensure(condition, code, message) {
  if (!condition) { throw new ConnectorError(code, message); }
}
