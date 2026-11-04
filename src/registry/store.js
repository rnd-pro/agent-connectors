import { randomUUID } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { LIMITS } from '../constants.js';
import { ensure } from '../errors.js';
import { atomicText, inside, json, readBytes, utf8 } from '../files.js';
import { withLock } from '../lock.js';
import { validateRegistry } from '../validation.js';

/** @param {string} root */
export async function readRegistry(root) {
  let text = utf8(await readBytes(join(root, 'registry.json'), LIMITS.registryBytes));
  let document = validateRegistry(JSON.parse(text));
  for (let script of document.scripts) {
    ensure(script.path.split('/').length === 2 && script.path.endsWith(`/${script.id}`),
      'INVALID_DOCUMENT', 'Script paths must be <project>/<UUID>.');
    await inside(root, script.path, true);
  }
  return {
    document,
    text,
  };
}

/** @param {string} root */
export async function initializeRegistry(root) {
  await mkdir(root, {
    recursive: true,
  });
  root = await realpath(root);
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
 */
export async function mutateRegistry(root, change, expectedGeneration) {
  let initial = await readRegistry(root);
  let expected = expectedGeneration ?? initial.document.generation;
  return withLock(join(root, '.registry-lock'), async () => {
    let {
      document,
      text,
    } = await readRegistry(root);
    ensure(document.generation === expected, 'CONFLICT', 'Registry generation changed; reread before retrying.');
    let result = await change(document);
    document.generation++;
    validateRegistry(document);
    let output = json(document);
    ensure(Buffer.byteLength(output) <= LIMITS.registryBytes, 'LIMIT_EXCEEDED', 'Registry document is too large.');
    ensure((await readRegistry(root)).text === text, 'CONFLICT', 'Registry changed outside the writer lock.');
    await atomicText(join(root, 'registry.json'), output);
    return {
      generation: document.generation,
      result,
    };
  });
}
