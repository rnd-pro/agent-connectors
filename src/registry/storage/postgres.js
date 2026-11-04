import pg from 'pg';
import { readAuthority } from '../../execution/authority.js';
import { ConnectorError, ensure } from '../../errors.js';
import { snapshot, successor } from './snapshot.js';

export class PostgresStorage {
  /**
   * @param {string} profile
   * @param {string} id
   * @param {string} stateRoot
   */
  constructor(profile, id, stateRoot) { this.profile = profile; this.id = id; this.stateRoot = stateRoot; }

  /**
   * @template T
   * @param {(client: pg.Client) => Promise<T>} task
   * @param {boolean} [administrative]
   */
  async withClient(task, administrative = false) {
    let profile = (await readAuthority(this.stateRoot)).profiles.find((entry) => entry.name === this.profile);
    let connectionString = profile?.values.DATABASE_URL;
    ensure(connectionString && /^postgres(?:ql)?:\/\//.test(connectionString), 'CREDENTIALS_MISSING', 'A private DATABASE_URL profile is required.');
    /** @type {pg.Client | undefined} */
    let client;
    try {
      let endpoint = new URL(connectionString);
      ensure(endpoint.hostname && endpoint.username && endpoint.pathname.length > 1, 'CREDENTIALS_MISSING', 'DATABASE_URL must explicitly select host, user, and database.');
      client = new pg.Client({
        connectionString,
        connectionTimeoutMillis: 5000,
        query_timeout: 5000,
        statement_timeout: 5000,
        application_name: 'agent-connectors',
      });
      client.on('error', () => {});
      await client.connect();
      let role = (await client.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user')).rows[0];
      ensure(administrative || role && !role.rolsuper && !role.rolbypassrls,
        'ACCESS_DENIED', 'Registry runtime connections must use a non-superuser role without BYPASSRLS.');
      if (!administrative) {
        let version = (await client.query('SELECT version FROM agent_connectors.schema_version')).rows[0]?.version;
        ensure(version === 1, 'UNSUPPORTED_SCHEMA', 'Registry database schema version is unsupported.');
      }
      return await task(client);
    } catch (error) {
      if (error instanceof ConnectorError) { throw error; }
      let code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      throw new ConnectorError(code === '42501' ? 'ACCESS_DENIED' : 'REGISTRY_UNAVAILABLE',
        'The configured PostgreSQL registry is unavailable or denied. Inspect its private connection settings.');
    } finally { await client?.end().catch(() => {}); }
  }

  /**
   * @param {string} sql
   * @param {unknown[]} values
   */
  query(sql, values) { return this.withClient((client) => client.query(sql, values)); }

  async read() {
    let result = await this.query(`SELECT generation, document, digest FROM agent_connectors.registries WHERE id = $1`, [
      this.id,
    ]);
    let row = result.rows[0];
    ensure(row && typeof row.document === 'string', 'NOT_FOUND', 'Registry is absent or not visible to this database role.');
    let value = snapshot(row.document);
    ensure(value.document.id === this.id && String(value.document.generation) === String(row.generation) && value.digest === row.digest,
      'INTEGRITY_ERROR', 'PostgreSQL registry metadata does not match its document.');
    return value;
  }

  /**
   * @param {import('../../../types/storage.js').RegistrySnapshot} before
   * @param {import('../../../types/contracts.js').RegistryDocument} document
   */
  async compareAndSet(before, document) {
    let next = successor(before, document);
    let result = await this.query(`UPDATE agent_connectors.registries SET generation = $1, document = $2, digest = $3
      WHERE id = $4 AND generation = $5 AND digest = $6 RETURNING id`, [
      document.generation,
      next.text,
      next.digest,
      this.id,
      before.document.generation,
      before.digest,
    ]);
    ensure(result.rowCount === 1, 'CONFLICT', 'PostgreSQL registry changed or this role cannot publish it.');
  }
}
