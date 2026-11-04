import { DatabaseSync } from 'node:sqlite';
import { mkdir, open, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ensure } from '../../errors.js';
import { LIMITS } from '../../constants.js';
import { json } from '../../files.js';
import { snapshot, successor } from './snapshot.js';

export class SqliteStorage {
  /**
   * @param {string} path
   * @param {string} id
   */
  constructor(path, id) { this.path = path; this.id = id; }

  /**
   * @param {import('../../../types/contracts.js').RegistryDocument} document
   */
  async initialize(document) {
    await mkdir(dirname(this.path), {
      recursive: true,
      mode: 0o700,
    });
    let file = await open(this.path, 'wx', 0o600);
    await file.close();
    let db = this.connect(false);
    try {
      db.exec(`PRAGMA journal_mode = WAL;
        CREATE TABLE connector_registries (
          id TEXT PRIMARY KEY,
          generation INTEGER NOT NULL CHECK(generation >= 0),
          document TEXT NOT NULL CHECK(json_valid(document) AND length(CAST(document AS BLOB)) <= ${LIMITS.registryBytes}),
          digest TEXT NOT NULL,
          CHECK(json_extract(document, '$.id') = id),
          CHECK(json_extract(document, '$.generation') = generation)
        ) STRICT;`);
      let initial = snapshot(json(document));
      db.prepare('INSERT INTO connector_registries VALUES (?, ?, ?, ?)').run(this.id, document.generation, initial.text, initial.digest);
    } finally { db.close(); }
  }

  /** @param {boolean} readOnly */
  connect(readOnly) {
    let database = new DatabaseSync(this.path, {
      readOnly,
      timeout: 5000,
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
    });
    database.exec('PRAGMA trusted_schema = OFF');
    return database;
  }

  async read() {
    let stat = await lstat(this.path);
    ensure(stat.isFile() && !stat.isSymbolicLink(), 'UNSAFE_PATH', 'SQLite storage must be a regular file.');
    let db = this.connect(true);
    try {
      let row = db.prepare('SELECT generation, document, digest FROM connector_registries WHERE id = ? AND length(CAST(document AS BLOB)) <= ? AND length(digest) = 64').get(this.id, LIMITS.registryBytes);
      ensure(row && typeof row.document === 'string', 'NOT_FOUND', 'Configured registry is absent from SQLite.');
      let result = snapshot(row.document);
      ensure(result.document.id === this.id && row.generation === result.document.generation && row.digest === result.digest,
        'INTEGRITY_ERROR', 'SQLite registry metadata does not match its document.');
      return result;
    } finally { db.close(); }
  }

  /**
   * @param {import('../../../types/storage.js').RegistrySnapshot} before
   * @param {import('../../../types/contracts.js').RegistryDocument} document
   */
  async compareAndSet(before, document) {
    let next = successor(before, document);
    await this.read();
    let db = this.connect(false);
    try {
      let result = db.prepare(`UPDATE connector_registries SET generation = ?, document = ?, digest = ?
        WHERE id = ? AND generation = ? AND digest = ?`).run(document.generation, next.text, next.digest,
        this.id, before.document.generation, before.digest);
      ensure(result.changes === 1, 'CONFLICT', 'SQLite registry generation changed. Reread before retrying.');
    } finally { db.close(); }
  }
}
