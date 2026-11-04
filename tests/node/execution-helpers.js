import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { grantCapability } from '../../src/index.js';
import { fixture } from './helpers.js';

/**
 * @param {import('node:test').TestContext} t
 * @param {string} code
 * @param {{ effect?: 'read' | 'write'; credentials?: string[]; timeoutMs?: number; resultBytes?: number; inputSchema?: object; grant?: boolean }} [options]
 */
export async function executable(t, code, options = {}) {
  let base = await fixture(t);
  let directory = join(base.collection, base.created.path);
  let file = join(directory, 'connector.json');
  let manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.effect = options.effect ?? 'read';
  manifest.credentials = options.credentials ?? [];
  manifest.inputSchema = options.inputSchema ?? true;
  manifest.outputSchema = true;
  manifest.limits.timeoutMs = options.timeoutMs ?? 3000;
  manifest.limits.resultBytes = options.resultBytes ?? 65536;
  await writeFile(file, JSON.stringify(manifest, null, 2));
  await writeFile(join(directory, 'index.js'), code);
  let prepared = (await base.registry.prepare('sample.records.read')).result;
  await base.registry.bind('sample.records.read', base.created.scriptId, prepared.revision);
  let grantOptions = {
    scope: 'test',
    revision: prepared.revision,
    effect: /** @type {'read' | 'write'} */ (manifest.effect),
    source: /** @type {'cli'} */ ('cli'),
  };
  let grant = options.grant === false || manifest.credentials.length ? undefined
    : await grantCapability(base.registry, 'sample.records.read', grantOptions);
  return {
    ...base,
    directory,
    manifest,
    prepared,
    grant,
    grantOptions,
    request: () => ({
      scope: 'test',
      requestId: randomUUID(),
    }),
  };
}
