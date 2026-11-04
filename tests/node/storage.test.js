import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, cli } from './helpers.js';
import { configureStorage, reconnectStorage, FileRegistry, grantCapability, runCapability, initializeRegistry, findRegistry } from '../../src/index.js';
import { registryStorageContract } from './storage-contract.js';

for (let type of [
  'file',
  'sqlite',
]) {
  test(`${type} registry implements the shared discovery, pinning, CAS, and import/export contract`, async (t) => {
    let f = await fixture(t);
    if (type === 'sqlite') {
      await configureStorage(f.collection, {
        type,
        database: join(f.root, 'registry.sqlite'),
      }, (await f.registry.read()).document.generation, f.state);
    }
    await registryStorageContract(f);
  });
}

test('SQLite stays authoritative, fails closed without private connection, and shares CAS across checkouts', async (t) => {
  let f = await fixture(t);
  let before = await f.registry.read();
  let database = join(f.root, 'registry.sqlite');
  await configureStorage(f.collection, {
    type: 'sqlite',
    database,
  }, before.document.generation, f.state);
  await assert.rejects(FileRegistry.open(f.collection, join(f.root, 'fresh-private')), {
    code: 'REGISTRY_CONNECTION_REQUIRED',
  });
  let copy = join(f.root, 'other-checkout');
  await cp(f.collection, copy, {
    recursive: true,
  });
  await reconnectStorage(copy, {
    type: 'sqlite',
    database,
  }, f.state);
  let other = await FileRegistry.open(copy, f.state);
  let generation = (await f.registry.read()).document.generation;
  let changed = await Promise.allSettled([
    f.registry.bind('host.first', f.created.scriptId, f.created.revision, generation),
    other.bind('host.second', f.created.scriptId, f.created.revision, generation),
  ]);
  assert.equal(changed.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(changed.filter((entry) => entry.status === 'rejected').length, 1);
  await writeFile(join(f.collection, 'registry.json'), before.text);
  await rename(database, `${database}.offline`);
  await assert.rejects(f.registry.read());
  await initializeRegistry(f.root);
  await assert.rejects(findRegistry(undefined, f.state, f.collection), {
    code: 'ENOENT',
  });
  await rename(`${database}.offline`, database);
  let latest = await f.registry.read();
  await assert.rejects(configureStorage(f.collection, {
    type: 'file',
  }, latest.document.generation, f.state), {
    code: 'EEXIST',
  });
  // An unexpected JSON file is never overwritten by an export or backend switch.
  assert.equal(await readFile(join(f.collection, 'registry.json'), 'utf8'), before.text);
});

test('database metadata cannot grant or substitute a new executable revision', async (t) => {
  let f = await fixture(t);
  let source = join(f.collection, f.created.path, 'index.js');
  await writeFile(source, 'export async function execute() { return {}; }\n');
  let approved = (await f.registry.prepare('sample.records.read')).result;
  await f.registry.bind('sample.records.read', approved.scriptId, approved.revision);
  await grantCapability(f.registry, 'sample.records.read', {
    scope: 'storage-test',
    revision: approved.revision,
    effect: 'read',
    source: 'cli',
  });
  await configureStorage(f.collection, {
    type: 'sqlite',
    database: join(f.root, 'trusted.sqlite'),
  }, (await f.registry.read()).document.generation, f.state);
  let {
    randomUUID,
  } = await import('node:crypto');
  assert.equal((await runCapability(f.registry, 'sample.records.read', {}, {
    scope: 'storage-test',
    requestId: randomUUID(),
  })).state, 'completed');
  await writeFile(source, 'export async function execute() { return {}; }\n// Different revision.\n');
  let next = (await f.registry.prepare('sample.records.read')).result;
  await f.registry.bind('sample.records.read', next.scriptId, next.revision);
  await assert.rejects(runCapability(f.registry, 'sample.records.read', {}, {
    scope: 'storage-test',
    requestId: randomUUID(),
  }), {
    code: 'ACCESS_DENIED',
  });
  let status = await cli([
    'registry',
    'storage',
    '--registry',
    f.collection,
  ], f.state);
  assert.equal(status.type, 'sqlite');
});

test('explicit SQLite/file switching preserves identity and rejects poisoned or foreign imports', async (t) => {
  let f = await fixture(t);
  let initial = (await f.registry.read()).document;
  await cli([
    'registry',
    'storage',
    '--type',
    'sqlite',
    '--database',
    join(f.root, 'roundtrip.sqlite'),
    '--expected-generation',
    String(initial.generation),
    '--registry',
    f.collection,
  ], f.state);
  let archive = join(f.root, 'metadata.json');
  await cli([
    'registry',
    'export',
    '--file',
    archive,
    '--registry',
    f.collection,
  ], f.state);
  for (let imported of [
    {
      ...initial,
      grants: [],
    },
    {
      ...initial,
      id: '00000000-0000-4000-8000-000000000000',
    },
  ]) {
    let file = join(f.root, 'invalid-import.json');
    await writeFile(file, JSON.stringify(imported));
    await assert.rejects(cli([
      'registry',
      'import',
      '--file',
      file,
      '--expected-generation',
      String(initial.generation),
      '--registry',
      f.collection,
    ], f.state));
    assert.deepEqual((await f.registry.read()).document, initial);
  }
  await cli([
    'registry',
    'storage',
    '--type',
    'file',
    '--expected-generation',
    String(initial.generation),
    '--registry',
    f.collection,
  ], f.state);
  let fresh = await FileRegistry.open(f.collection, join(f.root, 'fresh-state'));
  assert.deepEqual((await fresh.read()).document, initial);
  assert.equal((await fresh.show('sample.records.read')).prepared, false);
});

test('invalid PostgreSQL connection material is never included in errors', async (t) => {
  let f = await fixture(t);
  let {
    setCredentialProfile,
  } = await import('../../src/index.js');
  let {
    PostgresStorage,
  } = await import('../../src/registry/storage/postgres.js');
  let marker = 'PRIVATE_CONNECTION_SECRET';
  await setCredentialProfile(f.state, 'broken', {
    DATABASE_URL: `postgresql://user:${marker}@[invalid-host/records`,
  });
  await assert.rejects(new PostgresStorage('broken', (await f.registry.read()).document.id, f.state).read(), (error) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(marker));
    return true;
  });
});
