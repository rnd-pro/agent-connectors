import { join } from 'node:path';
import { LIMITS } from '../../constants.js';
import { atomicText, readBytes, utf8 } from '../../files.js';
import { withLock } from '../../lock.js';
import { ensure } from '../../errors.js';
import { snapshot, successor } from './snapshot.js';

export class FileStorage {
  /** @param {string} root */
  constructor(root) { this.root = root; }

  async read() { return snapshot(utf8(await readBytes(join(this.root, 'registry.json'), LIMITS.registryBytes))); }

  /**
   * @param {import('../../../types/storage.js').RegistrySnapshot} before
   * @param {import('../../../types/contracts.js').RegistryDocument} document
   */
  async compareAndSet(before, document) {
    let next = successor(before, document);
    await withLock(join(this.root, '.registry-store-lock'), async () => {
      ensure((await this.read()).digest === before.digest, 'CONFLICT', 'Registry changed outside the writer lock.');
      await atomicText(join(this.root, 'registry.json'), next.text);
    });
  }
}
