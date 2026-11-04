import { createHash } from 'node:crypto';
import { validateRegistry } from '../../validation.js';
import { LIMITS } from '../../constants.js';
import { ensure } from '../../errors.js';
import { json } from '../../files.js';

/**
 * @param {string} text
 * @returns {import('../../../types/storage.js').RegistrySnapshot}
 */
export function snapshot(text) {
  ensure(Buffer.byteLength(text) <= LIMITS.registryBytes, 'LIMIT_EXCEEDED', 'Registry document is too large.');
  let document = validateRegistry(JSON.parse(text));
  ensure(Number.isSafeInteger(document.generation), 'INVALID_DOCUMENT', 'Registry generation is outside the safe integer range.');
  return {
    document,
    text,
    digest: createHash('sha256').update(text).digest('hex'),
  };
}

/**
 * @param {import('../../../types/storage.js').RegistrySnapshot} before
 * @param {import('../../../types/contracts.js').RegistryDocument} document
 */
export function successor(before, document) {
  ensure(document.id === before.document.id && document.generation === before.document.generation + 1,
    'CONFLICT', 'Publication must preserve registry identity and increment its generation once.');
  return snapshot(json(document));
}
