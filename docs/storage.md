# Registry storage

The registry API supports file, SQLite, and PostgreSQL metadata stores. Connector source remains in the configured local checkout; reviewed snapshots, credential profiles, execution grants, and receipts remain in private local state. Changing the metadata backend does not change handlers or authorize code.

A registry UUID is the database access namespace. Use separate registries for different access boundaries; semantic address prefixes inside one registry do not have independent ACLs. Each backend stores the same bounded registry document (at most 4 MiB), with direct UUID/revision bindings and optimistic generation checks. Discovery retains the file adapter's bounded pagination and local snapshot/source inspection rather than introducing a database search index.

## SQLite

Node.js 24 or newer provides the SQLite API; no external SQLite package or server is needed. Start with an ordinary registry, inspect its generation, and explicitly switch it:

```sh
agent-connectors registry storage --registry ./connectors
agent-connectors registry storage --registry ./connectors --type sqlite --database ./catalog.sqlite --expected-generation 3
```

Use the generation actually returned by your registry, replacing the example number. The database path must be new. Existing files are never overwritten. SQLite uses a single-statement conditional update, WAL mode, bounded lock waits, and disabled extension loading. It is for local filesystems; do not place its database on a network share.

The switch writes an exact private metadata backup, creates `registry.backend.json` in the collection, and removes the old `registry.json`. The marker contains only version, backend type, and registry UUID. The database path lives privately in `AGENT_CONNECTORS_HOME/registry-stores/`. Sharing the marker does not share that path or any execution grant.

A new checkout or machine must explicitly connect its own database copy:

```sh
agent-connectors registry reconnect ./connectors --database ./catalog.sqlite
agent-connectors registry connect ./connectors --name team
```

Reconnect verifies the marker and database UUID without importing metadata. A missing connection, unavailable database, mismatched UUID, or corrupt document fails. There is no fallback to an old JSON file or automatic recreation of a missing database.

## PostgreSQL

Use PostgreSQL when a team needs one shared binding catalog. The same source checkout and private revision preparation are still required on every execution host. Database rows contain references and metadata, not executable modules, grants, or script credentials.

Create a dedicated database and restricted LOGIN role through your normal database administration workflow. The runtime role must not be a superuser or have BYPASSRLS. It needs no role-creation, database-creation, or schema-owner privileges. Use a separate operator profile for provisioning and a runtime profile for regular access.

Store the connection strings as private credential profiles using `credential set <name> --file <private-json>`. Each JSON value is an object with `DATABASE_URL`, explicitly selecting host, user, and database. Configure TLS for a remote endpoint, such as `sslmode=verify-full`; the driver retains certificate verification. Connection strings never enter the portable marker, registry exports, or browser state.

```sh
agent-connectors registry schema
agent-connectors registry provision --registry ./connectors --profile registry_admin --role registry_app --write
agent-connectors registry storage --registry ./connectors --type postgres --profile registry_runtime --expected-generation 3
```

`schema` prints the exact packaged SQL for review. `provision` is an explicit administrative operation: it installs the schema if absent, seeds this registry UUID without overwriting an existing row, and assigns the existing role access. `--write` permits metadata updates; omitting it provisions read-only access. Read-only database access can resolve capabilities for local execution, but grants and preparation are still required separately. Provisioning never creates login roles or passwords and never runs connector source.

The schema enables and forces row-level security. Membership uses the authenticated database role (`current_user`), not caller-supplied tenant settings. Runtime roles can select only their assigned registry rows, and update only rows assigned with `can_write`. They cannot insert/delete registry rows or edit access assignments. Administrative credentials are rejected for normal registry operations. Metadata publication checks the expected generation and document digest in one conditional update. Timeouts and connection failures are bounded and do not select another backend.

Another checkout connects to the shared catalog explicitly:

```sh
agent-connectors registry reconnect ./connectors --profile registry_runtime
```

Sources must match the referenced UUID/digest, or a verified local snapshot must exist. A remotely changed binding cannot approve a new executable revision. Private grants still bind the canonical local source folder, exact script UUID/digest, invocation source, and scope.

## Import, export, and switching

Export/import transfer registry metadata only. Keep connector source in Git and use separate preparation/grant workflows on each machine.

```sh
agent-connectors registry export --registry team --file ./catalog-export.json
agent-connectors registry import --registry team --file ./catalog-export.json --expected-generation 5
```

`--file` writes a raw importable document to a new file; stdout retains the usual CLI result envelope. Import requires the same registry UUID and an explicit current destination generation, validates paths and the shared schema, and atomically publishes the imported script/binding references with the next destination generation. It cannot import profiles, snapshots, execution grants, or receipts. Missing source revisions remain unavailable rather than being fetched or run automatically.

To switch a connected checkout back to files:

```sh
agent-connectors registry storage --registry team --type file --expected-generation 6
```

The switch creates a new `registry.json` from the current catalog, then removes its marker and private connection. An unexpected existing JSON file is not overwritten. SQLite-to-PostgreSQL and PostgreSQL-to-SQLite switches use the same explicit command; a populated PostgreSQL destination must already match the source, otherwise reconcile it through an explicit generation-checked import first.

A switch changes this checkout's configured authority, not every teammate's connection. Coordinate team-wide migrations and retain/export the shared catalog deliberately. There is no background bidirectional sync. Filesystem configuration and a database cannot commit as one distributed transaction: an interrupted switch can leave an unused target or a private backup. Inspect the marker and `registry storage` result; repair a missing private route with `reconnect`. Never infer a successful migration from an orphan database file or retry an uncertain mutation blindly.

## Library and validation

`FileRegistry.open(root, stateRoot)` selects the declared backend through the same API. `configureStorage`, `reconnectStorage`, `storageStatus`, `importRegistry`, and `provisionPostgres` are exported for explicit host-side administration. Regular registry changes continue through the existing methods. The storage contract is `read()` plus conditional `compareAndSet(before, next)`; every implementation validates document identity, bounds, and successor generation. The artifact cache and runner are independent of the adapter.

SQLite and files run the shared contract tests through `npm test`. PostgreSQL tests reuse that contract and launch an isolated temporary cluster with real roles, forced row policies, read-only denial, and concurrent publication. See [Contributing](../CONTRIBUTING.md) for the server-binary setup. See the [Node SQLite API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html), [node-postgres client](https://node-postgres.com/apis/client), and [PostgreSQL row policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) for platform details.
