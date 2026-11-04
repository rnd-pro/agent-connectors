import { randomUUID } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { ensure } from '../errors.js';
import { atomicText, inside, json } from '../files.js';
import { withLock } from '../lock.js';
import { defaultStateRoot } from '../state.js';
import { openStorage, readStorageMarker } from './storage/connection.js';

/**
 * @param {string} root
 * @param {string} [stateRoot]
 */
export async function readRegistry(root, stateRoot = defaultStateRoot()) {
  root = await realpath(root);
  let result = await (await openStorage(root, stateRoot)).read();
  for (let script of result.document.scripts) {
    ensure(script.path.split('/').length === 2 && script.path.endsWith(`/${script.id}`),
      'INVALID_DOCUMENT', 'Script paths must be <project>/<UUID>.');
    await inside(root, script.path, true);
  }
  return result;
}

/** @param {string} root */
export async function initializeRegistry(root) {
  await mkdir(root, {
    recursive: true,
  });
  root = await realpath(root);
  ensure(!await readStorageMarker(root), 'ALREADY_EXISTS', 'This folder already declares a database registry.');
  /** @type {import('../../types/contracts.js').RegistryDocument} */
  let document = {
    formatVersion: 1,
    id: randomUUID(),
    generation: 0,
    scripts: [],
    bindings: [],
  };
  await atomicText(join(root, 'registry.json'), json(document), true);
  return {
    root,
    ...document,
  };
}

/**
 * @template T
 * @param {string} root
 * @param {(document: import('../../types/contracts.js').RegistryDocument) => Promise<T>} change
 * @param {number} [expectedGeneration]
 * @param {string} [stateRoot]
 */
export async function mutateRegistry(root, change, expectedGeneration, stateRoot = defaultStateRoot()) {
  root = await realpath(root);
  let initial = await readRegistry(root, stateRoot);
  let expected = expectedGeneration ?? initial.document.generation;
  return withLock(join(root, '.registry-lock'), async () => {
    let before = await readRegistry(root, stateRoot);
    ensure(before.document.generation === expected, 'CONFLICT', 'Registry generation changed; reread before retrying.');
    let document = structuredClone(before.document);
    let result = await change(document);
    document.generation++;
    await (await openStorage(root, stateRoot)).compareAndSet(before, document);
    return {
      generation: document.generation,
      result,
    };
  });
}
