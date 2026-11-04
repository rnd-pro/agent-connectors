import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { cp } from 'node:fs/promises';
import pg from 'pg';
import { fixture } from './helpers.js';
import { postgresFixture } from './postgres-fixture.js';
import { registryStorageContract } from './storage-contract.js';
import { configureStorage, FileRegistry, provisionPostgres, setCredentialProfile, reconnectStorage } from '../../src/index.js';
import { PostgresStorage } from '../../src/registry/storage/postgres.js';

test('PostgreSQL registry shares the contract, enforces row policies, and never imports execution authority', {
  timeout: 60000,
}, async (t) => {
  let f = await fixture(t);
  let server = await postgresFixture(f.cleanup, f.root);
  f.cleanup(() => server.client.end());
  for (let role of [
    'connector_writer',
    'connector_reader',
    'connector_other',
  ]) { await server.client.query(`CREATE ROLE ${role} LOGIN`); }
  await setCredentialProfile(f.state, 'admin', {
    DATABASE_URL: server.url,
  });
  await setCredentialProfile(f.state, 'writer', {
    DATABASE_URL: server.url.replace('connector_admin@', 'connector_writer@'),
  });
  await setCredentialProfile(f.state, 'reader', {
    DATABASE_URL: server.url.replace('connector_admin@', 'connector_reader@'),
  });
  await setCredentialProfile(f.state, 'other', {
    DATABASE_URL: server.url.replace('connector_admin@', 'connector_other@'),
  });
  let document = (await f.registry.read()).document;
  await provisionPostgres(document, 'admin', 'connector_writer', true, f.state);
  await provisionPostgres(document, 'admin', 'connector_reader', false, f.state);
  await configureStorage(f.collection, {
    type: 'postgres',
    profile: 'writer',
  }, document.generation, f.state);
  await registryStorageContract(f);
  let reader = new PostgresStorage('reader', document.id, f.state);
  let before = await reader.read();
  await assert.rejects(reader.compareAndSet(before, {
    ...before.document,
    generation: before.document.generation + 1,
  }));
  let unseen = {
    ...document,
    id: randomUUID(),
  };
  await provisionPostgres(unseen, 'admin', 'connector_other', true, f.state);
  await assert.rejects(new PostgresStorage('writer', unseen.id, f.state).read(), {
    code: 'NOT_FOUND',
  });
  await assert.rejects(new PostgresStorage('other', document.id, f.state).read(), {
    code: 'NOT_FOUND',
  });
  let client = new pg.Client({
    connectionString: server.url.replace('connector_admin@', 'connector_writer@'),
  });
  await client.connect();
  try {
    assert.equal((await client.query('SELECT id FROM agent_connectors.registries')).rows.length, 1);
    await client.query("SELECT set_config('app.current_user_id', 'connector_other', false)");
    assert.equal((await client.query('SELECT id FROM agent_connectors.registries')).rows[0].id, document.id);
    await assert.rejects(client.query('DELETE FROM agent_connectors.registries'));
    await assert.rejects(client.query('UPDATE agent_connectors.registry_access SET can_write = true'));
    let copy = join(f.root, 'second-host');
    await cp(f.collection, copy, {
      recursive: true,
    });
    await reconnectStorage(copy, {
      type: 'postgres',
      profile: 'writer',
    }, f.state);
    let other = await FileRegistry.open(copy, f.state);
    let expected = (await f.registry.read()).document.generation;
    let writes = await Promise.allSettled([
      f.registry.bind('host.first', f.created.scriptId, f.created.revision, expected),
      other.bind('host.second', f.created.scriptId, f.created.revision, expected),
    ]);
    assert.equal(writes.filter((entry) => entry.status === 'fulfilled').length, 1);
    assert.equal(writes.filter((entry) => entry.status === 'rejected').length, 1);
    await assert.rejects(new PostgresStorage('admin', document.id, f.state).read(), {
      code: 'ACCESS_DENIED',
    });
  } finally { await client.end(); }
});
