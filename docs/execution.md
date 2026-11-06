# Trusted local execution

Only `run` imports connector source. It requires a prepared pinned revision, a matching private grant, and schema-valid JSON input. Source lookup and execution approval remain separate. The runner supports local trusted/team code; it runs with the host user's privileges and is not a malicious-code sandbox.

## Grant and run

Review a capability with `show`, `describe`, `source`, and `diff`. Prepare the exact desired bytes and explicitly bind its address before granting. For example, using placeholders returned by those commands:

```sh
agent-connectors grant example.records.read --registry team \
  --scope workspace-demo --revision <sha256:digest> --effect read
agent-connectors run example.records.read --registry team \
  --scope workspace-demo --request <request-UUID> --file input.json
```

- `grant <address> --scope <scope> --revision <digest> --effect read|write` records exact local authority. Optional `--source cli|agent|agui` defaults to `cli`; `--profile <name>` supplies credentials; `--timeout <milliseconds>` and `--result-bytes <bytes>` may reduce the manifest's limits, never increase them.
- A grant binds the registry UUID and canonical local folder, scope, script UUID/digest/effect, invocation source, credential profile revision, and limits. An alias to that same script/revision can reuse it. Another scope, source, collection, or changed revision cannot.
- `grants` lists local grant metadata. `revoke <grant-UUID>` prevents new executions and requests cancellation of active calls on their next access check. It cannot reverse an external operation already performed.
- Regranting the same registry/scope/script/revision/source replaces its local grant record. Active calls using the replaced grant are cancelled. Avoid regranting merely to repeat an already authorized operation.
- Private storage holds at most 128 grants and 32 credential profiles. Issuing a grant prunes revoked records; revoke obsolete grants before adding new ones at capacity. Receipts retain their grant identity independently.
- `run` always uses source `cli`. The trusted library caller supplies other sources; a future server adapter must derive them from authenticated transport rather than accept browser claims.
- Input is read from `--file` or stdin, at most 64 KiB. Scope uses 1-128 ASCII letters, digits, dots, underscores, colons, slashes, or hyphens and starts with a letter/digit. Request IDs must be lowercase canonical UUIDs. Use one stable ID for one immutable operation; inspect its receipt after uncertain delivery.

Failures before execution throw structured errors such as `ACCESS_DENIED`, `NOT_PREPARED`, `INPUT_INVALID`, or `REQUEST_CONFLICT`. A matching repeated request returns its retained result or running/unknown state without executing again. It may require `receipts get` after access was revoked or source became unavailable.

## Handler and domain verification

Handlers export `async execute(input, context)`. Read handlers return JSON-compatible data matching the output schema. Write handlers return `context.verified(value)` only after checking the actual domain result, for example by readback or a destination transaction guarantee. This wrapper records the script author's assertion of verification; the framework cannot independently prove the external operation succeeded.

```js
export async function execute(input, context) {
  let result = await performAuthorizedOperation(input, context);
  let confirmed = await verifyActualResult(result, context);
  return confirmed ? context.verified(result) : context.unknown();
}
```

The helper names above stand for application-owned business logic. Scripts remain responsible for domain validation, resource authorization, transactions, and reconciliation.

Context supplies:

- `requestId` and the same value as `idempotencyKey`, which a script can forward to an upstream idempotency facility.
- Captured scope/source, only declared credential keys, and an `AbortSignal` for cooperative cancellation.
- `verified(value)`, `unknown()`, and `log(jsonValue)`. Log output is bounded and exact configured credential strings are redacted before retention.

Only Node built-ins and ESM JavaScript/JSON files resolving inside the prepared bundle are supported by the normal module resolver. Bare third-party packages, remote/data URLs, external file imports, and native addons are rejected. Invocation installs nothing and runs no package hooks. Built-ins still provide host filesystem, network, and process access to trusted code. Access declarations and module hooks are not an OS sandbox or a guarantee against deliberate evasion.

Input/output use synchronous JSON Schema 2020-12 validation without coercion, defaults, remote reference loading, or `format` enforcement. Non-JSON/oversized results, invalid output, unverified writes, thrown errors, crashes, cancellation, and timeouts after code may have run are recorded as `unknown`, not evidence of rollback. A configured credential found literally in serialized result data is rejected with `CREDENTIAL_LEAK`; this is an accidental-leak guard, not comprehensive data-loss prevention.

