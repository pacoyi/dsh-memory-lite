# dsh-memory-lite

**Lightweight cross-session memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)** — one `memory` tool (save / recall / list / forget) plus a Settings "记忆库" card, with scope isolation, approval-gated writes, and an audited, crash-safe store.

English | [中文](README.zh.md)

## Why

A dsh session starts with a blank slate: the transcript lives on disk for audit, but the model never sees it again. This plugin gives the agent a small, explicit `memory` tool so durable facts — user preferences, project decisions, key constraints — survive restarts, upgrades, and profile changes.

Design goals, in order:

- **Zero dependencies** — pure Node built-ins; only two peerDependencies (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`).
- **Human-readable store** — everything lives in `~/.dsh/memory-lite.json`. Open it, edit it, back it up, delete it. No database, no index.
- **Bounded and inspectable effects** — scoped visibility, approval-gated durable writes, per-mutation audit log, byte and count budgets on everything the model can see.

## Install

Requires the `dsh` CLI. Install into a profile (e.g. `web`):

```sh
dsh plugin --profile web add github:pacoyi/dsh-memory-lite
```

Or from a local checkout:

```sh
git clone https://github.com/pacoyi/dsh-memory-lite.git
dsh plugin --profile web add file:./dsh-memory-lite
```

Restart the profile (`dsh --profile web`) and the `memory` tool is live.

## Privacy — read this before storing anything sensitive

**The store file is local. The recalled content is not local-only.**

- The plugin itself makes **no network requests** and ships no telemetry.
- However, `recall` and `list` results are normal tool results: they enter the model-visible conversation surface, are **sent to your configured model provider** on the next model step, and are **persisted into the Session log** like any other tool output.
- Therefore: **do not store credentials, API keys, customer data, private source code, or authentication material** in this store. Treat it as content you would paste into a chat.
- Every recalled entry is labeled *untrusted evidence* in the tool output — historical data that may be stale, never a source of instructions.

## Scope and isolation

- Memory scope is derived from the **host execution context** (the agent's session working directory), never from model-authored arguments.
- `recall` / `list` / `forget` see only the current project scope plus entries explicitly saved as `global` — one project cannot read or delete another project's entries.
- The Settings card shows every scope (the human owner has the full view) and lets you choose where a manual note goes.

## Approval, idempotency, and audit

- `save` and `forget` request **host approval** (`tools/pre-execute` → ask). In the web profile this shows the standard approval card; a deployment without an approval channel denies both operations (fail closed).
- Replaying the same tool call (e.g. after a session resume) **does not duplicate** the entry — saves are deduplicated by call id.
- Every mutation appends a durable record to `~/.dsh/.memory-lite.audit.jsonl`: timestamp, operation, entry id, scope, source (`agent` or manual), outcome.
- `forget` moves entries to a **trash list** (restorable from the Settings card); permanent deletion is a separate, confirmed action.

## Storage durability

- All mutations serialize through one in-process queue **and** a cross-process lock (atomic `mkdir` + PID liveness + stale takeover), so two hosts sharing one OS home lose no writes.
- Writes are published atomically: temp file → fsync → rename, with the prior generation kept as `.memory-lite.bak` and a best-effort directory fsync.
- A corrupt store is **quarantined** (`.memory-lite.corrupt.json`) and all mutations **fail closed** — corruption never silently downgrades to an empty store and overwrites your only copy.
- Entry ids come from a persistent counter and are **never reused**.
- Budgets: notes ≤ 2000 chars, ≤ 8 tags × 32 chars, ≤ 1000 entries, ≤ 512 KB file, rendered output ≤ 16 000 chars.

## Usage

Just talk to the agent — it decides when to save and recall (and the approval card asks you first):

> "记住：这个项目用 pnpm，不要用 npm"
> "我之前跟你说过什么关于部署的事？"

The tool schema it uses:

| Param | Applies to | Description |
|---|---|---|
| `operation` | all | `save` \| `recall` \| `list` \| `forget` |
| `text` | save | The note to remember — self-contained, specific, ≤ 2000 chars |
| `tags` | save | Optional tags, e.g. `["preference", "project-x"]` |
| `query` | recall | Keyword, matched case-insensitively against text and tags |
| `tag` | recall | Match entries carrying this exact tag |
| `limit` | list/recall | Max entries to return (default 10, max 100) |
| `id` | forget | The entry id to move to trash |

## Settings UI

The web client ships a "记忆库" card in **Settings**: entries grouped by scope with source and timestamps, two-click delete confirmation, a trash view with restore / permanent-delete. Everything the card can do, editing `~/.dsh/memory-lite.json` directly can also do — but only while the host is stopped, since the plugin owns concurrent writes.

## Development

This is a "two-half" dsh plugin:

- `index.js` — the **agent half**: registers the `memory` tool, the approval gate, and the browser RPC bridge.
- `storage.js` — the storage engine: locking, atomic publish, quarantine, budgets, dedup, audit.
- `client.js` — the **web half**: lazy-loaded by the browser module loader, renders the Settings card with host-provided React.
- `cordis.patch.yml` — the bundle layer that inserts the plugin row.
- `package.json` — declares `dsh.bundle` (patch) and `dsh.client` (inject list) under the `dsh` key.

Run the contract tests (concurrency, crash safety, corruption, budgets, scope isolation — zero dependencies, `node:test`):

```sh
npm test
```

For the fastest loop, install your working copy into a profile via `file:` (as above) — edits take effect on profile restart.

## License

[MIT](LICENSE) © pacoyi
