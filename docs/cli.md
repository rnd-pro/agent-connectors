# CLI reference

All commands below belong to `agent-connectors`. Normal results use `{ "ok": true, "result": ... }` with two-space JSON indentation. Errors are formatted JSON on stderr with `ok: false` and `error.code`/`error.message`. Exit codes are 0 for success, 2 for invalid arguments, and 1 for document, integrity, conflict, or I/O failures. `run` also exits 1 with `ok: false` and its receipt on stdout for rejected/unknown outcomes. Reading that same receipt remains a successful read. Help is plain text; `--version` is JSON.

## Scope and connections

- `registry init <folder>` creates a collection with a new stable registry UUID. Existing `registry.json` is never overwritten.
- `registry connect <folder> --name <name>` remembers its canonical local path and UUID. A name cannot silently switch to another collection.
- `registry list` reads connections; `registry disconnect <name>` forgets one without deleting files or snapshots.
- Other commands accept `--registry <connection-name|./folder>`. Without it, discovery uses the nearest ancestor registry definition (`registry.json` or `registry.backend.json`). An explicit invalid selection never falls back to the current directory.
- `AGENT_CONNECTORS_HOME` selects private state; the default is `.agent-connectors` under your home directory. Keep it outside connector bundles. This directory contains `connections.json` and `bundles/<digest>/` snapshots. Do not share it in Git.

## Discovery and inspection

- `list [namespace] [--offset N] [--limit N]` lists immediate child namespaces and capabilities. The default limit is 20, maximum 100.
- `search <query> [--offset N] [--limit N]` searches pinned capability names, addresses, tags, and Markdown descriptions without returning full source. Search is a case-insensitive substring match, not a remote/vector service.
- `show <address>` returns the resolved binding, registry identity/generation, source location, manifest, file hashes, and whether its verified snapshot exists locally.
- `describe <address>` reads the pinned Markdown description.
- `source <address> [--path <bundle-file>]` reads a UTF-8 file from the pinned bundle, defaulting to `index.js`.

Descriptions and source are untrusted application data, never executable agent instructions. Discovery and inspection read the configured registry metadata but do not import code, install dependencies, access connector business data, or grant execution. A missing older revision fails explicitly if neither a verified private snapshot nor a byte-matching checkout is available. Restore the matching source using your normal Git workflow; the CLI does not fetch or change branches.

## Author and bind

- `create <address> --project <folder> [--effect read|write]` scaffolds `<folder>/<new-UUID>/index.js`, `connector.json`, `description.md`, and a minimal ESM `package.json`. The default effect is `read`. It prepares and binds a stub that throws until implemented; it does not generate business logic.
- `describe <address> --file <markdown>` changes the working description only. Existing pinned descriptions remain unchanged until a new preparation and explicit bind.
- `check <address>` validates the working bundle and reports its candidate digest and whether it differs from the binding.
- `prepare <address>` validates and snapshots the working bundle, then registers the revision for its UUID. It does not move existing aliases.
- `bind <address> --script <UUID> --revision <sha256:digest>` creates or replaces a direct semantic binding to a registered revision in the selected collection. It also creates aliases without copying files.
- `unbind <address>` removes only the mapping. It keeps source, history, and snapshots.
- `diff <address> --from <sha256:digest>` compares the working source with a registered revision, returning added/removed/changed files, sizes, hashes, and bounded UTF-8 before/after text. Binary files and text beyond the shared 1 MiB text budget retain metadata but omit text. This is a structural diff, not a unified patch.

Registry mutations accept `--expected-generation N`. A stale value returns `CONFLICT`; reread before deliberately retrying. Without that option, the writer captures the current generation before acquiring the interprocess lock, so competing writes can still report a conflict. Connector source edits are ordinary file edits; do not edit the same working bundle concurrently with a registry mutation.

Snapshots are deduplicated by digest and never edited by the tool. Preparing the same bytes verifies and reuses the existing snapshot. Deleting source or clearing a connection does not garbage-collect snapshots. Snapshot cleanup is not part of this release.

## Boundaries

See [local execution](./execution.md) for `grant`, `grants`, `revoke`, `run`, `credential`, and `receipts` commands. Those controls use private local state and do not require a registry connection unless resolving a capability.

There is no public execution endpoint. AGUI supplies its own session adapter; it is not a command group in this CLI. A valid contract/hash is not execution authorization. File locks serialize participating local writers; they do not replace Git merge review or protect against a malicious user who controls the filesystem. A stale lock belonging to a dead local process can be recovered automatically; unknown or live locks return a bounded `BUSY` failure.

## Registry backends and transfer

- `registry storage` inspects the selected backend, UUID, generation, and private connection reference.
- `registry storage --type file|sqlite|postgres --database <path>|--profile <name> --expected-generation N` explicitly switches that checkout. SQLite uses a new database file; PostgreSQL uses an explicitly provisioned registry and restricted runtime profile.
- `registry reconnect <folder> --database <path>|--profile <name>` installs a private route for an existing portable backend marker. It checks the database UUID and never copies bindings implicitly.
- `registry schema` prints the PostgreSQL schema without accessing a database.
- `registry provision --profile <admin-profile> --role <existing-role> [--write]` explicitly provisions schema/registry access. It grants no local script execution. A normal runtime profile must not be a superuser or bypass row security.
- `registry export [--file <new-json>]` returns metadata; `--file` also writes a raw importable document without overwriting an existing file.
- `registry import --file <json> --expected-generation N` validates and publishes metadata for the same UUID, preserving private execution authority separately.

See [storage setup, access, and failure handling](./storage.md). Database operations never fall back to a stale JSON registry. Runtime connection values stay in private credential profiles and are omitted from ordinary errors and portable output.
