import { createHash } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { LIMITS } from '../constants.js';
import { ensure } from '../errors.js';
import { inside, readBytes, utf8 } from '../files.js';
import { validateManifest } from '../validation.js';

/** @param {Buffer} bytes */
export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

/** @param {string} name */
function portableName(name) {
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)
    && !name.endsWith('.');
}

/**
 * @param {string} root
 * @returns {Promise<import('../../types/contracts.js').Bundle>}
 */
export async function readBundle(root) {
  let stat = await lstat(root);
  ensure(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_PATH', 'Script root must be a real directory.');
  root = await realpath(root);
  /** @type {Map<string, Buffer>} */
  let contents = new Map();
  let seen = new Set();
  let bytes = 0;
  let entries = 0;

  /** @param {string} directory */
  async function walk(directory) {
    let names = await readdir(directory ? await inside(root, directory) : root);
    for (let name of names.sort()) {
      if (name === '.git') { continue; }
      ensure(++entries <= LIMITS.bundleFiles * 2, 'LIMIT_EXCEEDED', 'Too many bundle entries.');
      ensure(portableName(name), 'UNSAFE_PATH', `Non-portable bundle filename: ${name}`);
      let path = directory ? `${directory}/${name}` : name;
      ensure(path.length <= 512 && path.split('/').length <= 32, 'LIMIT_EXCEEDED', 'Bundle path is too deep or long.');
      let key = path.toLowerCase();
      ensure(!seen.has(key), 'UNSAFE_PATH', 'Case-colliding bundle paths.');
      seen.add(key);
      let absolute = await inside(root, path);
      let info = await lstat(absolute);
      if (info.isDirectory()) { await walk(path); continue; }
      ensure(info.isFile() && info.nlink === 1, 'UNSAFE_PATH', 'Only regular, unlinked bundle files are supported.');
      let data = await readBytes(absolute, path === 'description.md' ? LIMITS.descriptionBytes : LIMITS.fileBytes);
      bytes += data.length;
      ensure(bytes <= LIMITS.bundleBytes && contents.size < LIMITS.bundleFiles, 'LIMIT_EXCEEDED', 'Bundle exceeds size or file limits.');
      contents.set(path, data);
    }
  }

  await walk('');
  let manifestBytes = contents.get('connector.json');
  let descriptionBytes = contents.get('description.md');
  ensure(manifestBytes && descriptionBytes && contents.has('index.js'), 'INVALID_BUNDLE', 'Bundle needs connector.json, description.md, and index.js.');
  let manifest = validateManifest(JSON.parse(utf8(manifestBytes)));
  let description = utf8(descriptionBytes);
  ensure(description.trim(), 'INVALID_BUNDLE', 'Description must not be empty.');
  // Hash a domain/version marker and sorted path, size, and content hashes.
  let files = [
    ...contents,
  ].sort(([
    left,
  ], [
    right,
  ]) => left < right ? -1 : left > right ? 1 : 0).map(([
    path,
    data,
  ]) => ({
    path,
    size: data.length,
    sha256: sha256(data),
  }));
  let revision = `sha256:${sha256(Buffer.from(JSON.stringify([
    'agent-connectors-bundle-v1',
    files,
  ]), 'utf8'))}`;
  return {
    revision,
    manifest,
    description,
    files,
    contents,
  };
}
