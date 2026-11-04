import { credentialProfiles, grantCapability, readAuthority, removeCredentialProfile, revokeGrant, setCredentialProfile } from '../execution/authority.js';
import { forgetReceipt, getReceipt, listReceipts } from '../execution/receipts.js';
import { runCapability } from '../execution/runner.js';
import { EXECUTION_LIMITS } from '../execution/constants.js';
import { readJsonInput } from './input.js';

export const EXECUTION_COMMANDS = Object.freeze({
  grant: {
    args: 1,
    options: [
      'scope',
      'revision',
      'effect',
      'source',
      'profile',
      'timeout',
      'result-bytes',
    ],
    usage: 'grant <address> --scope <scope> --revision <digest> --effect read|write [--source cli|agent|agui] [--profile <name>]',
  },
  grants: {
    args: 0,
    options: [],
    usage: 'grants',
  },
  revoke: {
    args: 1,
    options: [],
    usage: 'revoke <grant-UUID>',
  },
  run: {
    args: 1,
    options: [
      'scope',
      'request',
      'file',
    ],
    usage: 'run <address> --scope <scope> --request <UUID> [--file <input.json>]',
  },
  'credential set': {
    args: 1,
    options: [
      'file',
    ],
    usage: 'credential set <profile> [--file <secrets.json>]',
  },
  'credential list': {
    args: 0,
    options: [],
    usage: 'credential list',
  },
  'credential remove': {
    args: 1,
    options: [],
    usage: 'credential remove <profile>',
  },
  'receipts list': {
    args: 0,
    options: [],
    usage: 'receipts list',
  },
  'receipts get': {
    args: 1,
    options: [],
    usage: 'receipts get <request-UUID>',
  },
  'receipts forget': {
    args: 1,
    options: [
      'acknowledge',
    ],
    usage: 'receipts forget <request-UUID> --acknowledge',
  },
});

/**
 * @param {string} command
 * @param {string} target
 * @param {string} stateRoot
 * @param {{ optional: (name: string) => string | undefined; acknowledged: boolean }} options
 * @returns {Promise<unknown> | undefined}
 */
export function privateCommand(command, target, stateRoot, options) {
  let handlers = {
    grants: async () => (await readAuthority(stateRoot)).grants,
    revoke: () => revokeGrant(stateRoot, target),
    'credential set': async () => setCredentialProfile(stateRoot, target,
      await readJsonInput(options.optional('file'), EXECUTION_LIMITS.credentialsBytes)),
    'credential list': () => credentialProfiles(stateRoot),
    'credential remove': () => removeCredentialProfile(stateRoot, target),
    'receipts list': () => listReceipts(stateRoot),
    'receipts get': () => getReceipt(stateRoot, target),
    'receipts forget': () => forgetReceipt(stateRoot, target, options.acknowledged),
  };
  if (Object.hasOwn(handlers, command)) { return handlers[/** @type {keyof typeof handlers} */ (command)](); }
}

/**
 * @param {import('../registry/registry.js').FileRegistry} registry
 * @param {string} target
 * @param {{ required: (name: string) => string; optional: (name: string) => string | undefined; integer: (name: string) => number | undefined }} options
 */
export function grantCommand(registry, target, options) {
  return grantCapability(registry, target, {
    scope: options.required('scope'),
    revision: options.required('revision'),
    effect: /** @type {'read' | 'write'} */ (options.required('effect')),
    source: /** @type {import('../../types/contracts.js').InvocationSource} */ (options.optional('source') ?? 'cli'),
    profile: options.optional('profile'),
    timeoutMs: options.integer('timeout'),
    resultBytes: options.integer('result-bytes'),
  });
}

/**
 * @param {import('../registry/registry.js').FileRegistry} registry
 * @param {string} target
 * @param {{ required: (name: string) => string; optional: (name: string) => string | undefined }} options
 */
export async function runCommand(registry, target, options) {
  let scope = options.required('scope');
  let requestId = options.required('request');
  let input = await readJsonInput(options.optional('file'), EXECUTION_LIMITS.inputBytes);
  let controller = new AbortController();
  let abort = () => controller.abort();
  process.once('SIGTERM', abort);
  process.once('SIGINT', abort);
  try {
    let result = await runCapability(registry, target, input, {
      scope,
      requestId,
      source: 'cli',
      signal: controller.signal,
    });
    if (result.state !== 'completed' && result.state !== 'running') { process.exitCode = 1; }
    return result;
  } finally {
    process.off('SIGTERM', abort);
    process.off('SIGINT', abort);
  }
}
