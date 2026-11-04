import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { ADDRESS_PATTERN, LIMITS, SCHEMA_DIALECT } from '../constants.js';
import { ensure } from '../errors.js';
import { atomicText, inside, json } from '../files.js';
import { readBundle } from '../bundle/read.js';
import { saveSnapshot } from '../bundle/snapshots.js';
import { mutateRegistry, readRegistry } from './store.js';

/**
 * @param {import('./registry.js').FileRegistry} registry
 * @param {string} address
 * @param {string} project
 * @param {'read' | 'write'} effect
 * @param {number} [expectedGeneration]
 */
export async function scaffold(registry, address, project, effect, expectedGeneration) {
  ensure(new RegExp(ADDRESS_PATTERN).test(address) && address.length <= 256, 'INVALID_INPUT', 'Invalid semantic address.');
  ensure(/^[a-z][a-z0-9_-]{0,63}$/.test(project), 'INVALID_INPUT', 'Project must be a lowercase folder name.');
  ensure(effect === 'read' || effect === 'write', 'INVALID_INPUT', 'Effect must be read or write.');
  let created = '';
  let published = false;
  try {
    let result = await mutateRegistry(registry.root, async (document) => {
      ensure(!document.bindings.some((binding) => binding.address === address), 'ALREADY_EXISTS', 'Semantic address already exists.');
      let id = randomUUID();
      let path = `${project}/${id}`;
      let output = await inside(registry.root, path, true);
      await mkdir(dirname(output), {
        recursive: true,
      });
      await mkdir(output);
      created = output;
      let schema = {
        $schema: SCHEMA_DIALECT,
        type: 'object',
        properties: {},
        additionalProperties: false,
      };
      let manifest = {
        contractVersion: 1,
        id,
        name: address,
        tags: [],
        entry: 'index.js',
        effect,
        inputSchema: schema,
        outputSchema: schema,
        credentials: [],
        access: {
          network: [],
          files: [],
        },
        limits: {
          timeoutMs: 10000,
          resultBytes: 65536,
        },
      };
      await writeFile(join(output, 'connector.json'), json(manifest), {
        flag: 'wx',
      });
      await writeFile(join(output, 'description.md'), `# ${address}\n\nDescribe this capability's purpose, inputs, outputs, side effects, access requirements, and failure/reconciliation rules before use.\n`, {
        flag: 'wx',
      });
      await writeFile(join(output, 'index.js'), "export async function execute() {\n  throw new Error('Implement this connector before execution.');\n}\n", {
        flag: 'wx',
      });
      // Local package scope makes index.js ESM independently of a parent checkout.
      await writeFile(join(output, 'package.json'), json({
        type: 'module',
        private: true,
      }), {
        flag: 'wx',
      });
      let bundle = await readBundle(output);
      await saveSnapshot(registry.stateRoot, bundle);
      document.scripts.push({
        id,
        path,
        revisions: [
          bundle.revision,
        ],
      });
      let binding = {
        address,
        scriptId: id,
        revision: bundle.revision,
      };
      document.bindings.push(binding);
      return {
        ...binding,
        path,
      };
    }, expectedGeneration);
    published = true;
    return result;
  } finally {
    // A lock-release failure must not delete already published source.
    let referenced = created && !published && (await readRegistry(registry.root)).document.scripts
      .some((script) => script.path === relative(registry.root, created).split('\\').join('/'));
    if (created && !published && !referenced) {
      await rm(created, {
        recursive: true,
        force: true,
      });
    }
  }
}

/**
 * @param {import('./registry.js').FileRegistry} registry
 * @param {string} address
 * @param {string} replacement
 * @param {number} [expectedGeneration]
 */
export async function writeDescription(registry, address, replacement, expectedGeneration) {
  ensure(replacement.trim() && Buffer.byteLength(replacement) <= LIMITS.descriptionBytes,
    'INVALID_INPUT', 'Description must be nonempty and at most 64 KiB.');
  return mutateRegistry(registry.root, async (document) => {
    let binding = document.bindings.find((item) => item.address === address);
    let script = document.scripts.find((item) => item.id === binding?.scriptId);
    ensure(script, 'NOT_FOUND', 'Unknown semantic address.');
    let path = await inside(registry.root, `${script.path}/description.md`);
    await atomicText(path, replacement);
    return {
      address,
      workingDescriptionUpdated: true,
      bindingUnchanged: true,
    };
  }, expectedGeneration);
}
