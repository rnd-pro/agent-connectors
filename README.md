# Agent Connectors

A discoverable, Git-friendly registry and local runner for reusable Node.js capabilities.

Give a script a semantic address such as `crm.users.add`, describe its input and output, and let agents discover the capability without loading an entire codebase. Several addresses can refer to the same implementation. Names can evolve without copying scripts or tying their identity to a directory name.

The registry prepares exact, content-addressed revisions for review. Changes to code, helper files, contracts, or documentation produce a different revision; preparing a change does not silently move existing bindings.

Agent Connectors requires Node.js 24 or newer. Discover, scaffold, inspect, prepare, and explicitly run trusted local connectors through the CLI or library. Private grants control which exact revisions may run, in which scope, and with which credential profile. Preparation is separate from execution approval. Interfaces such as Symbiote AGUI can consume the same local API without running a separate backend service.

## Basic workflow

With the `agent-connectors` executable on your PATH:

```sh
agent-connectors registry init ./connectors
agent-connectors registry connect ./connectors --name team
agent-connectors create crm.users.add --project crm --effect write --registry team
agent-connectors list --registry team
agent-connectors list crm.users --registry team
agent-connectors describe crm.users.add --registry team
agent-connectors show crm.users.add --registry team
```

`create` writes an ESM scaffold, contract, and Markdown description under `<project>/<UUID>/`. Implement the script by editing those ordinary files. Discovery and preparation inspect source as data; only explicit execution imports it.

After editing, use `check` to inspect the candidate, `diff --from <previous-revision>` to review its file changes, and `prepare` to store the revision. Explicitly `bind` the address to the returned script UUID and revision when ready. Another address can bind to that same pair without copying source.

Run `agent-connectors --help` for the command list. See the [CLI reference](./docs/cli.md) for exact options, [contract](./docs/contract.md) for registry/bundle behavior, and [local execution](./docs/execution.md) for grants, credential profiles, and retained request outcomes. To run directly from a source checkout, see [Contributing](./CONTRIBUTING.md).

## Share through Git

Keep connector files, descriptions, and the portable registry definition in your team's repository. Registry IDs and script UUIDs preserve identity, while explicit revision bindings preserve the reviewed bytes. Concurrent registry edits fail clearly rather than overwrite another writer.

Connected folder paths and prepared snapshots stay in private local storage. Another machine can inspect a revision if its checkout matches the pinned bytes; otherwise it reports the missing revision instead of substituting current code. Sharing a collection never transfers permission to execute it.

## Architecture

Agent Connectors is independent of AGUI, MCP, and a permanent server. It follows the [NoES Script Registry](https://rnd-pro.com/noes/#the-script-registry): semantic discovery, portable JavaScript modules, documented contracts, and explicit execution boundaries.

The local runner uses exact grants, a minimal child environment, schema validation, bounded processes, and durable request receipts. It executes trusted reviewed code with the host user's privileges; it is not a sandbox for malicious scripts. Choose ordinary JSON, local SQLite, or a shared PostgreSQL binding catalog through the same API. See [registry storage](./docs/storage.md) for explicit backend setup and metadata transfer. These choices do not change script handlers or transfer execution authority.

## License

MIT. See [LICENSE](./LICENSE).
