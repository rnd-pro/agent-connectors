# Agent Connectors

[![npm version](https://img.shields.io/npm/v/agent-connectors)](https://www.npmjs.com/package/agent-connectors)
[![npm downloads](https://img.shields.io/npm/dm/agent-connectors)](https://www.npmjs.com/package/agent-connectors)
[![MIT license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Node.js 24 or newer](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/en/download)

> Reusable capabilities for agents and interactive tools.

Agent Connectors gives your team's Node.js scripts discoverable names, documented inputs and outputs, and explicit permission to run. Agents can find and inspect a capability without loading an entire codebase, while your team keeps its implementation and description in Git.

Use it through the CLI or connect it to interfaces such as [Symbiote AGUI](https://github.com/rnd-pro/symbiote-agui). It runs locally without a permanent backend service.

## Why use Agent Connectors?

- Turn recurring operations into reusable, documented capabilities.
- Find scripts by semantic addresses such as `crm.users.add`.
- Review and approve exact revisions before running them.
- Reuse one implementation under several addresses without copying source.
- Share capabilities through Git while keeping credentials and execution permissions private.
- Inspect retained outcomes when a request's result is uncertain.

## Get started

You need Node.js 24 or newer. Run the CLI through `npx`, without a global installation:

```sh
npx agent-connectors --help
```

Create a registry, connect it under a local name, and scaffold a capability:

```sh
npx agent-connectors registry init ./connectors
npx agent-connectors registry connect ./connectors --name team
npx agent-connectors create crm.users.add --project crm --effect write --registry team
```

The scaffold contains an ESM script, an input/output contract, and a Markdown description under `<project>/<UUID>/`. Implement the operation by editing those files; the generated stub does not perform business operations.

Discover and inspect capabilities:

```sh
npx agent-connectors list --registry team
npx agent-connectors list crm.users --registry team
npx agent-connectors describe crm.users.add --registry team
npx agent-connectors show crm.users.add --registry team
```

See the [CLI reference](./docs/cli.md) for authoring, review, and binding commands, and [local execution](./docs/execution.md) for granting access and running a capability.

## Use with your AI agent

Install the [Agent Connectors skill](./skills/agent-connectors/SKILL.md) globally for your agent with the [skills CLI](https://skills.sh/):

```sh
npx skills add rnd-pro/agent-connectors --skill agent-connectors --global
```

Omit `--global` to install only in the current project. Keep the same scope when reinstalling or updating an existing skill. Restart your agent session after installation, then ask it to discover an existing capability or create one for your task.

For example:

> Use Agent Connectors to find and inspect the capabilities in our team registry before implementing a new one.

The skill guides discovery, implementation, review, and approved execution through `npx agent-connectors`. Installing it does not grant permission to run connector scripts.

## How it works

A semantic address points to a script UUID and an exact, content-addressed revision. Names can evolve, and several addresses can refer to the same implementation without tying its identity to a directory name.

After editing a script, use `npx agent-connectors check` to inspect the candidate, `diff --from <previous-revision>` to review changes, and `prepare` to store its revision. Explicitly `bind` the address to the returned script UUID and revision when ready. Changes to code, helper files, contracts, or documentation produce a different revision; preparation never silently moves existing bindings.

Discovery and preparation inspect source as data. Only explicit execution imports connector code, and it requires a matching private grant for the exact revision, scope, and credential profile. Sharing or preparing a capability does not authorize it to run.

The local runner validates inputs and outputs, limits process lifetime and result size, and retains request outcomes. It runs trusted, reviewed code with your host account's privileges; it is not a sandbox for malicious scripts. See the [execution guide](./docs/execution.md) for these boundaries and how to handle uncertain results.

## Share through Git

Keep connector files, descriptions, and the portable registry definition in your team's repository. Registry IDs and script UUIDs preserve identity, while explicit revision bindings preserve the reviewed bytes. Concurrent registry edits fail clearly rather than overwrite another writer.

Connected folder paths, prepared snapshots, credentials, and execution grants stay in private local storage. Another machine can inspect a revision when its checkout matches the pinned bytes. If neither matching source nor a verified snapshot is available, it reports the missing revision instead of substituting current code.

## Choose registry storage

Start with ordinary JSON files, use local SQLite, or connect a shared PostgreSQL binding catalog through the same API. Storage choices do not change script handlers or transfer execution authority.

See the [storage guide](./docs/storage.md) for setup, access controls, and metadata transfer.

## Integrate with your tools

Agent Connectors is independent of AGUI and MCP. Applications can use its local library API to discover capabilities and run approved revisions without a separate backend service. Symbiote AGUI uses this API for direct connector actions from interfaces.

The project follows the [NoES Script Registry](https://rnd-pro.com/noes/#the-script-registry): semantic discovery, portable JavaScript modules, documented contracts, and explicit execution boundaries.

## Learn more

- [CLI commands and options](./docs/cli.md)
- [Registry and bundle contract](./docs/contract.md)
- [Local execution, credentials, and library integration](./docs/execution.md)
- [Registry storage and transfer](./docs/storage.md)
- [Package on npm](https://www.npmjs.com/package/agent-connectors)

## Contributing

Read the [contributing guide](./CONTRIBUTING.md) for checkout setup, validation, and local CLI usage.

## License

**MIT** &copy; [RND-PRO.com](https://rnd-pro.com/)