## Credentials

- `credential set <name> [--file <secrets.json>]` stores a JSON object mapping reference names to nonempty secret strings. Without a file, read JSON from stdin. Do not pass secrets in command arguments, descriptions, source files, or Git.
- `credential list` returns names, revisions, and key names, never values. `credential remove <name>` removes a profile and invalidates grants depending on it.
- Grants pin a profile's revision. Changing credential values requires an explicit review/regrant. The child receives only the keys named by `connector.json`, not the entire profile or parent environment.
- Private `authority.json` uses owner-only file permissions beneath the private state directory. Values are stored locally without encryption; protect the host account and disk accordingly. Raw input and credential values are not stored in receipts. Logs use exact-string redaction, so scripts must still avoid logging encoded or transformed secrets.

## Processes, limits, and cancellation

The runner uses a fixed Node executable and entry point, no shell interpolation, and an environment excluding arbitrary parent credentials, `NODE_OPTIONS`, `NODE_PATH`, and preload flags. Standard Windows runtime/temp and locale settings can be retained. Credential/input JSON is sent through stdin, while structured results use a separate IPC channel.

A supervisor never imports connector code. It stays responsive while a worker is blocked, retains an independent deadline watchdog, and terminates the owned POSIX process group when its caller disconnects. Windows uses the native process-tree termination command. The manifest/grant deadline covers process startup and execution. Cancellation signals the script and then terminates owned processes, escalating after 250 ms. Output is limited to 16 KiB combined stdout/stderr, results to at most 1 MiB, and old-space heap to 128 MiB per Node child. Four calls can run concurrently per private state directory. These are operational limits, not complete OS resource isolation. Windows behavior requires platform verification.

Revocation is checked before importing source and periodically during execution. External effects may occur between a revocation and cancellation; the receipt remains uncertain. A detached daemon or deliberately escaped process requires stronger isolation than this trusted-code runner provides.

## Durable outcomes

- `receipts list` returns request metadata and states. `receipts get <request-UUID>` returns the retained outcome, result, and bounded redacted logs when present. Receipt commands use private state and need no registry selection.
- States are `running`, `completed`, `rejected`, or `unknown`. `run` exits 1 for rejected/unknown outcomes while retaining its JSON receipt; reading such a receipt is a successful status operation.
- Receipts capture registry/scope/source/script/revision/grant identity and a digest of captured input, never raw input or credentials. Reusing an ID for changed input, authority, or revision fails with `REQUEST_CONFLICT`.
- A durable claim is published before starting code. Interrupted/dead-owner or expired running records become unknown. The runner never automatically retries a possibly started operation. Reconcile with the actual destination; local receipts do not provide cross-system exactly-once writes.
- Receipt capacity is 128 per private state directory, with bounded result files. New requests fail with `RECEIPTS_FULL` at capacity instead of silently evicting duplicate protection. Running calls cannot be forgotten.
- After reconciliation, `receipts forget <request-UUID> --acknowledge` explicitly removes a terminal record/result. That ID must not be reused; forgetting removes its duplicate protection. Keep a domain ledger if long-term deduplication is required.
- Index/result publication is fail-closed. If interruption leaves an inconsistent or missing terminal result, inspection reports uncertainty/integrity failure; it never reruns the script to reconstruct a result. File locks support participating local writers on a local filesystem, not distributed locking.

## Library integration

Use `runCapability(registry, address, input, { scope, requestId, source?, signal? })`. It returns a typed `ReceiptView`; caller cancellation does not imply domain rollback. The library also exports grant/revocation, credential-profile, and receipt functions. API declarations and shared contract/storage types are available from the `agent-connectors` entry point in TypeScript and JSDoc:

```ts
import { FileRegistry, runCapability } from 'agent-connectors';
import type { ExecutionRequest, GrantOptions, ReceiptView, StorageTarget } from 'agent-connectors';
```

JavaScript callers can use `import('agent-connectors').ExecutionRequest` in JSDoc. Node.js typings are needed for Node APIs; PostgreSQL typings belong to this package's development tooling and are unnecessary for consumers. Private storage contracts use the authority, receipt-index, and execution-result JSON Schemas.

Private authority and receipts remain outside connector collections and snapshots. Git sharing, source aliases, and preparation cannot grant execution. AGUI's session/transport adapter and public execution policies are separate integration stages.
