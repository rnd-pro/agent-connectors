import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { cli } from './helpers.js';

/**
 * Shared behavior checks for the same registry API on every storage backend.
 * @param {Awaited<ReturnType<typeof import('./helpers.js').fixture>>} f
 */
export async function registryStorageContract(f) {
  let before = await f.registry.show('sample.records.read');
  await f.registry.bind('shared.records.read', f.created.scriptId, f.created.revision);
  assert.equal((await f.registry.source('shared.records.read')).source, (await f.registry.source('sample.records.read')).source);
  let original = (await f.registry.read()).document;
  let directory = join(f.collection, f.created.path);
  await writeFile(join(directory, 'description.md'), '# Changed shared description\n');
  let prepared = (await f.registry.prepare('sample.records.read')).result;
  assert.notEqual(prepared.revision, before.binding.revision);
  assert.equal((await f.registry.show('sample.records.read')).binding.revision, before.binding.revision);
  await f.registry.bind('shared.records.read', f.created.scriptId, prepared.revision);
  assert.equal((await f.registry.search('changed')).total, 1);
  let generation = (await f.registry.read()).document.generation;
  let results = await Promise.allSettled([
    cli([
      'bind',
      'parallel.first',
      '--script',
      f.created.scriptId,
      '--revision',
      f.created.revision,
      '--expected-generation',
      String(generation),
      '--registry',
      f.collection,
    ], f.state),
    cli([
      'bind',
      'parallel.second',
      '--script',
      f.created.scriptId,
      '--revision',
      f.created.revision,
      '--expected-generation',
      String(generation),
      '--registry',
      f.collection,
    ], f.state),
  ]);
  assert.equal(results.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(results.filter((entry) => entry.status === 'rejected').length, 1);
  let exported = await cli([
    'registry',
    'export',
    '--registry',
    f.collection,
  ], f.state);
  assert.equal(exported.id, original.id);
  assert.ok(!JSON.stringify(exported).includes('DATABASE_URL'));
  let archive = join(f.root, 'export.json');
  await writeFile(archive, JSON.stringify(original));
  let current = (await f.registry.read()).document.generation;
  await cli([
    'registry',
    'import',
    '--registry',
    f.collection,
    '--file',
    archive,
    '--expected-generation',
    String(current),
  ], f.state);
  assert.deepEqual((await f.registry.read()).document.bindings, original.bindings);
  await assert.rejects(cli([
    'registry',
    'import',
    '--registry',
    f.collection,
    '--file',
    archive,
    '--expected-generation',
    String(current),
  ], f.state));
}
