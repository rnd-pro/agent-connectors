# Registry contract v1

## Documents and identity

The authoritative machine-readable documents are [connector.schema.json](../schemas/connector.schema.json), [registry.schema.json](../schemas/registry.schema.json), and [connections.schema.json](../schemas/connections.schema.json). Shared JavaScript-facing types are in `types/contracts.d.ts`.

`registry.json` has `formatVersion: 1`, a stable UUID `id`, integer `generation`, a `scripts` array, and a `bindings` array. A script has `id`, a `<project>/<UUID>` relative `path`, and registered digest strings in `revisions`. A binding contains `address`, `scriptId`, and `revision`. Arrays allow duplicate semantic addresses and UUIDs to be detected and rejected; aliases never reference other aliases. The source registry identity remains separate from a local connection name.

Semantic addresses use lowercase segments matching `[a-z][a-z0-9_-]*`, separated by dots, at most 256 characters. Project names use one such segment, at most 64 characters. UUIDs use lowercase canonical hexadecimal text. Digests are `sha256:` followed by 64 lowercase hexadecimal characters.

`connector.json` has `contractVersion: 1`, its UUID, name, tags, `entry: "index.js"`, read/write effect, input/output schemas, credential-reference names, network/file access declarations, and timeout/result-size limits. Those declarations describe requirements; they do not grant access or enforce isolation. The handler is an ESM `execute(input, context)` export returning JSON data for reads and `context.verified(value)` after domain verification for writes. Discovery/preparation never import a handler; only explicit execution does. See the [execution contract](./execution.md).

Input/output contracts use JSON Schema 2020-12 and AJV strict synchronous compilation; async schemas are rejected. `$schema`, when supplied, must name that dialect. References must resolve inside the same schema document; no external retrieval or custom code keywords are supported. `format` is annotation-only in this release (`validateFormats: false`), so do not rely on it as validation; use explicit constraints or domain validation. Neither schema validation nor discovery executes connector source.

## Deterministic bundles

A bundle contains `index.js`, `connector.json`, nonempty UTF-8 `description.md`, and all other regular files under the script directory. A scaffold includes `package.json` with `type: "module"` and `private: true` to define ESM independently of the parent checkout. The only ignored entry name is `.git` at any depth; other unsupported entries cause an error rather than silently disappearing from the digest.

Portable path segments start with an ASCII letter, digit, or underscore and continue with ASCII letters, digits, underscore, dot, or hyphen. Reject Windows device names, trailing dots, symlinks, hard-linked files, special files, escaping/absolute paths, and case-colliding paths. Empty directories do not affect a revision. Limits: 512 files, 1,024 visited file/directory entries, 32 path segments, 512 path characters, 1 MiB per file, 64 KiB description, and 16 MiB combined file bytes. Registry and connection documents are at most 4 MiB.

For every file, produce an object with properties in this exact order: `path` (slash-separated relative string), `size` (byte count), `sha256` (lowercase hexadecimal SHA-256 of exact bytes). Sort the objects by ascending ASCII path order. Compute the revision as:

```text
sha256:<hex SHA-256 of UTF-8 JSON.stringify([
  "agent-connectors-bundle-v1",
  sortedFileObjects
]) with no indentation or trailing newline>
```

Line endings, final newlines, JSON formatting, and description changes affect the revision. Filesystem timestamps, permissions, absolute locations, directory enumeration order, and local connection names do not. Helper files are included even if unused by the entry point. File reading is bounded and rejects identity or stat changes observed during a read; concurrent source edits are not a multi-file transaction. The prepared snapshot captures exactly the bytes that were hashed.

Preparation writes a private temporary directory from captured bytes, revalidates its digest, and publishes it under the content digest. Existing snapshots are verified and reused, never replaced in normal operation. Every snapshot read verifies its digest and UUID; corruption fails instead of falling back to mutable working files. Snapshot integrity is tamper detection, not protection against a malicious local filesystem owner.

## Publication and concurrency

An owner-marked interprocess directory lock serializes registry changes. Writers compare the expected generation, validate the resulting document, write and flush a temporary file, then atomically replace `registry.json`. A no-overwrite publication initializes a registry. These operations target local filesystems; distributed/network-filesystem locking is not supported.

Preparation may leave an unreferenced private snapshot if registry publication fails. It must never move an existing semantic binding implicitly. A source scaffold that was never published is cleaned up when possible; interrupted authoring may leave an unregistered UUID directory requiring inspection. Working descriptions are ordinary source edits, so a failed registry publication after a description edit can leave that edit present; inspect before retrying. No command claims rollback of arbitrary source edits or filesystem failures.

## Library

The package exports `FileRegistry`, `initializeRegistry`, `readRegistry`, bundle/snapshot helpers, connection helpers, constants, and `ConnectorError`. Open a registry with `FileRegistry.open(collectionPath, privateStatePath)`. Its methods mirror the CLI: `list`, `search`, `show`, `describe`, `source`, `create`, `check`, `prepare`, `bind`, `unbind`, and `diff`.

Mutation results return `{ generation, result }`; read operations return structured results directly. `describe(address)` reads pinned text; `describe(address, replacement, expectedGeneration?)` edits the working description. The registry adapter accepts/returns JSON-compatible document models; binary source bytes remain in the local bundle layer. Future database adapters must preserve identities, generation conflicts, immutable revision references, and the separation of shared bindings from private execution authority.
