import { LIMITS } from '../constants.js';
import { utf8 } from '../files.js';

/**
 * @param {import('../../types/contracts.js').Bundle} before
 * @param {import('../../types/contracts.js').Bundle} after
 */
export function diffBundles(before, after) {
  let remaining = LIMITS.fileBytes;
  /** @param {Buffer | undefined} bytes */
  function text(bytes) {
    if (!bytes || bytes.length > remaining || bytes.includes(0)) { return undefined; }
    try { let result = utf8(bytes); remaining -= bytes.length; return result; }
    catch { return undefined; }
  }
  let paths = [...new Set([
    ...before.contents.keys(),
    ...after.contents.keys(),
  ])].sort();
  let files = paths.flatMap((path) => {
    let previous = before.files.find((file) => file.path === path);
    let next = after.files.find((file) => file.path === path);
    if (previous?.sha256 === next?.sha256) { return []; }
    return [
      {
        path,
        kind: !previous ? 'added' : !next ? 'removed' : 'changed',
        before: previous ? {
          ...previous,
          text: text(before.contents.get(path)),
        } : null,
        after: next ? {
          ...next,
          text: text(after.contents.get(path)),
        } : null,
      },
    ];
  });
  return {
    from: before.revision,
    to: after.revision,
    files,
    textLimitBytes: LIMITS.fileBytes,
  };
}
