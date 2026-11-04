# Contributing

Use Node.js 24 or newer. From a checkout:

```sh
npm install
npm run types
npm test
node ./bin/agent-connectors.js --help
```

The package uses native ESM and JSDoc-checked JavaScript, with no runtime build phase. Keep changes focused, reuse existing helpers, and preserve the boundary that registry operations never import connector code. Add behavioral coverage for integrity, path handling, concurrency, or a concrete bug rather than tests that mirror source formatting.

Tests use isolated temporary registries and private state directories. Execution tests run controlled local connector fixtures and exercise owned-process cleanup. They do not modify your normal connection list, use real external credentials, or require a server for the default file/SQLite suite. `npm pack --dry-run` reviews package contents without publication.

For a local CLI installation, use `npm install --global <checkout-path>` or invoke `node <checkout-path>/bin/agent-connectors.js` directly. The package does not create Git repositories or commit changes.

The PostgreSQL integration suite uses the installed `initdb` and `postgres` binaries, choosing a dynamic loopback port and a temporary data directory. Run it with binaries on PATH, or set their directory explicitly:

```sh
AGENT_CONNECTORS_TEST_POSTGRES_BIN="/path/to/postgresql/bin" npm run test:postgres
```

It provisions only the temporary cluster, creates fixture login roles there, verifies row policies and concurrent updates, and closes clients/server before removing its files. No existing database connection is used. The normal Node suite and this integration suite share the same registry contract fixture.
