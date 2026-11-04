import { isBuiltin, registerHooks } from 'node:module';
import { realpathSync } from 'node:fs';
import { extname, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensure } from '../errors.js';

/** @param {string} root */
export function restrictImports(root) {
  let canonical = realpathSync(root);
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      ensure(isBuiltin(specifier) || specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('file:'),
        'IMPORT_DENIED', 'Only built-ins and relative bundle imports are supported.');
      let result = nextResolve(specifier, context);
      if (result.url.startsWith('node:')) { return result; }
      ensure(result.url.startsWith('file:'), 'IMPORT_DENIED', 'Remote and data imports are unsupported.');
      let path = realpathSync(fileURLToPath(result.url));
      let local = relative(canonical, path);
      ensure(local && !local.startsWith(`..${sep}`) && local !== '..' && !isAbsolute(local),
        'IMPORT_DENIED', 'Module import escapes its prepared bundle.');
      ensure(new Set([
        '.js',
        '.mjs',
        '.json',
      ]).has(extname(path)), 'IMPORT_DENIED', 'Only ESM JavaScript and JSON modules are supported.');
      return result;
    },
  });
}
