import { realpath } from 'node:fs/promises';
import { ADDRESS_PATTERN, LIMITS } from '../constants.js';
import { ensure, hasCode } from '../errors.js';
import { inside, utf8 } from '../files.js';
import { readBundle } from '../bundle/read.js';
import { loadSnapshot, saveSnapshot } from '../bundle/snapshots.js';
import { diffBundles } from '../bundle/diff.js';
import { mutateRegistry, readRegistry } from './store.js';
import { scaffold, writeDescription } from './source.js';

export class FileRegistry {
  /**
   * @param {string} root
   * @param {string} stateRoot
   */
  constructor(root, stateRoot) {
    this.root = root;
    this.stateRoot = stateRoot;
  }

  /**
   * @param {string} root
   * @param {string} stateRoot
   */
  static async open(root, stateRoot) {
    let registry = new FileRegistry(await realpath(root), stateRoot);
    await readRegistry(registry.root);
    return registry;
  }

  /** @param {string} address */
  async resolve(address) {
    let {
      document,
    } = await readRegistry(this.root);
    let binding = document.bindings.find((item) => item.address === address);
    ensure(binding, 'NOT_FOUND', `Unknown semantic address: ${address}`);
    let script = document.scripts.find((item) => item.id === binding.scriptId);
    ensure(script, 'INVALID_DOCUMENT', 'Missing registered script.');
    return {
      registryId: document.id,
      generation: document.generation,
      binding,
      script,
    };
  }

  /**
   * @param {import('../../types/contracts.js').ScriptRecord} script
   * @param {string} revision
   */
  async revision(script, revision) {
    ensure(script.revisions.includes(revision), 'NOT_FOUND', 'Revision is not registered for this script.');
    let bundle;
    let prepared = true;
    try { bundle = await loadSnapshot(this.stateRoot, revision); }
    catch (error) {
      if (!hasCode(error, 'ENOENT')) { throw error; }
      bundle = await readBundle(await inside(this.root, script.path));
      ensure(bundle.revision === revision, 'REVISION_UNAVAILABLE', 'Pinned revision is not cached and differs from source. Restore its reviewed source before preparation.');
      prepared = false;
    }
    ensure(bundle.manifest.id === script.id, 'INTEGRITY_ERROR', 'Script UUID does not match registered revision.');
    return {
      bundle,
      prepared,
    };
  }

  /** @param {string} address */
  async show(address) {
    let resolved = await this.resolve(address);
    let {
      bundle,
      prepared,
    } = await this.revision(resolved.script, resolved.binding.revision);
    return {
      ...resolved,
      manifest: bundle.manifest,
      files: bundle.files,
      prepared,
    };
  }

  /**
   * @param {string} address
   * @param {string} [replacement]
   * @param {number} [expectedGeneration]
   */
  async describe(address, replacement, expectedGeneration) {
    if (replacement !== undefined) { return writeDescription(this, address, replacement, expectedGeneration); }
    let {
      script,
      binding,
    } = await this.resolve(address);
    return {
      address,
      revision: binding.revision,
      description: (await this.revision(script, binding.revision)).bundle.description,
    };
  }

  /**
   * @param {string} address
   * @param {string} [path]
   */
  async source(address, path = 'index.js') {
    let {
      script,
      binding,
    } = await this.resolve(address);
    let {
      bundle,
    } = await this.revision(script, binding.revision);
    let bytes = bundle.contents.get(path);
    ensure(bytes, 'NOT_FOUND', 'File is not part of this pinned bundle.');
    return {
      address,
      revision: binding.revision,
      path,
      source: utf8(bytes),
    };
  }

  /** @param {string} address */
  async check(address) {
    let resolved = await this.resolve(address);
    let bundle = await readBundle(await inside(this.root, resolved.script.path));
    ensure(bundle.manifest.id === resolved.script.id, 'INTEGRITY_ERROR', 'Working manifest UUID changed.');
    return {
      ...resolved,
      candidateRevision: bundle.revision,
      changed: bundle.revision !== resolved.binding.revision,
      manifest: bundle.manifest,
      files: bundle.files,
    };
  }

  /**
   * @param {string} address
   * @param {number} [expectedGeneration]
   */
  async prepare(address, expectedGeneration) {
    return mutateRegistry(this.root, async (document) => {
      let binding = document.bindings.find((item) => item.address === address);
      ensure(binding, 'NOT_FOUND', 'Unknown semantic address.');
      let script = document.scripts.find((item) => item.id === binding.scriptId);
      ensure(script, 'NOT_FOUND', 'Unknown script.');
      let bundle = await readBundle(await inside(this.root, script.path));
      ensure(bundle.manifest.id === script.id, 'INTEGRITY_ERROR', 'Working manifest UUID changed.');
      await saveSnapshot(this.stateRoot, bundle);
      if (!script.revisions.includes(bundle.revision)) { script.revisions.push(bundle.revision); }
      return {
        address,
        scriptId: script.id,
        revision: bundle.revision,
        bindingRevision: binding.revision,
      };
    }, expectedGeneration);
  }

