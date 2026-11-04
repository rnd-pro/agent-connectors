# Agent Connectors

A discoverable, Git-friendly registry for reusable Node.js capabilities.

Give a script a semantic address such as `crm.users.add`, describe its input and output, and let agents discover the capability without loading an entire codebase. Several addresses can refer to the same implementation. Names can evolve without copying scripts or tying their identity to a directory name.

The registry prepares exact, content-addressed revisions for review. Changes to code, helper files, contracts, or documentation produce a different revision; preparing a change does not silently move existing bindings.

Agent Connectors requires Node.js 24 or newer. It currently supports local file registries, discovery, scaffolding, descriptions, source inspection, aliases, validation, revision preparation, and diffs. It does not yet execute scripts or connect to AGUI. Preparation is not execution approval.

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

`create` writes an ESM scaffold, contract, and Markdown description under `<project>/<UUID>/`. Implement the script by editing those ordinary files. Commands inspect source as data; they never import it.

After editing, use `check` to inspect the candidate, `diff --from <previous-revision>` to review its file changes, and `prepare` to store the revision. Explicitly `bind` the address to the returned script UUID and revision when ready. Another address can bind to that same pair without copying source.

Run `agent-connectors --help` for the command list. See the [CLI reference](./docs/cli.md) for exact options and [contract](./docs/contract.md) for registry and bundle behavior. To run directly from a source checkout, see [Contributing](./CONTRIBUTING.md).

## Share through Git

Keep `registry.json`, connector files, and descriptions in your team's repository. Registry IDs and script UUIDs preserve identity, while explicit revision bindings preserve the reviewed bytes. Concurrent registry edits fail clearly rather than overwrite another writer.

Connected folder paths and prepared snapshots stay in private local storage. Another machine can inspect a revision if its checkout matches the pinned bytes; otherwise it reports the missing revision instead of substituting current code. Sharing a collection never transfers permission to execute it.

## Architecture

Agent Connectors is independent of AGUI, MCP, and a permanent server. It follows the [NoES Script Registry](https://rnd-pro.com/noes/#the-script-registry): semantic discovery, portable JavaScript modules, documented contracts, and explicit execution boundaries.

The current package supplies the registry foundation. Runtime execution, authorization, database-backed registries, and AGUI integration are separate capabilities, not implied by a valid checksum or manifest.

## License

MIT. See [LICENSE](./LICENSE).
