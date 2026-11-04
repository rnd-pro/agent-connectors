import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCapability, grantCapability, setCredentialProfile, listReceipts } from '../../src/index.js';
import { executable } from './execution-helpers.js';

test('configured credentials cannot enter retained results', async (t) => {
  let f = await executable(t, 'export async function execute(input, context) { return { token: context.credentials.token }; }', {
    credentials: [
      'token',
    ],
  });
  let secret = 'secret-that-must-not-be-retained';
  await setCredentialProfile(f.state, 'private', {
    token: secret,
  });
  await grantCapability(f.registry, 'sample.records.read', {
    ...f.grantOptions,
    profile: 'private',
  });
  let request = f.request();
  let result = await runCapability(f.registry, 'sample.records.read', {}, request);
  assert.equal(result.state, 'unknown');
  assert.equal(result.code, 'CREDENTIAL_LEAK');
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!(await readFile(join(f.state, 'execution', `${request.requestId}.json`), 'utf8')).includes(secret));
});

test('receipt capacity fails closed instead of evicting duplicate protection', async (t) => {
  let f = await executable(t, 'export async function execute() { return {}; }');
  await runCapability(f.registry, 'sample.records.read', {}, f.request());
  let path = join(f.state, 'execution', 'index.json');
  let index = JSON.parse(await readFile(path, 'utf8'));
  let template = index.entries[0];
  index.entries = Array.from({
    length: 128,
  }, () => ({
    ...template,
    requestId: randomUUID(),
    state: 'unknown',
    code: 'INTERRUPTED',
  }));
  await writeFile(path, JSON.stringify(index));
  await assert.rejects(runCapability(f.registry, 'sample.records.read', {}, f.request()), {
    code: 'RECEIPTS_FULL',
  });
  assert.equal((await listReceipts(f.state)).length, 128);
});

test('relative bundle helpers work and external file imports are denied', async (t) => {
  let f = await executable(t, 'import { value } from "./lib/value.js"; export async function execute() { return value; }', {
    grant: false,
  });
  await mkdir(join(f.directory, 'lib'));
  await writeFile(join(f.directory, 'lib', 'value.js'), 'export let value = 7;');
  let prepared = (await f.registry.prepare('sample.records.read')).result;
  await f.registry.bind('sample.records.read', f.created.scriptId, prepared.revision);
  await grantCapability(f.registry, 'sample.records.read', {
    ...f.grantOptions,
    revision: prepared.revision,
  });
  assert.equal((await runCapability(f.registry, 'sample.records.read', {}, f.request())).value, 7);
  await writeFile(join(f.root, 'external.mjs'), 'throw new Error("External code must not load");');
  await writeFile(join(f.directory, 'index.js'), `import ${JSON.stringify(`file://${join(f.root, 'external.mjs')}`)}; export async function execute() { return {}; }`);
  let changed = (await f.registry.prepare('sample.records.read')).result;
  await f.registry.bind('sample.records.read', f.created.scriptId, changed.revision);
  await grantCapability(f.registry, 'sample.records.read', {
    ...f.grantOptions,
    revision: changed.revision,
  });
  let result = await runCapability(f.registry, 'sample.records.read', {}, f.request());
  assert.equal(result.state, 'unknown');
  assert.equal(result.code, 'IMPORT_DENIED');
});
