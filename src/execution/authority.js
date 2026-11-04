import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import schema from '../../schemas/authority.schema.json' with { type: 'json' };
import { ensure, hasCode } from '../errors.js';
import { atomicText, json, readBytes, utf8 } from '../files.js';
import { withLock } from '../lock.js';
import { validateData } from '../validation.js';
import { EXECUTION_LIMITS } from './constants.js';
import { captureJson, digestJson } from './json.js';

/**
 * @param {string} stateRoot
 * @returns {Promise<import('../../types/contracts.js').Authority>}
 */
export async function readAuthority(stateRoot) {
  let value;
  try { value = JSON.parse(utf8(await readBytes(join(stateRoot, 'authority.json'), EXECUTION_LIMITS.authorityBytes))); }
  catch (error) {
    if (!hasCode(error, 'ENOENT')) { throw error; }
    value = {
      formatVersion: 1,
      grants: [],
      profiles: [],
    };
  }
  validateData(schema, value, 'INVALID_AUTHORITY');
  let authority = /** @type {import('../../types/contracts.js').Authority} */ (value);
  ensure(new Set(authority.grants.map((entry) => entry.id)).size === authority.grants.length,
    'INVALID_AUTHORITY', 'Duplicate private grant identity.');
  ensure(new Set(authority.profiles.map((entry) => entry.name)).size === authority.profiles.length,
    'INVALID_AUTHORITY', 'Duplicate credential profile identity.');
  ensure(authority.profiles.every((profile) => profile.revision === digestJson(profile.values)),
    'INVALID_AUTHORITY', 'Credential profile digest does not match its values.');
  return authority;
}

/**
 * @template T
 * @param {string} stateRoot
 * @param {(authority: import('../../types/contracts.js').Authority) => T} change
 */
async function changeAuthority(stateRoot, change) {
  await mkdir(stateRoot, {
    recursive: true,
    mode: 0o700,
  });
  return withLock(join(stateRoot, '.authority-lock'), async () => {
    let value = await readAuthority(stateRoot);
    let result = change(value);
    validateData(schema, value, 'INVALID_AUTHORITY');
    let text = json(value);
    ensure(Buffer.byteLength(text) <= EXECUTION_LIMITS.authorityBytes, 'LIMIT_EXCEEDED', 'Private authority storage is full.');
    await atomicText(join(stateRoot, 'authority.json'), text);
    return result;
  });
}

/**
 * @param {string} stateRoot
 * @param {string} name
 * @param {unknown} values
 */
export async function setCredentialProfile(stateRoot, name, values) {
  ensure(/^[a-z][a-z0-9_-]{0,63}$/.test(name), 'INVALID_INPUT', 'Invalid credential profile name.');
  let captured = captureJson(values, EXECUTION_LIMITS.credentialsBytes);
  let profile = {
    name,
    revision: digestJson(captured),
    values: /** @type {Record<string, string>} */ (captured),
  };
  return changeAuthority(stateRoot, (authority) => {
    let index = authority.profiles.findIndex((entry) => entry.name === name);
    if (index === -1) { authority.profiles.push(profile); }
    else { authority.profiles[index] = profile; }
    return {
      name,
      revision: profile.revision,
      keys: Object.keys(profile.values),
    };
  });
}

/** @param {string} stateRoot */
export async function credentialProfiles(stateRoot) {
  return (await readAuthority(stateRoot)).profiles.map((profile) => ({
    name: profile.name,
    revision: profile.revision,
    keys: Object.keys(profile.values),
  }));
}

/**
 * @param {string} stateRoot
 * @param {string} name
 */
export async function removeCredentialProfile(stateRoot, name) {
  return changeAuthority(stateRoot, (authority) => {
    let index = authority.profiles.findIndex((entry) => entry.name === name);
    ensure(index !== -1, 'NOT_FOUND', 'Unknown credential profile.');
    authority.profiles.splice(index, 1);
    return {
      name,
      removed: true,
    };
  });
}

