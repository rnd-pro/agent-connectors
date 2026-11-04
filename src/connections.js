import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { mkdir, realpath } from 'node:fs/promises';
import { ensure, hasCode } from './errors.js';
import { atomicText, json, readBytes, utf8 } from './files.js';
import { LIMITS } from './constants.js';
import { validateConnections } from './validation.js';
import { readRegistry } from './registry/store.js';
import { withLock } from './lock.js';

export function defaultStateRoot() {
  return resolve(process.env.AGENT_CONNECTORS_HOME || join(homedir(), '.agent-connectors'));
}

/** @param {string} stateRoot */
export async function readConnections(stateRoot) {
  try { return validateConnections(JSON.parse(utf8(await readBytes(join(stateRoot, 'connections.json'), LIMITS.registryBytes)))); }
  catch (error) {
    if (!hasCode(error, 'ENOENT')) { throw error; }
    return validateConnections({
      formatVersion: 1,
      generation: 0,
      sources: {},
    });
  }
}

/**
 * @param {string} stateRoot
 * @param {string} name
 * @param {string | null} folder
 */
export async function changeConnection(stateRoot, name, folder) {
  ensure(/^[a-z][a-z0-9_-]{0,63}$/.test(name), 'INVALID_INPUT', 'Invalid registry connection name.');
  await mkdir(stateRoot, {
    recursive: true,
    mode: 0o700,
  });
  return withLock(join(stateRoot, '.connections-lock'), async () => {
    let document = await readConnections(stateRoot);
    if (folder !== null) {
      let root = await realpath(folder);
      let {
        document: registry,
      } = await readRegistry(root);
      let previous = Object.hasOwn(document.sources, name) ? document.sources[name] : undefined;
      ensure(!previous || (previous.root === root && previous.registryId === registry.id),
        'ALREADY_EXISTS', 'Connection name already identifies another registry. Disconnect it explicitly first.');
      document.sources[name] = {
        root,
        registryId: registry.id,
      };
    } else {
      ensure(Object.hasOwn(document.sources, name), 'NOT_FOUND', 'Unknown registry connection.');
      delete document.sources[name];
    }
    document.generation++;
    validateConnections(document);
    await atomicText(join(stateRoot, 'connections.json'), json(document));
    return document;
  });
}

/**
 * @param {string | undefined} selected
 * @param {string} stateRoot
 * @param {string} [cwd]
 */
export async function findRegistry(selected, stateRoot, cwd = process.cwd()) {
  if (selected) {
    let connections = await readConnections(stateRoot);
    if (Object.hasOwn(connections.sources, selected)) {
      let source = connections.sources[selected];
      let {
        document,
      } = await readRegistry(source.root);
      ensure(source.registryId === document.id, 'INTEGRITY_ERROR', 'Connected directory now contains a different registry. Reconnect explicitly.');
      return source.root;
    }
    ensure(selected.includes('/') || selected.includes('\\') || selected === '.', 'NOT_FOUND', 'Unknown registry connection. Use ./folder for a relative directory.');
    let root = await realpath(resolve(cwd, selected));
    await readRegistry(root);
    return root;
  }
  let current = await realpath(cwd);
  while (true) {
    try { await readRegistry(current); return current; }
    catch (error) { if (!hasCode(error, 'ENOENT')) { throw error; } }
    let parent = dirname(current);
    if (parent === current) { break; }
    current = parent;
  }
  ensure(false, 'NOT_FOUND', 'No registry found. Initialize one or select --registry <name|./folder>.');
}
