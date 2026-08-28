# dsh-memory-lite

**Lightweight cross-session memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)** — one `memory` tool (save / recall / list / forget) plus a Settings "记忆库" card, persisted to a single human-readable JSON file.

English | [中文](README.zh.md)

## Why

A dsh session starts with a blank slate: the transcript lives on disk for audit, but the model never sees it again. This plugin gives the agent a small, explicit `memory` tool so durable facts — user preferences, project decisions, key constraints — survive restarts, upgrades, and profile changes.

Design goals, in order:

- **Zero dependencies** — pure Node built-ins; only two peerDependencies (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`).
- **Human-readable store** — everything lives in `~/.dsh/memory-lite.json`. Open it, edit it, back it up, delete it. No database, no index.
- **One tool, four operations** — no mode flags, no configuration surface to learn.

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

## Usage

Just talk to the agent — it decides when to save and recall:

> "记住：这个项目用 pnpm，不要用 npm"
> "我之前跟你说过什么关于部署的事？"

The tool schema it uses:

| Param | Applies to | Description |
|---|---|---|
| `operation` | all | `save` \| `recall` \| `list` \| `forget` |
| `note` | save | The text to remember — self-contained and specific |
| `tags` | save | Optional tags, e.g. `["preference", "project-x"]` |
| `query` | recall | Keyword, matched case-insensitively against text and tags |
| `tag` | recall | Match entries carrying this exact tag |
| `limit` | list/recall | Max entries to return (default 10, max 100) |
| `id` | forget | The entry id to delete |

## Settings UI

The web client ships a "记忆库" card in **Settings**: browse recent entries with timestamps and tags, delete any entry with one click. Everything you can do from the card you can also do by editing `~/.dsh/memory-lite.json` directly.

## Data & Privacy

- Store location: `~/.dsh/memory-lite.json` (created on first save)
- Nothing leaves your machine. No telemetry, no network calls.
- Uninstall the plugin or delete the file — that removes everything.

## Development

This is a "two-half" dsh plugin:

- `index.js` — the **agent half**: registers the `memory` tool on the Node side.
- `client.js` — the **web half**: lazy-loaded by the browser module loader, renders the Settings card with host-provided React.
- `cordis.patch.yml` — the bundle layer that inserts the plugin row.
- `package.json` — declares `dsh.bundle` (patch) and `dsh.client` (inject list) under the `dsh` key.

For the fastest loop, install your working copy into a profile via `file:` (as above) — edits to `index.js` take effect on profile restart.

## License

[MIT](LICENSE) © pacoyi