/**
 * @param {import('../registry/registry.js').FileRegistry} registry
 * @param {string} address
 * @param {import('../../types/contracts.js').GrantOptions} options
 */
export async function grantCapability(registry, address, options) {
  let resolved = await registry.show(address);
  ensure(resolved.prepared, 'NOT_PREPARED', 'Prepare this revision in private storage before granting execution.');
  ensure(options.revision === resolved.binding.revision && options.effect === resolved.manifest.effect,
    'GRANT_MISMATCH', 'Review the exact pinned revision and effect before granting.');
  return changeAuthority(registry.stateRoot, (authority) => {
    authority.grants = authority.grants.filter((entry) => !entry.revoked);
    let profile = options.profile ? authority.profiles.find((entry) => entry.name === options.profile) : undefined;
    ensure(!options.profile || profile, 'NOT_FOUND', 'Unknown credential profile.');
    ensure(resolved.manifest.credentials.every((name) => profile && Object.hasOwn(profile.values, name)),
      'CREDENTIALS_MISSING', 'The selected profile lacks required credential references.');
    /** @type {import('../../types/contracts.js').Grant} */
    let grant = {
      id: randomUUID(),
      registryId: resolved.registryId,
      registryRoot: registry.root,
      scope: options.scope,
      scriptId: resolved.script.id,
      revision: resolved.binding.revision,
      effect: options.effect,
      source: options.source,
      profile: profile?.name ?? null,
      profileRevision: profile?.revision ?? null,
      timeoutMs: Math.min(options.timeoutMs ?? resolved.manifest.limits.timeoutMs, resolved.manifest.limits.timeoutMs),
      resultBytes: Math.min(options.resultBytes ?? resolved.manifest.limits.resultBytes, resolved.manifest.limits.resultBytes),
      revoked: false,
    };
    // Regranting the same local scope replaces its record without unbounded history growth.
    let index = authority.grants.findIndex((entry) => entry.registryId === grant.registryId
      && entry.registryRoot === grant.registryRoot && entry.scope === grant.scope && entry.scriptId === grant.scriptId
      && entry.revision === grant.revision && entry.source === grant.source);
    if (index === -1) { authority.grants.push(grant); }
    else { authority.grants[index] = grant; }
    return grant;
  });
}

/**
 * @param {string} stateRoot
 * @param {string} id
 */
export async function revokeGrant(stateRoot, id) {
  return changeAuthority(stateRoot, (authority) => {
    let grant = authority.grants.find((entry) => entry.id === id);
    ensure(grant, 'NOT_FOUND', 'Unknown grant.');
    grant.revoked = true;
    return {
      id,
      revoked: true,
    };
  });
}

/**
 * @param {import('../registry/registry.js').FileRegistry} registry
 * @param {Awaited<ReturnType<import('../registry/registry.js').FileRegistry['show']>>} resolved
 * @param {import('../../types/contracts.js').ExecutionRequest} request
 */
export async function authorize(registry, resolved, request) {
  let authority = await readAuthority(registry.stateRoot);
  let grant = authority.grants.find((entry) => !entry.revoked && entry.registryId === resolved.registryId
    && entry.registryRoot === registry.root && entry.scope === request.scope && entry.source === (request.source ?? 'cli')
    && entry.scriptId === resolved.script.id && entry.revision === resolved.binding.revision
    && entry.effect === resolved.manifest.effect);
  ensure(grant, 'ACCESS_DENIED', 'No matching private execution grant.');
  let profile = grant.profile ? authority.profiles.find((entry) => entry.name === grant.profile) : undefined;
  ensure(!grant.profile || (profile && profile.revision === grant.profileRevision), 'CREDENTIALS_CHANGED', 'Credential profile changed or is unavailable; review and regrant.');
  /** @type {Record<string, string>} */
  let credentials = {};
  for (let name of resolved.manifest.credentials) {
    ensure(profile && Object.hasOwn(profile.values, name), 'CREDENTIALS_MISSING', 'Required credential is unavailable.');
    credentials[name] = profile.values[name];
  }
  return {
    grant,
    credentials,
  };
}
