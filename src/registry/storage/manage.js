import { realpath, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { atomicText, inside, json } from '../../files.js';
import { ensure } from '../../errors.js';
import { withLock } from '../../lock.js';
import { defaultStateRoot } from '../../state.js';
import { FileStorage } from './file.js';
import { connectedStorage, readStorageMarker, storageConnectionPath, MARKER_FILE, readStorageConnection, validateStorageTarget } from './connection.js';
import { snapshot } from './snapshot.js';
import { readRegistry } from '../store.js';

/**
 * @param {string} root
 * @param {import('../../../types/storage.js').StorageTarget} target
 * @param {string} stateRoot
 */
async function connectionFor(root, target, stateRoot) {
  let marker = await readStorageMarker(root);
  let id = marker?.registryId || (await new FileStorage(root).read()).document.id;
  let connection = {
    ...target,
    version: /** @type {const} */ (1),
    registryId: id,
    root,
    ...(target.type === 'sqlite' ? {
      database: resolve(target.database),
    } : {}),
  };
  ensure(target.type !== 'file', 'INVALID_INPUT', 'A database connection is required.');
  let path = storageConnectionPath(root, stateRoot);
  return {
    connection: /** @type {import('../../../types/storage.js').StorageConnection} */ (connection),
    path,
  };
}

/**
 * @param {string} root
 * @param {import('../../../types/storage.js').StorageTarget} target
 * @param {string} [stateRoot]
 */
export async function reconnectStorage(root, target, stateRoot = defaultStateRoot()) {
  root = await realpath(root);
  target = validateStorageTarget(target);
  return withLock(join(root, '.registry-lock'), async () => {
    let marker = await readStorageMarker(root);
    ensure(marker && marker.type === target.type, 'INVALID_INPUT', 'Reconnect must match the declared database type.');
    let {
      connection,
      path,
    } = await connectionFor(root, target, stateRoot);
    let data = await (await connectedStorage(connection, stateRoot)).read();
    ensure(data.document.id === marker.registryId, 'INTEGRITY_ERROR', 'The selected database contains another registry.');
    await atomicText(path, json(connection));
    return storageStatus(root, stateRoot);
  });
}

/**
 * @param {string} root
 * @param {import('../../../types/storage.js').StorageTarget} target
 * @param {number} expectedGeneration
 * @param {string} [stateRoot]
 */
export async function configureStorage(root, target, expectedGeneration, stateRoot = defaultStateRoot()) {
  ensure(Number.isSafeInteger(expectedGeneration) && expectedGeneration >= 0, 'INVALID_INPUT', 'Storage switching requires an explicit generation.');
  root = await realpath(root);
  target = validateStorageTarget(target);
  return withLock(join(root, '.registry-lock'), async () => {
    let before = await readRegistry(root, stateRoot);
    ensure(before.document.generation === expectedGeneration, 'CONFLICT', 'Registry changed before switching storage.');
    let previousMarker = await readStorageMarker(root);
    let previous = await readStorageConnection(root, stateRoot);
    if (target.type === 'file') {
      ensure(previousMarker, 'INVALID_INPUT', 'This registry already uses files.');
      await atomicText(join(root, 'registry.json'), before.text, true);
      let verify = await readRegistry(root, stateRoot);
      ensure(verify.digest === before.digest, 'CONFLICT', 'Database changed while exporting. Reconcile registry.json before switching.');
      await unlink(join(root, MARKER_FILE));
      await unlink(storageConnectionPath(root, stateRoot));
      return storageStatus(root, stateRoot);
    }
    let {
      connection,
      path,
    } = await connectionFor(root, target, stateRoot);
    let next = await connectedStorage(connection, stateRoot);
    let same = previous && JSON.stringify(previous) === JSON.stringify(connection);
    if (same) { return storageStatus(root, stateRoot); }
    if (target.type === 'sqlite') {
      let {
        SqliteStorage,
      } = await import('./sqlite.js');
      await new SqliteStorage(resolve(target.database), before.document.id).initialize(before.document);
    } else {
      let destination = await next.read();
      ensure(destination.document.id === before.document.id, 'INTEGRITY_ERROR', 'Target registry identity differs.');
      if (destination.digest !== before.digest) {
        ensure(!destination.document.scripts.length && !destination.document.bindings.length,
          'CONFLICT', 'The target is not empty and differs from this registry. Use explicit import with its generation.');
        await next.compareAndSet(destination, {
          ...before.document,
          generation: destination.document.generation + 1,
        });
      }
    }
    ensure((await readRegistry(root, stateRoot)).digest === before.digest, 'CONFLICT', 'Source registry changed during migration.');
    // Keep an exact private backup; a portable marker prevents JSON fallback.
    let backup = join(stateRoot, 'registry-backups', `${before.document.id}-${before.digest}.json`);
    await atomicText(backup, before.text);
    await atomicText(path, json(connection));
    try {
      await atomicText(join(root, MARKER_FILE), json({
        version: 1,
        type: target.type,
        registryId: before.document.id,
      }));
    } catch (error) {
      if (previous) { await atomicText(path, json(previous)); }
      else { await unlink(path); }
      throw error;
    }
    if (!previousMarker) { await unlink(join(root, 'registry.json')); }
    return {
      ...await storageStatus(root, stateRoot),
      backup,
    };
  });
}

/**
 * @param {string} root
 * @param {string} [stateRoot]
 */
export async function storageStatus(root, stateRoot = defaultStateRoot()) {
  root = await realpath(root);
  let marker = await readStorageMarker(root);
  let connection = marker ? await readStorageConnection(root, stateRoot) : undefined;
  let {
    document,
  } = await readRegistry(root, stateRoot);
  return {
    root,
    type: marker?.type || 'file',
    registryId: document.id,
    generation: document.generation,
    ...(connection?.type === 'sqlite' ? {
      database: connection.database,
    } : {}),
    ...(connection?.type === 'postgres' ? {
      profile: connection.profile,
    } : {}),
  };
}

/**
 * @param {import('../registry.js').FileRegistry} registry
 * @param {unknown} imported
 * @param {number} expectedGeneration
 */
export async function importRegistry(registry, imported, expectedGeneration) {
  ensure(Number.isSafeInteger(expectedGeneration) && expectedGeneration >= 0, 'INVALID_INPUT', 'Import requires an explicit generation.');
  let importedSnapshot = snapshot(json(imported));
  for (let script of importedSnapshot.document.scripts) {
    // Validate source paths without fetching or executing code.
    ensure(script.path.split('/').length === 2 && script.path.endsWith(`/${script.id}`), 'INVALID_DOCUMENT', 'Invalid imported script path.');
    await inside(registry.root, script.path, true);
  }
  return registry.mutate(async (document) => {
    ensure(importedSnapshot.document.id === document.id, 'INTEGRITY_ERROR', 'Import cannot replace registry UUID.');
    document.scripts = structuredClone(importedSnapshot.document.scripts);
    document.bindings = structuredClone(importedSnapshot.document.bindings);
    return {
      registryId: document.id,
      bindings: document.bindings.length,
      scripts: document.scripts.length,
    };
  }, expectedGeneration);
}
