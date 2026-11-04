import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ensure, hasCode } from './errors.js';

/**
 * @param {string} path
 * @param {number} limit
 */
export async function readBytes(path, limit) {
  let before = await lstat(path);
  ensure(before.isFile() && !before.isSymbolicLink(), 'UNSAFE_PATH', `Expected a regular file: ${path}`);
  ensure(before.size <= limit, 'LIMIT_EXCEEDED', `File exceeds ${limit} bytes: ${path}`);
  let handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    let stat = await handle.stat();
    ensure(stat.isFile() && stat.ino === before.ino && stat.dev === before.dev, 'CONFLICT', 'File changed during read.');
    ensure(stat.size <= limit, 'LIMIT_EXCEEDED', 'File grew beyond its size limit.');
    let buffer = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < buffer.length) {
      let {
        bytesRead,
      } = await handle.read(buffer, size, buffer.length - size);
      if (!bytesRead) { break; }
      size += bytesRead;
    }
    ensure(size <= limit, 'LIMIT_EXCEEDED', `File exceeds ${limit} bytes: ${path}`);
    let after = await handle.stat();
    ensure(after.size === stat.size && after.mtimeMs === stat.mtimeMs && after.ctimeMs === stat.ctimeMs,
      'CONFLICT', 'File changed during read.');
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}

/** @param {Buffer} bytes */
export function utf8(bytes) {
  return new TextDecoder('utf-8', {
    fatal: true,
  }).decode(bytes);
}

/**
 * @param {string} root
 * @param {string} path
 * @param {boolean} [allowMissing]
 */
export async function inside(root, path, allowMissing = false) {
  ensure(path.length > 0 && !path.includes('\\') && !path.startsWith('/') && !path.includes('\0'), 'UNSAFE_PATH', 'Expected a relative slash-separated path.');
  let parts = path.split('/');
  ensure(parts.every((part) => part !== '.' && part !== '..' && part.length > 0 && !part.includes(':')), 'UNSAFE_PATH', 'Path traversal is not allowed.');
  let base = await realpath(root);
  let target = resolve(base, ...parts);
  ensure(!isAbsolute(relative(base, target)) && !relative(base, target).startsWith(`..${sep}`) && target !== base, 'UNSAFE_PATH', 'Path escapes its root.');
  let current = base;
  for (let part of parts) {
    current = join(current, part);
    try {
      let stat = await lstat(current);
      ensure(!stat.isSymbolicLink(), 'UNSAFE_PATH', 'Symlinks are not allowed inside registry paths.');
    } catch (error) {
      if (allowMissing && hasCode(error, 'ENOENT')) { return target; }
      throw error;
    }
  }
  return target;
}

/**
 * @param {string} path
 * @param {string} text
 * @param {boolean} [exclusive]
 */
export async function atomicText(path, text, exclusive = false) {
  await mkdir(dirname(path), {
    recursive: true,
    mode: 0o700,
  });
  let temporary = `${path}.${randomUUID()}.tmp`;
  let handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    if (exclusive) { await link(temporary, path); }
    else { await rename(temporary, path); }
  } finally { await unlink(temporary).catch((error) => { if (!hasCode(error, 'ENOENT')) { throw error; } }); }
}

/** @param {unknown} value */
export function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }
