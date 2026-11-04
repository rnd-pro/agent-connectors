import { createHash } from 'node:crypto';
import { join, isAbsolute } from 'node:path';
import { ensure, hasCode } from '../../errors.js';
import { readBytes, utf8 } from '../../files.js';
import { UUID_PATTERN } from '../../constants.js';
import { FileStorage } from './file.js';

export const MARKER_FILE = 'registry.backend.json';

/**
 * @param {string} root
 * @param {string} stateRoot
 */
export function storageConnectionPath(root, stateRoot) {
  return join(stateRoot, 'registry-stores', `${createHash('sha256').update(root).digest('hex')}.json`);
}

/** @param {string} root */
export async function readStorageMarker(root) {
  let text;
  try { text = utf8(await readBytes(join(root, MARKER_FILE), 4096)); }
  catch (error) { if (hasCode(error, 'ENOENT')) { return; } throw error; }
  let value = JSON.parse(text);
  ensure(value && value.version === 1 && new RegExp(UUID_PATTERN).test(value.registryId)
    && [
      'sqlite',
      'postgres',
    ].includes(value.type)
    && Object.keys(value).sort().join(',') === 'registryId,type,version', 'INVALID_DOCUMENT', 'Invalid portable registry backend marker.');
  return /** @type {import('../../../types/storage.js').StorageMarker} */ (value);
}

/**
 * @param {string} root
 * @param {string} stateRoot
 * @returns {Promise<import('../../../types/storage.js').StorageConnection | undefined>}
 */
export async function readStorageConnection(root, stateRoot) {
  let text;
  try { text = utf8(await readBytes(storageConnectionPath(root, stateRoot), 8192)); }
  catch (error) { if (hasCode(error, 'ENOENT')) { return; } throw error; }
  let value = JSON.parse(text);
  ensure(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_DOCUMENT', 'Invalid private registry storage connection.');
  let allowed = value.type === 'sqlite' ? 'database,registryId,root,type,version' : 'profile,registryId,root,type,version';
  ensure(value && value.version === 1 && value.root === root && new RegExp(UUID_PATTERN).test(value.registryId)
    && Object.keys(value).sort().join(',') === allowed
    && (value.type === 'sqlite' && typeof value.database === 'string' && isAbsolute(value.database) && value.database.length <= 4096 && !value.database.includes('\0')
      || value.type === 'postgres' && typeof value.profile === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value.profile)),
    'INVALID_DOCUMENT', 'Invalid private registry storage connection.');
  return value;
}

/**
 * @param {unknown} value
 * @returns {import('../../../types/storage.js').StorageTarget}
 */
export function validateStorageTarget(value) {
  ensure(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'Invalid registry storage target.');
  let target = /** @type {Record<string, unknown>} */ (value);
  let fields = Object.keys(target).sort().join(',');
  ensure(target.type === 'file' && fields === 'type'
    || target.type === 'sqlite' && fields === 'database,type' && typeof target.database === 'string'
      && target.database.length > 0 && target.database.length <= 4096 && !target.database.includes('\0')
    || target.type === 'postgres' && fields === 'profile,type' && typeof target.profile === 'string'
      && /^[a-z][a-z0-9_-]{0,63}$/.test(target.profile), 'INVALID_INPUT', 'Choose a supported storage type and bounded database path or private profile name.');
  return /** @type {import('../../../types/storage.js').StorageTarget} */ (value);
}

/**
 * @param {import('../../../types/storage.js').StorageConnection} connection
 * @param {string} stateRoot
 * @returns {Promise<import('../../../types/storage.js').RegistryStorage>}
 */
export async function connectedStorage(connection, stateRoot) {
  if (connection.type === 'sqlite') {
    let {
      SqliteStorage,
    } = await import('./sqlite.js');
    return new SqliteStorage(connection.database, connection.registryId);
  }
  ensure(connection.type === 'postgres', 'INVALID_INPUT', 'Unsupported database registry type.');
  let {
    PostgresStorage,
  } = await import('./postgres.js');
  return new PostgresStorage(connection.profile, connection.registryId, stateRoot);
}

/**
 * @param {string} root
 * @param {string} stateRoot
 * @returns {Promise<import('../../../types/storage.js').RegistryStorage>}
 */
export async function openStorage(root, stateRoot) {
  let marker = await readStorageMarker(root);
  if (!marker) { return new FileStorage(root); }
  let connection = await readStorageConnection(root, stateRoot);
  ensure(connection && marker.type === connection.type && marker.registryId === connection.registryId,
    'REGISTRY_CONNECTION_REQUIRED', 'Connect this database-backed registry privately before use. File fallback is disabled.');
  return connectedStorage(connection, stateRoot);
}
