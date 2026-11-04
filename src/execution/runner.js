import { randomUUID } from 'node:crypto';
import { UUID_PATTERN } from '../constants.js';
import { ensure } from '../errors.js';
import { snapshotPath } from '../bundle/snapshots.js';
import { validateData } from '../validation.js';
import { authorize } from './authority.js';
import { EXECUTION_LIMITS } from './constants.js';
import { captureJson, digestJson } from './json.js';
import { claimReceipt, finishReceipt, getReceipt } from './receipts.js';
import { executeProcess } from './process.js';

/**
 * @param {import('../registry/registry.js').FileRegistry} registry
 * @param {string} address
 * @param {unknown} value
 * @param {import('../../types/contracts.js').ExecutionRequest} request
 */
export async function runCapability(registry, address, value, request) {
  ensure(new RegExp(UUID_PATTERN).test(request.requestId), 'INVALID_INPUT', 'Use a stable canonical request UUID.');
  ensure(typeof request.scope === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(request.scope), 'INVALID_INPUT', 'Invalid execution scope.');
  ensure(!request.signal?.aborted, 'CANCELLED', 'Request was cancelled before execution.');
  let input = captureJson(value, EXECUTION_LIMITS.inputBytes);
  let resolved = await registry.show(address);
  ensure(resolved.prepared, 'NOT_PREPARED', 'Prepare the exact pinned revision before execution.');
  let approval = await authorize(registry, resolved, request);
  validateData(resolved.manifest.inputSchema, input, 'INPUT_INVALID');
  let inputDigest = digestJson(input);
  /** @type {import('../../types/contracts.js').Receipt} */
  let entry = {
    requestId: request.requestId,
    fingerprint: digestJson({
      registryId: resolved.registryId,
      registryRoot: registry.root,
      scriptId: resolved.script.id,
      revision: resolved.binding.revision,
      scope: request.scope,
      source: request.source ?? 'cli',
      grantId: approval.grant.id,
      inputDigest,
    }),
    inputDigest,
    registryId: resolved.registryId,
    scope: request.scope,
    source: request.source ?? 'cli',
    scriptId: resolved.script.id,
    revision: resolved.binding.revision,
    grantId: approval.grant.id,
    state: 'running',
    createdAt: Date.now(),
    deadline: Date.now() + approval.grant.timeoutMs + EXECUTION_LIMITS.killGraceMs + 2000,
    ownerPid: process.pid,
    token: randomUUID(),
  };
  let claimed = await claimReceipt(registry.stateRoot, entry);
  if (!claimed.claimed) { return getReceipt(registry.stateRoot, request.requestId); }
  let controller = new AbortController();
  let signal = request.signal ? AbortSignal.any([
    controller.signal,
    request.signal,
  ]) : controller.signal;
  let revoked = false;
  let checking = false;
  async function checkAccess() {
    try { return (await authorize(registry, resolved, request)).grant.id === approval.grant.id; }
    catch { return false; }
  }
  let interval = setInterval(() => {
    if (checking) { return; }
    checking = true;
    void checkAccess().then((allowed) => {
      if (!allowed) { revoked = true; controller.abort(); }
    }).finally(() => { checking = false; });
  }, EXECUTION_LIMITS.pollMs);
  /** @type {import('../../types/contracts.js').ExecutionResult} */
  let result;
  try {
    result = await executeProcess({
      snapshot: snapshotPath(registry.stateRoot, resolved.binding.revision),
      revision: resolved.binding.revision,
      input,
      credentials: approval.credentials,
      requestId: request.requestId,
      scope: request.scope,
      source: request.source ?? 'cli',
      effect: resolved.manifest.effect,
      resultBytes: approval.grant.resultBytes,
      timeoutMs: approval.grant.timeoutMs,
    }, {
      timeoutMs: approval.grant.timeoutMs,
      signal,
      checkAccess,
    });
    if (revoked) {
      result = {
        state: 'unknown',
        code: 'ACCESS_REVOKED',
      };
    }
    if (result.state === 'completed') {
      let output = captureJson(result.value, approval.grant.resultBytes);
      validateData(resolved.manifest.outputSchema, output, 'OUTPUT_INVALID');
      let serialized = JSON.stringify(output);
      ensure(!Object.values(approval.credentials).some((secret) => serialized.includes(JSON.stringify(secret).slice(1, -1))),
        'CREDENTIAL_LEAK', 'Result contains configured credential material.');
      result.value = output;
    }
  } catch (error) {
    let code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'EXECUTION_FAILED';
    result = {
      state: 'unknown',
      code,
    };
  } finally { clearInterval(interval); }
  await finishReceipt(registry.stateRoot, entry, result);
  return getReceipt(registry.stateRoot, request.requestId);
}
