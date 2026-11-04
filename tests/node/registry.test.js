import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileRegistry, readRegistry, readBundle, changeConnection, findRegistry } from '../../src/index.js';
import { fixture, cli } from './helpers.js';

test('aliases share one source, revisions remain pinned, and discovery never runs code', async (t) => {
  let {
    registry,
    collection,
    state,
    created,
    root,
  } = await fixture(t);
  await registry.bind('workspace.items.inspect', created.scriptId, created.revision);
  let directory = join(collection, created.path);
  let sentinel = join(root, 'MUST_NOT_EXIST');
  let malicious = `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(sentinel)}, 'executed');\nexport async function execute() { return {}; }\n`;
  await writeFile(join(directory, 'index.js'), malicious);
  await mkdir(join(directory, 'lib'));
  await writeFile(join(directory, 'lib', 'helper.js'), 'export let value = 1;\n');
  let prepared = (await registry.prepare('sample.records.read')).result;
  assert.notEqual(prepared.revision, created.revision);
  assert.equal((await registry.show('sample.records.read')).binding.revision, created.revision);
  let difference = await registry.diff('sample.records.read', created.revision);
  assert.deepEqual(difference.files.map((file) => file.path), [
    'index.js',
    'lib/helper.js',
  ]);
  assert.equal(difference.files[0].after?.text, malicious);
  await registry.bind('workspace.items.inspect', created.scriptId, prepared.revision);
  assert.equal((await registry.source('workspace.items.inspect')).source, malicious);
  assert.equal((await registry.check('workspace.items.inspect')).changed, false);
  await writeFile(join(directory, 'lib', 'helper.js'), 'export let value = 2;\n');
  assert.equal((await registry.check('workspace.items.inspect')).changed, true);
  assert.equal((await registry.list()).total, 2);
  assert.equal((await registry.list('sample.records')).entries[0].scriptId, created.scriptId);
  assert.equal((await registry.search('reconciliation')).total, 2);
  assert.equal((await cli([
    'source',
    'workspace.items.inspect',
    '--registry',
    collection,
  ], state)).source, malicious);
  assert.equal((await readRegistry(collection)).document.scripts.length, 1);
  await assert.rejects(access(sentinel), {
    code: 'ENOENT',
  });
});

test('documentation editing stays in working source until explicit prepare and bind', async (t) => {
  let {
    registry,
    created,
    collection,
  } = await fixture(t);
  let before = await registry.describe('sample.records.read');
  await registry.describe('sample.records.read', '# New description\n\nSearchable example content.\n');
  assert.deepEqual(await registry.describe('sample.records.read'), before);
  let candidate = (await registry.prepare('sample.records.read')).result;
  await registry.bind('sample.records.read', created.scriptId, candidate.revision);
  let description = await registry.describe('sample.records.read');
  assert.ok('description' in description);
  assert.match(description.description, /Searchable example/);
  assert.equal((await registry.search('searchable')).total, 1);
  assert.match(await readFile(join(collection, created.path, 'description.md'), 'utf8'), /New description/);
});

test('independent processes serialize publication and reject stale generations', async (t) => {
  let {
    state,
    collection,
    created,
  } = await fixture(t);
  let args = [
    '--registry',
    collection,
    '--script',
    created.scriptId,
    '--revision',
    created.revision,
    '--expected-generation',
    '1',
  ];
  let results = await Promise.allSettled([
    cli([
      'bind',
      'branch.first',
      ...args,
    ], state),
    cli([
      'bind',
      'branch.second',
      ...args,
    ], state),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  let failure = results.find((result) => result.status === 'rejected');
  assert.ok(failure && failure.status === 'rejected');
  assert.equal(JSON.parse(failure.reason.stderr).error.code, 'CONFLICT');
  let {
    document,
  } = await readRegistry(collection);
  assert.equal(document.generation, 2);
  assert.equal(document.bindings.length, 2);
});

test('new private storage can inspect matching Git source without inherited prepared state', async (t) => {
  let {
    collection,
    created,
    root,
  } = await fixture(t);
  let other = await FileRegistry.open(collection, join(root, 'another-machine'));
  assert.equal((await other.show('sample.records.read')).prepared, false);
  assert.equal((await other.source('sample.records.read')).revision, created.revision);
  await writeFile(join(collection, created.path, 'index.js'), 'export let changed = true;\n');
  await assert.rejects(other.show('sample.records.read'), {
    code: 'REVISION_UNAVAILABLE',
  });
});

test('registry connections preserve identity and explicit selection does not fall back', async (t) => {
  let {
    collection,
    state,
  } = await fixture(t);
  await changeConnection(state, 'team', collection);
  assert.equal(await findRegistry('team', state), collection);
  await assert.rejects(findRegistry('unknown', state, collection), {
    code: 'NOT_FOUND',
  });
  let path = join(collection, 'registry.json');
  let document = JSON.parse(await readFile(path, 'utf8'));
  document.id = '11111111-1111-4111-8111-111111111111';
  await writeFile(path, JSON.stringify(document));
  await assert.rejects(findRegistry('team', state), {
    code: 'INTEGRITY_ERROR',
  });
  await changeConnection(state, 'team', null);
});

test('bundle digest is deterministic and includes helper and description bytes', async (t) => {
  let {
    collection,
    created,
  } = await fixture(t);
  let root = join(collection, created.path);
  let before = await readBundle(root);
  assert.equal((await readBundle(root)).revision, before.revision);
  await writeFile(join(root, 'description.md'), '# Changed\r\n');
  assert.notEqual((await readBundle(root)).revision, before.revision);
});
