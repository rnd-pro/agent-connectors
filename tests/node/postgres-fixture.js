import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { mkdir, open, realpath } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';

let execute = promisify(execFile);

/**
 * @param {(callback: () => unknown | Promise<unknown>) => void} cleanup
 * @param {string} root
 */
export async function postgresFixture(cleanup, root) {
  let binary = process.env.AGENT_CONNECTORS_TEST_POSTGRES_BIN;
  let bin = (/** @type {string} */ name) => binary ? join(binary, name) : name;
  let directory = join(root, 'postgres');
  await mkdir(directory);
  await execute(bin('initdb'), [
    '-D',
    directory,
    '-U',
    'connector_admin',
    '--auth=trust',
    '--no-locale',
    '--encoding=UTF8',
  ], {
    timeout: 30000,
  });
  let listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  let address = listener.address();
  if (!address || typeof address === 'string') { throw new Error('No isolated test port.'); }
  let port = address.port;
  await new Promise((resolve) => listener.close(resolve));
  let log = await open(join(root, 'postgres.log'), 'w');
  let server = spawn(bin('postgres'), [
    '-D',
    directory,
    '-h',
    '127.0.0.1',
    '-p',
    String(port),
    '-k',
    root,
  ], {
    stdio: [
      'ignore',
      log.fd,
      log.fd,
    ],
  });
  server.on('error', () => {});
  cleanup(async () => {
    if (server.pid && server.exitCode === null) {
      let exited = once(server, 'exit');
      server.kill('SIGINT');
      let timer = setTimeout(() => server.kill('SIGKILL'), 5000);
      try { await exited; } finally { clearTimeout(timer); }
    }
    await log.close();
  });
  let url = `postgresql://connector_admin@127.0.0.1:${port}/postgres`;
  for (let attempt = 0; attempt < 100; attempt++) {
    let client = new pg.Client({
      connectionString: url,
      connectionTimeoutMillis: 100,
    });
    client.on('error', () => {});
    try {
      await client.connect();
      let actual = (await client.query('SHOW data_directory')).rows[0].data_directory;
      if (await realpath(actual) !== await realpath(directory)) { throw new Error('Test port belongs to another PostgreSQL cluster.'); }
      return {
        url,
        port,
        client,
      };
    } catch {
      await client.end().catch(() => {});
      if (server.exitCode !== null) { throw new Error('Isolated PostgreSQL exited before readiness. Inspect postgres.log.'); }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
  throw new Error('Isolated PostgreSQL did not become ready.');
}
