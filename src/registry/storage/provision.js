import { readFile } from 'node:fs/promises';
import { PostgresStorage } from './postgres.js';
import { snapshot } from './snapshot.js';
import { json } from '../../files.js';
import { ensure } from '../../errors.js';

/**
 * Explicit administrative operation. It never runs from discovery or connection.
 * @param {import('../../../types/contracts.js').RegistryDocument} document
 * @param {string} profile
 * @param {string} role
 * @param {boolean} write
 * @param {string} stateRoot
 */
export async function provisionPostgres(document, profile, role, write, stateRoot) {
  ensure(typeof write === 'boolean', 'INVALID_INPUT', 'Provisioning access must explicitly be read-only or writable.');
  ensure(/^[a-z][a-z0-9_]{0,62}$/.test(role), 'INVALID_INPUT', 'Use an existing lowercase database role name.');
  let initial = snapshot(json(document));
  let storage = new PostgresStorage(profile, document.id, stateRoot);
  return storage.withClient(async (client) => {
    await client.query('BEGIN');
    try {
      // Provisioners serialize first schema creation without a race on DDL.
      await client.query('SELECT pg_advisory_xact_lock(1871222401)');
      let existing = (await client.query("SELECT to_regclass('agent_connectors.schema_version') AS table_name")).rows[0];
      if (!existing.table_name) { await client.query(await readFile(new URL('../../../schemas/postgres-registry.sql', import.meta.url), 'utf8')); }
      let version = (await client.query('SELECT version FROM agent_connectors.schema_version')).rows[0]?.version;
      ensure(version === 1, 'UNSUPPORTED_SCHEMA', 'This registry database schema is unsupported.');
      let target = (await client.query('SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1', [
        role,
      ])).rows[0];
      ensure(target?.rolcanlogin && !target.rolsuper && !target.rolbypassrls, 'ACCESS_DENIED', 'Provision an existing restricted LOGIN role.');
      await client.query(`INSERT INTO agent_connectors.registries (id, generation, document, digest)
        VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`, [
        document.id,
        document.generation,
        initial.text,
        initial.digest,
      ]);
      // Role names are allowlisted above; identifiers cannot be SQL parameters.
      await client.query(`GRANT USAGE ON SCHEMA agent_connectors TO "${role}"`);
      await client.query(`GRANT SELECT ON agent_connectors.schema_version, agent_connectors.registries, agent_connectors.registry_access TO "${role}"`);
      if (write) { await client.query(`GRANT UPDATE ON agent_connectors.registries TO "${role}"`); }
      await client.query(`INSERT INTO agent_connectors.registry_access VALUES ($1, $2, $3)
        ON CONFLICT (registry_id, role_name) DO UPDATE SET can_write = EXCLUDED.can_write`, [
        document.id,
        role,
        write,
      ]);
      await client.query('COMMIT');
      return {
        registryId: document.id,
        role,
        write,
        schemaVersion: 1,
      };
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  }, true);
}
