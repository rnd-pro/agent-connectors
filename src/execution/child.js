import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBundle } from '../bundle/read.js';
import { ensure } from '../errors.js';
import { EXECUTION_LIMITS } from './constants.js';
import { captureJson } from './json.js';
import { restrictImports } from './imports.js';
import { validateData } from '../validation.js';

let controller = new AbortController();
let verified = Symbol('verified');
let uncertain = Symbol('uncertain');
let started = false;

/** @param {unknown} message */
function send(message) {
  process.send?.(message);
}

process.on('message', (message) => {
  if (message && typeof message === 'object' && 'type' in message && message.type === 'cancel') { controller.abort(); }
});
process.on('disconnect', () => {
  controller.abort();
  process.exit(1);
});

try {
  let chunks = [];
  let bytes = 0;
  for await (let chunk of process.stdin) {
    bytes += chunk.length;
    ensure(bytes <= EXECUTION_LIMITS.inputBytes + EXECUTION_LIMITS.credentialsBytes + 8192, 'INPUT_TOO_LARGE', 'Execution envelope is too large.');
    chunks.push(chunk);
  }
  let envelope = /** @type {import('../../types/contracts.js').ChildEnvelope} */ (JSON.parse(Buffer.concat(chunks).toString('utf8')));
  let bundle = await readBundle(envelope.snapshot);
  ensure(bundle.revision === envelope.revision, 'INTEGRITY_ERROR', 'Snapshot changed before execution.');
  validateData(bundle.manifest.inputSchema, envelope.input, 'INPUT_INVALID');
  send({
    type: 'ready',
  });
  await new Promise((resolve) => {
    process.on('message', (message) => {
      if (message && typeof message === 'object' && 'type' in message && message.type === 'start') { resolve(undefined); }
    });
  });
  ensure(!controller.signal.aborted, 'CANCELLED', 'Execution was cancelled before import.');
  started = true;
  restrictImports(envelope.snapshot);
  let module = await import(pathToFileURL(join(envelope.snapshot, 'index.js')).href);
  ensure(typeof module.execute === 'function', 'HANDLER_MISSING', 'Bundle must export execute.');
  let context = Object.freeze({
    requestId: envelope.requestId,
    idempotencyKey: envelope.requestId,
    scope: envelope.scope,
    source: envelope.source,
    credentials: Object.freeze(envelope.credentials),
    signal: controller.signal,
    /** @param {unknown} value */
    verified: (value) => ({
      [verified]: true,
      value,
    }),
    unknown: () => ({
      [uncertain]: true,
    }),
    /** @param {unknown} message */
    log: (message) => { process.stderr.write(`${JSON.stringify(message)}\n`); },
  });
  let returned = await module.execute(envelope.input, context);
  ensure(!returned?.[uncertain], 'DOMAIN_UNKNOWN', 'Connector reported an uncertain domain outcome.');
  ensure(envelope.effect !== 'write' || returned?.[verified], 'WRITE_UNVERIFIED', 'Write did not confirm domain verification.');
  let value;
  try { value = captureJson(returned?.[verified] ? returned.value : returned, envelope.resultBytes); }
  catch { ensure(false, 'RESULT_LIMIT', 'Connector result is oversized or not JSON-compatible.'); }
  validateData(bundle.manifest.outputSchema, value, 'OUTPUT_INVALID');
  send({
    type: 'result',
    result: {
      state: 'completed',
      value,
    },
  });
} catch (error) {
  let allowed = new Set([
    'INPUT_INVALID',
    'OUTPUT_INVALID',
    'INTEGRITY_ERROR',
    'IMPORT_DENIED',
    'HANDLER_MISSING',
    'WRITE_UNVERIFIED',
    'DOMAIN_UNKNOWN',
    'CANCELLED',
    'INVALID_INPUT',
    'RESULT_LIMIT',
  ]);
  let code = error instanceof Error && 'code' in error && typeof error.code === 'string' && allowed.has(error.code)
    ? error.code : 'CONNECTOR_FAILED';
  send({
    type: 'result',
    result: {
      state: started ? 'unknown' : 'rejected',
      code,
    },
  });
}
