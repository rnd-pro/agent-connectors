import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { runCapability, getReceipt, grantCapability, listReceipts, forgetReceipt } from '../../src/index.js';
import { executable } from './execution-helpers.js';
import { cli, cliPath } from './helpers.js';

/** @param {string} path */
async function waitForPids(path) {
  for (let attempt = 0; attempt < 150; attempt++) {
    try { return /** @type {number[]} */ (JSON.parse(await readFile(path, 'utf8'))); }
    catch { await delay(20); }
  }
  throw new Error('Connector did not record its process identities.');
}

/** @param {number[]} pids */
async function assertStopped(pids) {
  for (let attempt = 0; attempt < 150; attempt++) {
    let active = pids.filter((pid) => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    });
    if (!active.length) { return; }
    await delay(20);
  }
  for (let pid of pids) {
    assert.throws(() => process.kill(pid, 0), {
      code: 'ESRCH',
    });
  }
}

let blocked = `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
export async function execute(input) {
  let child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  writeFileSync(input.pidFile, JSON.stringify([process.pid, child.pid]));
  while (true) {}
}`;

test('deadline kills a CPU-blocked connector and its descendants', async (t) => {
  let f = await executable(t, blocked, {
    timeoutMs: 1200,
  });
  let pidFile = join(f.root, 'pids.json');
  let result = await runCapability(f.registry, 'sample.records.read', {
    pidFile,
  }, f.request());
  assert.equal(result.state, 'unknown');
  assert.equal(result.code, 'TIMEOUT');
  await assertStopped(await waitForPids(pidFile));
});

test('caller crash leaves an unknown receipt and supervisor cleans up a blocked worker', async (t) => {
  let f = await executable(t, blocked, {
    timeoutMs: 15000,
  });
  let request = f.request();
  let pidFile = join(f.root, 'crash-pids.json');
  let input = {
    pidFile,
  };
  let inputPath = join(f.root, 'input.json');
  await writeFile(inputPath, JSON.stringify(input));
  let child = spawn(process.execPath, [
    cliPath,
    'run',
    'sample.records.read',
    '--registry',
    f.collection,
    '--scope',
    request.scope,
    '--request',
    request.requestId,
    '--file',
    inputPath,
  ], {
    env: {
      ...process.env,
      AGENT_CONNECTORS_HOME: f.state,
    },
    stdio: 'ignore',
  });
  t.after(() => child.kill('SIGKILL'));
  let pids = await waitForPids(pidFile);
  let exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  await assertStopped(pids);
  assert.equal((await getReceipt(f.state, request.requestId)).state, 'unknown');
  assert.equal((await runCapability(f.registry, 'sample.records.read', input, request)).state, 'unknown');
});

test('stdout overflow, result bounds, and external imports fail without replay', async (t) => {
  let cases = [
    {
      code: 'export async function execute() { process.stdout.write("x".repeat(200000)); await new Promise(resolve => setTimeout(resolve, 10000)); }',
      expected: 'OUTPUT_LIMIT',
      bytes: 65536,
    },
    {
      code: 'export async function execute() { return "x".repeat(3000); }',
      expected: 'RESULT_LIMIT',
      bytes: 1000,
    },
    {
      code: 'import "ajv"; export async function execute() { return {}; }',
      expected: 'IMPORT_DENIED',
      bytes: 65536,
    },
  ];
  for (let item of cases) {
    let f = await executable(t, item.code, {
      resultBytes: item.bytes,
    });
    let result = await runCapability(f.registry, 'sample.records.read', {}, f.request());
    assert.equal(result.state, 'unknown');
    assert.equal(result.code, item.expected);
    assert.ok(!result.logs || Buffer.byteLength(result.logs) <= 16384);
  }
});

test('CLI run and receipt commands share the library execution path', async (t) => {
  let f = await executable(t, 'export async function execute(input) { return { received: input.value }; }', {
    grant: false,
  });
  await cli([
    'grant',
    'sample.records.read',
    '--registry',
    f.collection,
    '--scope',
    'test',
    '--revision',
    f.prepared.revision,
    '--effect',
    'read',
  ], f.state);
  let request = f.request();
  let path = join(f.root, 'input.json');
  await writeFile(path, '{"value":17}');
  let args = [
    'run',
    'sample.records.read',
    '--registry',
    f.collection,
    '--scope',
    request.scope,
    '--request',
    request.requestId,
    '--file',
    path,
  ];
  let result = await cli(args, f.state);
  assert.equal(result.state, 'completed');
  assert.deepEqual(result.value, {
    received: 17,
  });
  assert.deepEqual(await cli(args, f.state), result);
  assert.equal((await cli([
    'receipts',
    'list',
  ], f.state)).length, 1);
  await assert.rejects(forgetReceipt(f.state, request.requestId, false), {
    code: 'INVALID_INPUT',
  });
  await forgetReceipt(f.state, request.requestId, true);
  assert.equal((await listReceipts(f.state)).length, 0);
});

test('execution concurrency is bounded and abort cancels active work', async (t) => {
  let f = await executable(t, 'export async function execute() { await new Promise(resolve => setTimeout(resolve, 10000)); return {}; }', {
    timeoutMs: 15000,
  });
  let controller = new AbortController();
  let pending = Array.from({
    length: 4,
  }, () => runCapability(f.registry, 'sample.records.read', {}, {
    ...f.request(),
    signal: controller.signal,
  }));
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await listReceipts(f.state)).length === 4) { break; }
      await delay(20);
    }
    await assert.rejects(runCapability(f.registry, 'sample.records.read', {}, f.request()), {
      code: 'EXECUTION_BUSY',
    });
  } finally { controller.abort(); }
  for (let result of await Promise.all(pending)) {
    assert.equal(result.state, 'unknown');
    assert.equal(result.code, 'CANCELLED');
  }
});
