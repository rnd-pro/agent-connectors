import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { ensure } from '../errors.js';
import { atomicText, json, readBytes, utf8 } from '../files.js';
import { LIMITS } from '../constants.js';
import { configureStorage, reconnectStorage, storageStatus, importRegistry } from '../registry/storage/manage.js';
import { provisionPostgres } from '../registry/storage/provision.js';
import { validateStorageTarget } from '../registry/storage/connection.js';

export const STORAGE_COMMANDS = Object.freeze({
  'registry storage': {
    args: 0,
    options: [
      'type',
      'database',
      'profile',
      'expected-generation',
    ],
    usage: 'registry storage [--type file|sqlite|postgres --database <path>|--profile <name> --expected-generation N]',
  },
  'registry reconnect': {
    args: 1,
    options: [
      'database',
      'profile',
    ],
    usage: 'registry reconnect <folder> --database <path>|--profile <name>',
  },
  'registry export': {
    args: 0,
    options: [
      'file',
    ],
    usage: 'registry export [--file <new-json-file>]',
  },
  'registry import': {
    args: 0,
    options: [
      'file',
      'expected-generation',
    ],
    usage: 'registry import --file <json-file> --expected-generation N',
  },
  'registry schema': {
    args: 0,
    options: [],
    usage: 'registry schema',
  },
  'registry provision': {
    args: 0,
    options: [
      'profile',
      'role',
      'write',
    ],
    usage: 'registry provision --profile <admin-profile> --role <existing-login-role> [--write]',
  },
});

/** @param {Record<string, string | boolean | undefined>} values */
export function storageTarget(values) {
  let type = values.type || (values.database ? 'sqlite' : values.profile ? 'postgres' : '');
  ensure((type === 'file' && !values.profile && !values.database)
    || (type === 'sqlite' && typeof values.database === 'string' && !values.profile)
    || (type === 'postgres' && typeof values.profile === 'string' && !values.database), 'INVALID_INPUT', 'Choose exactly one registry backend and its private connection.');
  return validateStorageTarget(type === 'file' ? {
    type,
  } : type === 'sqlite' ? {
    type,
    database: resolve(String(values.database)),
  } : {
    type,
    profile: String(values.profile),
  });
}

export async function registrySchema() {
  return readFile(new URL('../../schemas/postgres-registry.sql', import.meta.url), 'utf8');
}

/**
 * @param {string} command
 * @param {import('../registry/registry.js').FileRegistry} registry
 * @param {Record<string, string | boolean | undefined>} values
 * @param {number | undefined} generation
 */
export async function storageCommand(command, registry, values, generation) {
  if (command === 'registry storage') {
    if (!values.type) {
      ensure(!values.database && !values.profile && generation === undefined, 'INVALID_INPUT', 'Specify --type to switch storage.');
      return storageStatus(registry.root, registry.stateRoot);
    }
    ensure(generation !== undefined, 'INVALID_INPUT', 'Read the generation and pass --expected-generation explicitly.');
    return configureStorage(registry.root, storageTarget(values), generation, registry.stateRoot);
  }
  if (command === 'registry export') {
    let {
      document,
    } = await registry.read();
    if (values.file) { await atomicText(resolve(String(values.file)), json(document), true); }
    return document;
  }
  if (command === 'registry import') {
    ensure(typeof values.file === 'string' && generation !== undefined, 'INVALID_INPUT', 'Import requires --file and --expected-generation.');
    return importRegistry(registry, JSON.parse(utf8(await readBytes(values.file, LIMITS.registryBytes))), generation);
  }
  ensure(command === 'registry provision' && typeof values.profile === 'string' && typeof values.role === 'string',
    'INVALID_INPUT', 'Provision requires an admin profile and an existing database role.');
  return provisionPostgres((await registry.read()).document, values.profile, values.role, values.write === true, registry.stateRoot);
}

export { reconnectStorage };
