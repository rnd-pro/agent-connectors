import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileRegistry, initializeRegistry } from '../../src/index.js';

let exec = promisify(execFile);
export let cliPath = fileURLToPath(new URL('../../bin/agent-connectors.js', import.meta.url));

/** @param {import('node:test').TestContext} t */
export async function fixture(t) {
  let root = await realpath(await mkdtemp(join(tmpdir(), 'agent-connectors-test-')));
  t.after(() => rm(root, {
    recursive: true,
    force: true,
  }));
  let collection = join(root, 'collection');
  let state = join(root, 'private');
  await initializeRegistry(collection);
  let registry = await FileRegistry.open(collection, state);
  let created = await registry.create('sample.records.read', 'sample');
  return {
    root,
    collection,
    state,
    registry,
    created: created.result,
  };
}

/**
 * @param {string[]} args
 * @param {string} state
 */
export async function cli(args, state) {
  let result = await exec(process.execPath, [
    cliPath,
    ...args,
  ], {
    env: {
      ...process.env,
      AGENT_CONNECTORS_HOME: state,
    },
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(result.stdout).result;
}
