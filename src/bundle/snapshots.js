import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { REVISION_PATTERN } from '../constants.js';
import { ensure, hasCode } from '../errors.js';
import { inside } from '../files.js';
import { readBundle } from './read.js';

/**
 * @param {string} stateRoot
 * @param {string} revision
 */
export function snapshotPath(stateRoot, revision) {
  ensure(new RegExp(REVISION_PATTERN).test(revision), 'INVALID_INPUT', 'Invalid revision digest.');
  return join(stateRoot, 'bundles', revision.slice(7));
}

/**
 * @param {string} stateRoot
 * @param {import('../../types/contracts.js').Bundle} bundle
 */
export async function saveSnapshot(stateRoot, bundle) {
  let destination = snapshotPath(stateRoot, bundle.revision);
  await mkdir(dirname(destination), {
    recursive: true,
    mode: 0o700,
  });
  try {
    await lstat(destination);
    ensure((await readBundle(destination)).revision === bundle.revision, 'INTEGRITY_ERROR', 'Stored snapshot was modified.');
    return destination;
  } catch (error) { if (!hasCode(error, 'ENOENT')) { throw error; } }
  let temporary = await mkdtemp(join(dirname(destination), '.prepare-'));
  try {
    for (let [
      path,
      data,
    ] of bundle.contents) {
      let output = await inside(temporary, path, true);
      await mkdir(dirname(output), {
        recursive: true,
        mode: 0o700,
      });
      await writeFile(output, data, {
        flag: 'wx',
        mode: 0o600,
        flush: true,
      });
    }
    ensure((await readBundle(temporary)).revision === bundle.revision, 'INTEGRITY_ERROR', 'Prepared snapshot does not match its digest.');
    try { await rename(temporary, destination); }
    catch (error) {
      if (![
        'EEXIST',
        'ENOTEMPTY',
        'EPERM',
      ].some((code) => hasCode(error, code))) { throw error; }
      ensure((await readBundle(destination)).revision === bundle.revision, 'INTEGRITY_ERROR', 'Conflicting snapshot.');
    }
    return destination;
  } finally {
    await rm(temporary, {
      recursive: true,
      force: true,
    });
  }
}

/**
 * @param {string} stateRoot
 * @param {string} revision
 */
export async function loadSnapshot(stateRoot, revision) {
  let bundle = await readBundle(snapshotPath(stateRoot, revision));
  ensure(bundle.revision === revision, 'INTEGRITY_ERROR', 'Stored snapshot failed digest verification.');
  return bundle;
}
