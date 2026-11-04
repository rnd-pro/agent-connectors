# Contributing

Use Node.js 24 or newer. From a checkout:

```sh
npm install
npm run types
npm test
node ./bin/agent-connectors.js --help
```

The package uses native ESM and JSDoc-checked JavaScript, with no runtime build phase. Keep changes focused, reuse existing helpers, and preserve the boundary that registry operations never import connector code. Add behavioral coverage for integrity, path handling, concurrency, or a concrete bug rather than tests that mirror source formatting.

Tests use isolated temporary registries and private state directories. They do not modify your normal connection list, execute connector source, or require a server. `npm pack --dry-run` reviews package contents without publication.

For a local CLI installation, use `npm install --global <checkout-path>` or invoke `node <checkout-path>/bin/agent-connectors.js` directly. The package does not create Git repositories or commit changes.
