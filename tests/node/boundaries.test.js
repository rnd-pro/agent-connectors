import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileRegistry, readBundle, readRegistry } from '../../src/index.js';
import { snapshotPath } from '../../src/bundle/snapshots.js';
import { fixture, cli } from './helpers.js';

test('escaping registry paths and source links are rejected', async (t) => {
  let {
    collection,
    created,
    registry,
    root,
  } = await fixture(t);
  let source = join(collection, created.path);
  await assert.rejects(registry.create('bad.address', '../escape'), {
    code: 'INVALID_INPUT',
  });
  await assert.rejects(registry.source('sample.records.read', '../connector.json'), {
    code: 'NOT_FOUND',
  });
  let outside = join(root, 'outside');
  await writeFile(outside, 'private');
  await symlink(outside, join(source, 'linked.js'));
  await assert.rejects(readBundle(source), {
    code: 'UNSAFE_PATH',
  });
  let index = JSON.parse(await readFile(join(collection, 'registry.json'), 'utf8'));
  index.scripts[0].path = `../${created.scriptId}`;
  await writeFile(join(collection, 'registry.json'), JSON.stringify(index));
  await assert.rejects(readRegistry(collection), {
    code: 'UNSAFE_PATH',
  });
});

test('symlink project directories cannot redirect scaffold writes', async (t) => {
  let {
    root,
    collection,
    registry,
  } = await fixture(t);
  let outside = join(root, 'outside');
  await mkdir(outside);
  await symlink(outside, join(collection, 'linked'));
  await assert.rejects(registry.create('linked.item', 'linked'), {
    code: 'UNSAFE_PATH',
  });
});

test('invalid JSON Schema and unresolved external references fail without fetching', async (t) => {
  let {
    collection,
    created,
    registry,
  } = await fixture(t);
  let file = join(collection, created.path, 'connector.json');
  let manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.inputSchema = {
    type: 'invalid-type',
  };
  await writeFile(file, JSON.stringify(manifest));
  await assert.rejects(registry.prepare('sample.records.read'), {
    code: 'INVALID_SCHEMA',
  });
  manifest.inputSchema = {
    $ref: 'https://invalid.example/remote-schema',
  };
  await writeFile(file, JSON.stringify(manifest));
  await assert.rejects(registry.check('sample.records.read'), {
    code: 'INVALID_SCHEMA',
  });
});

test('tampered prepared revisions and duplicate addresses are never trusted', async (t) => {
  let {
    registry,
    state,
    collection,
    created,
  } = await fixture(t);
  await writeFile(join(snapshotPath(state, created.revision), 'index.js'), 'export let tampered = true;\n');
  await assert.rejects(registry.source('sample.records.read'), {
    code: 'INTEGRITY_ERROR',
  });
  let path = join(collection, 'registry.json');
  let document = JSON.parse(await readFile(path, 'utf8'));
  document.bindings.push(document.bindings[0]);
  await writeFile(path, JSON.stringify(document));
  await assert.rejects(readRegistry(collection), {
    code: 'INVALID_DOCUMENT',
  });
});

test('CLI errors are structured and unsupported execution is unavailable', async (t) => {
  let {
    collection,
    state,
  } = await fixture(t);
  for (let args of [
    [
      'run',
      'sample.records.read',
    ],
    [
      'list',
      '--limit',
      '0',
    ],
    [
      'show',
      'sample.records.read',
      '--effect',
      'write',
    ],
  ]) {
    await assert.rejects(cli([
      ...args,
      '--registry',
      collection,
    ], state), (error) => {
      assert.ok(error instanceof Error && 'stderr' in error && typeof error.stderr === 'string');
      assert.equal(JSON.parse(error.stderr).error.code, 'INVALID_INPUT');
      return true;
    });
  }
});

test('namespace discovery is paginated and unbinding leaves shared source intact', async (t) => {
  let {
    registry,
    created,
    collection,
  } = await fixture(t);
  await registry.bind('sample.records.other', created.scriptId, created.revision);
  let result = await registry.list('sample.records', {
    limit: 1,
    offset: 1,
  });
  assert.equal(result.total, 2);
  assert.equal(result.entries.length, 1);
  await registry.unbind('sample.records.read');
  assert.equal((await registry.show('sample.records.other')).binding.scriptId, created.scriptId);
  assert.equal((await readRegistry(collection)).document.scripts.length, 1);
  assert.equal((await readRegistry(collection)).document.bindings.length, 1);
});
