import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { grantCapability, revokeGrant, runCapability, getReceipt, setCredentialProfile, credentialProfiles } from '../../src/index.js';
import { executable } from './execution-helpers.js';

test('execution needs exact scope, source, revision, and schema-valid input', async (t) => {
  let f = await executable(t, 'export async function execute(input) { return input.value + 1; }', {
    grant: false,
    inputSchema: {
      type: 'object',
      required: [
        'value',
      ],
      properties: {
        value: {
          type: 'number',
        },
      },
      additionalProperties: false,
    },
  });
  await assert.rejects(runCapability(f.registry, 'sample.records.read', {}, f.request()), {
    code: 'ACCESS_DENIED',
  });
  await grantCapability(f.registry, 'sample.records.read', f.grantOptions);
  await assert.rejects(runCapability(f.registry, 'sample.records.read', {}, f.request()), {
    code: 'INPUT_INVALID',
  });
  await assert.rejects(runCapability(f.registry, 'sample.records.read', {}, {
    ...f.request(),
    scope: 'other',
  }), {
    code: 'ACCESS_DENIED',
  });
  await assert.rejects(runCapability(f.registry, 'sample.records.read', {}, {
    ...f.request(),
    source: 'agent',
  }), {
    code: 'ACCESS_DENIED',
  });
  let result = await runCapability(f.registry, 'sample.records.read', {
    value: 41,
  }, f.request());
  assert.equal(result.state, 'completed');
  assert.equal(result.value, 42);
  await writeFile(join(f.directory, 'index.js'), 'export async function execute() { return 100; }');
  let changed = (await f.registry.prepare('sample.records.read')).result;
  await f.registry.bind('sample.records.read', f.created.scriptId, changed.revision);
  await assert.rejects(runCapability(f.registry, 'sample.records.read', {
    value: 0,
  }, f.request()), {
    code: 'ACCESS_DENIED',
  });
});

test('write verification, stable request identity, retained results, and conflicting input', async (t) => {
  let f = await executable(t, 'export async function execute(input, context) { return context.verified({ value: input.value, id: context.idempotencyKey }); }', {
    effect: 'write',
  });
  let request = f.request();
  let input = {
    value: 'saved',
  };
  let result = await runCapability(f.registry, 'sample.records.read', input, request);
  assert.equal(result.state, 'completed');
  assert.deepEqual(result.value, {
    value: 'saved',
    id: request.requestId,
  });
  assert.deepEqual(await runCapability(f.registry, 'sample.records.read', input, request), result);
  await assert.rejects(runCapability(f.registry, 'sample.records.read', {
    value: 'different',
  }, request), {
    code: 'REQUEST_CONFLICT',
  });
  assert.deepEqual(await getReceipt(f.state, request.requestId), result);
  let unverified = await executable(t, 'export async function execute() { return { saved: true }; }', {
    effect: 'write',
  });
  let uncertain = await runCapability(unverified.registry, 'sample.records.read', {}, unverified.request());
  assert.equal(uncertain.state, 'unknown');
  assert.equal(uncertain.code, 'WRITE_UNVERIFIED');
});

test('credentials stay scoped, logs are redacted, and host secrets are not inherited', async (t) => {
  let f = await executable(t, `export async function execute(input, context) {
    context.log(context.credentials.token);
    return { hasToken: !!context.credentials.token, unexpected: context.credentials.other ?? null, inherited: process.env.AGENT_CONNECTORS_HOST_SECRET ?? null, injected: process.env.NODE_OPTIONS ?? null };
  }`, {
    credentials: [
      'token',
    ],
  });
  let secret = 'sensitive-test-value-012345';
  await setCredentialProfile(f.state, 'test', {
    token: secret,
    other: 'not-injected',
  });
  await grantCapability(f.registry, 'sample.records.read', {
    ...f.grantOptions,
    profile: 'test',
  });
  let previous = process.env.AGENT_CONNECTORS_HOST_SECRET;
  process.env.AGENT_CONNECTORS_HOST_SECRET = 'must-not-inherit';
  try {
    let result = await runCapability(f.registry, 'sample.records.read', {}, f.request());
    assert.equal(result.state, 'completed');
    assert.deepEqual(result.value, {
      hasToken: true,
      unexpected: null,
      inherited: null,
      injected: null,
    });
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.ok(result.logs);
    assert.match(result.logs, /REDACTED/);
    assert.ok(!JSON.stringify(await credentialProfiles(f.state)).includes(secret));
  } finally {
    if (previous === undefined) { delete process.env.AGENT_CONNECTORS_HOST_SECRET; }
    else { process.env.AGENT_CONNECTORS_HOST_SECRET = previous; }
  }
  await setCredentialProfile(f.state, 'test', {
    token: 'changed-secret-012345',
  });
  await assert.rejects(runCapability(f.registry, 'sample.records.read', {}, f.request()), {
    code: 'CREDENTIALS_CHANGED',
  });
});

test('revoking access cancels active execution and blocks subsequent calls', async (t) => {
  let f = await executable(t, 'export async function execute() { await new Promise(resolve => setTimeout(resolve, 10000)); return {}; }', {
    timeoutMs: 15000,
  });
  assert.ok(f.grant);
  let request = f.request();
  let running = runCapability(f.registry, 'sample.records.read', {}, request);
  await delay(350);
  await revokeGrant(f.state, f.grant.id);
  let result = await running;
  assert.equal(result.state, 'unknown');
  assert.equal(result.code, 'ACCESS_REVOKED');
  await assert.rejects(runCapability(f.registry, 'sample.records.read', {}, f.request()), {
    code: 'ACCESS_DENIED',
  });
});

test('invalid output after possible writes is retained as unknown', async (t) => {
  let f = await executable(t, 'export async function execute() { return "not-an-integer"; }', {
    grant: false,
  });
  let path = join(f.directory, 'connector.json');
  let manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.outputSchema = {
    type: 'integer',
  };
  await writeFile(path, JSON.stringify(manifest));
  let prepared = (await f.registry.prepare('sample.records.read')).result;
  await f.registry.bind('sample.records.read', f.created.scriptId, prepared.revision);
  await grantCapability(f.registry, 'sample.records.read', {
    ...f.grantOptions,
    revision: prepared.revision,
  });
  let result = await runCapability(f.registry, 'sample.records.read', {}, f.request());
  assert.equal(result.state, 'unknown');
  assert.equal(result.code, 'OUTPUT_INVALID');
});

test('dead-owner receipts never replay even if their previous outcome is unknown', async (t) => {
  let f = await executable(t, 'export async function execute() { return 1; }');
  let requestId = randomUUID();
  let first = await runCapability(f.registry, 'sample.records.read', {}, {
    scope: 'test',
    requestId,
  });
  let indexPath = join(f.state, 'execution', 'index.json');
  let index = JSON.parse(await readFile(indexPath, 'utf8'));
  index.entries[0].state = 'running';
  index.entries[0].deadline = 1;
  await writeFile(indexPath, JSON.stringify(index));
  // Simulate interruption before a terminal result file was published.
  let {
    unlink,
  } = await import('node:fs/promises');
  await unlink(join(f.state, 'execution', `${requestId}.json`));
  let result = await runCapability(f.registry, 'sample.records.read', {}, {
    scope: 'test',
    requestId,
  });
  assert.equal(first.state, 'completed');
  assert.equal(result.state, 'unknown');
  assert.equal(result.code, 'INTERRUPTED');
});
