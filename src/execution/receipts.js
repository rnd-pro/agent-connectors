import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import schema from '../../schemas/receipt-index.schema.json' with { type: 'json' };
import resultSchema from '../../schemas/execution-result.schema.json' with { type: 'json' };
import { UUID_PATTERN } from '../constants.js';
import { ensure, hasCode } from '../errors.js';
import { atomicText, json, readBytes, utf8 } from '../files.js';
import { withLock } from '../lock.js';
import { validateData } from '../validation.js';
import { EXECUTION_LIMITS } from './constants.js';

/**
 * @param {string} stateRoot
 * @returns {Promise<import('../../types/contracts.js').ReceiptIndex>}
 */
async function readIndex(stateRoot) {
  try {
    let value = JSON.parse(utf8(await readBytes(join(stateRoot, 'execution', 'index.json'), 1048576)));
    validateData(schema, value, 'INVALID_RECEIPTS');
    let index = /** @type {import('../../types/contracts.js').ReceiptIndex} */ (value);
    ensure(new Set(index.entries.map((entry) => entry.requestId)).size === index.entries.length,
      'INVALID_RECEIPTS', 'Duplicate request identity in receipt index.');
    return index;
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) { throw error; }
    return {
      formatVersion: 1,
      entries: [],
    };
  }
}

/** @param {number} pid */
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return !hasCode(error, 'ESRCH'); }
}

/**
 * @template T
 * @param {string} root
 * @param {(index: import('../../types/contracts.js').ReceiptIndex) => Promise<T>} task
 */
async function update(root, task) {
  await mkdir(join(root, 'execution'), {
    recursive: true,
    mode: 0o700,
  });
  return withLock(join(root, 'execution', '.receipts-lock'), async () => {
    let index = await readIndex(root);
    for (let entry of index.entries) {
      if (entry.state === 'running' && (!alive(entry.ownerPid) || Date.now() > entry.deadline)) {
        entry.state = 'unknown';
        entry.code = 'INTERRUPTED';
      }
    }
    let result = await task(index);
    validateData(schema, index, 'INVALID_RECEIPTS');
    await atomicText(join(root, 'execution', 'index.json'), json(index));
    return result;
  });
}

/**
 * @param {string} root
 * @param {import('../../types/contracts.js').Receipt} entry
 */
export async function claimReceipt(root, entry) {
  return update(root, async (index) => {
    let existing = index.entries.find((item) => item.requestId === entry.requestId);
    if (existing) {
      ensure(existing.fingerprint === entry.fingerprint, 'REQUEST_CONFLICT', 'Request ID already identifies different input, scope, or revision.');
      return {
        claimed: false,
        receipt: existing,
      };
    }
    ensure(index.entries.length < EXECUTION_LIMITS.receipts, 'RECEIPTS_FULL', 'Receipt storage is full; explicitly forget reconciled terminal requests before new executions.');
    ensure(index.entries.filter((item) => item.state === 'running').length < EXECUTION_LIMITS.concurrency,
      'EXECUTION_BUSY', 'The local execution concurrency limit is reached.');
    index.entries.push(entry);
    return {
      claimed: true,
      receipt: entry,
    };
  });
}

/**
 * @param {string} root
 * @param {import('../../types/contracts.js').Receipt} entry
 * @param {import('../../types/contracts.js').ExecutionResult} result
 */
export async function finishReceipt(root, entry, result) {
  validateData(resultSchema, result, 'INVALID_RECEIPTS');
  return update(root, async (index) => {
    let current = index.entries.find((item) => item.requestId === entry.requestId);
    ensure(current && current.token === entry.token, 'REQUEST_CONFLICT', 'Receipt ownership changed.');
    if (current.state !== 'running') { return current; }
    let output = {
      requestId: entry.requestId,
      fingerprint: entry.fingerprint,
      result,
    };
    // Compact result storage keeps the declared byte bound independent of nesting.
    await atomicText(join(root, 'execution', `${entry.requestId}.json`), `${JSON.stringify(output)}\n`);
    current.state = result.state;
    if (result.code) { current.code = result.code; }
    return current;
  });
}

/**
 * @param {string} root
 * @param {string} requestId
 * @returns {Promise<import('../../types/contracts.js').ReceiptView>}
 */
export async function getReceipt(root, requestId) {
  ensure(new RegExp(UUID_PATTERN).test(requestId), 'INVALID_INPUT', 'Request ID must be a canonical UUID.');
  let receipt = await update(root, async (index) => {
    let entry = index.entries.find((item) => item.requestId === requestId);
    ensure(entry, 'NOT_FOUND', 'Unknown request ID.');
    return entry;
  });
  if (receipt.state === 'running') { return receipt; }
  try {
    let saved = JSON.parse(utf8(await readBytes(join(root, 'execution', `${requestId}.json`), EXECUTION_LIMITS.resultBytes + 65536)));
    validateData(resultSchema, saved.result, 'INTEGRITY_ERROR');
    ensure(saved.requestId === requestId && saved.fingerprint === receipt.fingerprint && saved.result?.state === receipt.state,
      'INTEGRITY_ERROR', 'Receipt result does not match its index.');
    return {
      ...receipt,
      ...saved.result,
    };
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) { throw error; }
    ensure(receipt.state === 'unknown', 'INTEGRITY_ERROR', 'Completed receipt result is missing.');
    return receipt;
  }
}

/** @param {string} root */
export async function listReceipts(root) {
  return update(root, async (index) => index.entries);
}

/**
 * @param {string} root
 * @param {string} requestId
 * @param {boolean} acknowledged
 */
export async function forgetReceipt(root, requestId, acknowledged) {
  ensure(acknowledged, 'INVALID_INPUT', 'Forgetting removes duplicate protection; explicit acknowledgement is required.');
  return update(root, async (index) => {
    let position = index.entries.findIndex((item) => item.requestId === requestId);
    ensure(position !== -1, 'NOT_FOUND', 'Unknown request ID.');
    ensure(index.entries[position].state !== 'running', 'EXECUTION_BUSY', 'Cannot forget a running request.');
    await unlink(join(root, 'execution', `${index.entries[position].requestId}.json`)).catch((error) => {
      if (!hasCode(error, 'ENOENT')) { throw error; }
    });
    index.entries.splice(position, 1);
    return {
      requestId,
      forgotten: true,
    };
  });
}