  /**
   * @param {string} address
   * @param {string} scriptId
   * @param {string} revision
   * @param {number} [expectedGeneration]
   */
  async bind(address, scriptId, revision, expectedGeneration) {
    ensure(new RegExp(ADDRESS_PATTERN).test(address) && address.length <= 256, 'INVALID_INPUT', 'Invalid semantic address.');
    return mutateRegistry(this.root, async (document) => {
      let script = document.scripts.find((item) => item.id === scriptId);
      ensure(script, 'NOT_FOUND', 'Unknown script UUID.');
      await this.revision(script, revision);
      let binding = {
        address,
        scriptId,
        revision,
      };
      let previous = document.bindings.findIndex((item) => item.address === address);
      if (previous === -1) { document.bindings.push(binding); }
      else { document.bindings[previous] = binding; }
      return binding;
    }, expectedGeneration);
  }

  /**
   * @param {string} address
   * @param {number} [expectedGeneration]
   */
  async unbind(address, expectedGeneration) {
    return mutateRegistry(this.root, async (document) => {
      let index = document.bindings.findIndex((binding) => binding.address === address);
      ensure(index !== -1, 'NOT_FOUND', 'Unknown semantic address.');
      return document.bindings.splice(index, 1)[0];
    }, expectedGeneration);
  }

  /**
   * @param {string} address
   * @param {string} from
   */
  async diff(address, from) {
    let {
      script,
    } = await this.resolve(address);
    let before = (await this.revision(script, from)).bundle;
    let after = await readBundle(await inside(this.root, script.path));
    ensure(after.manifest.id === script.id, 'INTEGRITY_ERROR', 'Working manifest UUID changed.');
    return diffBundles(before, after);
  }

  /**
   * @param {string} address
   * @param {string} project
   * @param {'read' | 'write'} [effect]
   * @param {number} [expectedGeneration]
   */
  async create(address, project, effect = 'read', expectedGeneration) {
    return scaffold(this, address, project, effect, expectedGeneration);
  }

  /**
   * @param {string} [namespace]
   * @param {import('../../types/contracts.js').PageOptions} [options]
   */
  async list(namespace = '', options = {}) {
    return this.discover(namespace, '', options);
  }

  /**
   * @param {string} query
   * @param {import('../../types/contracts.js').PageOptions} [options]
   */
  async search(query, options = {}) {
    ensure(query.trim(), 'INVALID_INPUT', 'Search query must not be empty.');
    return this.discover('', query.toLowerCase(), options);
  }

  /**
   * @param {string} namespace
   * @param {string} query
   * @param {import('../../types/contracts.js').PageOptions} options
   */
  async discover(namespace, query, options) {
    let offset = options.offset ?? 0;
    let limit = options.limit ?? 20;
    ensure(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit)
      && limit > 0 && limit <= LIMITS.pageSize, 'INVALID_INPUT', 'Invalid pagination.');
    ensure(!namespace || new RegExp(ADDRESS_PATTERN).test(namespace), 'INVALID_INPUT', 'Invalid namespace.');
    let {
      document,
    } = await readRegistry(this.root);
    let prefix = namespace ? `${namespace}.` : '';
    /** @type {Map<string, Awaited<ReturnType<FileRegistry['revision']>>>} */
    let revisions = new Map();
    /** @type {Map<string, { address: string; kind: string; scriptId?: string; revision?: string; name?: string; effect?: string; tags?: string[] }>} */
    let entries = new Map();
    for (let binding of document.bindings) {
      if (!binding.address.startsWith(prefix)) { continue; }
      let tail = binding.address.slice(prefix.length);
      if (!query && tail.includes('.')) {
        let address = `${prefix}${tail.split('.')[0]}`;
        entries.set(address, {
          address,
          kind: 'namespace',
        });
        continue;
      }
      let script = document.scripts.find((item) => item.id === binding.scriptId);
      ensure(script, 'INVALID_DOCUMENT', 'Missing script identity.');
      let key = `${script.id}:${binding.revision}`;
      let resolved = revisions.get(key) ?? await this.revision(script, binding.revision);
      // Avoid rereading one shared implementation for every alias, with bounded retention.
      if (revisions.size >= 8) { revisions.delete(revisions.keys().next().value || ''); }
      revisions.set(key, resolved);
      let {
        bundle,
      } = resolved;
      let {
        name,
        tags,
        effect,
      } = bundle.manifest;
      if (query && !`${binding.address} ${name} ${tags.join(' ')} ${bundle.description}`.toLowerCase().includes(query)) { continue; }
      entries.set(binding.address, {
        ...binding,
        kind: 'capability',
        name,
        tags,
        effect,
      });
    }
    let sorted = [...entries.values()].sort((left, right) => left.address < right.address ? -1 : 1);
    return {
      registryId: document.id,
      generation: document.generation,
      total: sorted.length,
      offset,
      limit,
      entries: sorted.slice(offset, offset + limit),
    };
  }
}
