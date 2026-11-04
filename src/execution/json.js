import { createHash } from 'node:crypto';
import { ensure } from '../errors.js';

/**
 * @param {unknown} value
 * @param {number} limit
 */
export function captureJson(value, limit) {
  let text;
  try {
    text = JSON.stringify(value, (_key, item) => {
      ensure(item !== undefined && typeof item !== 'function' && typeof item !== 'symbol'
        && (typeof item !== 'number' || Number.isFinite(item)), 'INVALID_INPUT', 'Expected JSON-compatible values.');
      return item;
    });
  }
  catch { ensure(false, 'INVALID_INPUT', 'Expected serializable JSON.'); }
  ensure(typeof text === 'string' && Buffer.byteLength(text) <= limit, 'INVALID_INPUT', 'JSON input is missing or exceeds its size limit.');
  return JSON.parse(text);
}

/** @param {unknown} value */
export function digestJson(value) {
  /** @param {any} item
   * @returns {any}
   */
  function ordered(item) {
    if (Array.isArray(item)) { return item.map(ordered); }
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [
        key,
        ordered(item[key]),
      ]));
    }
    return item;
  }
  return `sha256:${createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex')}`;
}
