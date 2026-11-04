import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ConnectorError, hasCode } from './errors.js';

/**
 * @param {string} root
 * @param {string} owner
 */
async function release(root, owner) {
  await rmdir(join(root, owner)).catch((error) => { if (!hasCode(error, 'ENOENT')) { throw error; } });
  await rmdir(root).catch((error) => {
    if (![
      'ENOENT',
      'ENOTEMPTY',
      'EEXIST',
    ].some((code) => hasCode(error, code))) { throw error; }
  });
}

/**
 * @template T
 * @param {string} root
 * @param {() => Promise<T>} task
 */
export async function withLock(root, task) {
  let owner = `${process.pid}-${randomUUID()}`;
  let temporary = `${root}.${owner}`;
  await mkdir(temporary);
  await mkdir(join(temporary, owner));
  let acquired = false;
  let deadline = Date.now() + 5000;
  try {
    while (!acquired) {
      try { await rename(temporary, root); acquired = true; }
      catch (error) {
        if (![
          'EEXIST',
          'ENOTEMPTY',
          'EPERM',
        ].some((code) => hasCode(error, code))) { throw error; }
        let entries = await readdir(root).catch((error) => { if (hasCode(error, 'ENOENT')) { return []; } throw error; });
        let previous = entries.length === 1 ? entries[0] : '';
        let pid = previous.match(/^([1-9][0-9]*)-[a-f0-9-]{36}$/)?.[1];
        if (pid) {
          try { process.kill(Number(pid), 0); }
          catch (error) { if (hasCode(error, 'ESRCH')) { await release(root, previous); } }
        }
        if (Date.now() >= deadline) { throw new ConnectorError('BUSY', 'Registry storage is busy; retry after the current operation.'); }
        await delay(20);
      }
    }
    return await task();
  } finally {
    await release(acquired ? root : temporary, owner);
  }
}
