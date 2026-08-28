/**
 * dsh-memory-lite storage engine — every durability, concurrency, and
 * integrity contract lives here.
 *
 * Store format (v2, human-readable JSON):
 *   { version, rev, next_id, entries: [], trash: [], dedup: {} }
 * Entry shape: { id, scope, text, tags, source, trust, created_at, updated_at }
 *
 * Guarantees (see README "Storage durability"):
 * - all mutations serialize through one in-process queue AND a cross-process
 *   mkdir lock with PID liveness + stale takeover, bounded wait;
 * - writes go temp -> fsync -> atomic rename, with a prior generation kept
 *   as .bak and a best-effort directory fsync;
 * - missing / corrupt / unsupported-version stores are distinct states:
 *   corruption is quarantined (evidence copy) and ALL mutations fail closed;
 * - ids come from a persistent next_id counter and are never reused;
 * - note / tag / entry-count / file-byte budgets are enforced before write;
 * - every mutation appends one durable JSONL audit record;
 * - same rootCallId saves deduplicate through a bounded FIFO window.
 */

import { mkdir, readFile, writeFile, rename, stat, open, rm, copyFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export const STORE_VERSION = 2
export const GLOBAL_SCOPE = 'global'

export const LIMITS = {
  noteChars: 2000,       // max characters per note
  maxTags: 8,            // max tags per entry
  tagChars: 32,          // max characters per tag
  maxEntries: 1000,      // max live entries before save is rejected
  maxFileBytes: 512 * 1024, // max serialized store size
  renderChars: 16000,    // max characters of rendered tool output
  dedupWindow: 64,       // rootCallIds remembered for dedup
  trashEntries: 500,     // max trash entries (oldest evicted)
}

const LOCK_WAIT_MS = 15_000
const LOCK_STALE_MS = 10_000

// ---------------------------------------------------------------------------
// paths — MEMORY_LITE_STORE overrides the store location (used by tests and
// users who want a per-project store file)
// ---------------------------------------------------------------------------

export function paths() {
  const store = process.env.MEMORY_LITE_STORE ?? join(homedir(), '.dsh', 'memory-lite.json')
  const base = basename(store)
  const dir = dirname(store)
  return {
    store,
    dir,
    lockDir: join(dir, `.${base}.lock`),
    ownerFile: join(dir, `.${base}.lock`, 'owner'),
    tmp: join(dir, `.${base}.tmp`),
    bak: join(dir, `.${base}.bak`),
    audit: join(dir, `.${base}.audit.jsonl`),
    quarantine: join(dir, `.${base}.corrupt.json`),
  }
}

// ---------------------------------------------------------------------------
// errors — distinct states a load can end in
// ---------------------------------------------------------------------------

export class StoreCorruptError extends Error {
  constructor(quarantinePath) {
    super(`memory store is corrupt; a copy was quarantined at ${quarantinePath}. ` +
      'Mutations are refused. Fix or remove the store file, or restore from the quarantine copy.')
    this.code = 'STORE_CORRUPT'
    this.quarantinePath = quarantinePath
  }
}

export class StoreUnsupportedError extends Error {
  constructor(version) {
    super(`memory store version ${version} is newer than this plugin supports (${STORE_VERSION}); upgrade the plugin`)
    this.code = 'STORE_UNSUPPORTED'
  }
}

// ---------------------------------------------------------------------------
// cross-process lock — atomic mkdir + PID liveness + stale takeover
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

async function acquireLock() {
  const p = paths()
  await mkdir(p.dir, { recursive: true })
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      await mkdir(p.lockDir)
      await writeFile(p.ownerFile, JSON.stringify({ pid: process.pid, ts: Date.now() }), 'utf8')
      return async () => { await rm(p.lockDir, { recursive: true, force: true }) }
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
    }
    // Lock exists: take it over only when it is stale AND its owner is dead.
    try {
      const st = await stat(p.lockDir)
      if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
        let ownerPid = null
        try { ownerPid = JSON.parse(await readFile(p.ownerFile, 'utf8')).pid } catch { /* unreadable owner — treat as dead */ }
        if (ownerPid === null || !pidAlive(ownerPid)) {
          await rm(p.lockDir, { recursive: true, force: true })
          continue // race to re-acquire; the loser waits again
        }
      }
    } catch { /* lock vanished between stat and rm — just retry */ }
    if (Date.now() > deadline) throw new Error('memory store lock timeout — another process holds the store')
    await sleep(50)
  }
}

// ---------------------------------------------------------------------------
// load — missing / ok / corrupt / unsupported are distinct
// ---------------------------------------------------------------------------

function emptyStore() {
  return { version: STORE_VERSION, rev: 0, next_id: 1, entries: [], trash: [], dedup: {} }
}

function migrateV1(old) {
  const entries = (Array.isArray(old.entries) ? old.entries : []).map((e) => ({
    id: e.id,
    scope: GLOBAL_SCOPE,
    text: e.text ?? '',
    tags: Array.isArray(e.tags) ? e.tags : [],
    source: 'agent',
    trust: 'evidence',
    created_at: e.created_at ?? new Date(0).toISOString(),
    updated_at: e.created_at ?? new Date(0).toISOString(),
  }))
  return {
    ...emptyStore(),
    next_id: entries.reduce((m, e) => Math.max(m, e.id), 0) + 1,
    entries,
  }
}

async function loadRaw() {
  const p = paths()
  let raw
  try {
    raw = await readFile(p.store, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return { status: 'missing', store: emptyStore() }
    throw err
  }
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    // Keep one evidence copy of the corruption (fixed name, overwritten on
    // later corruptions so quarantines never pile up), then fail closed
    // forever until a human resolves the file. The live file stays in place
    // so "corrupt" does not silently downgrade to "missing" on the next load.
    try { await copyFile(p.store, p.quarantine) } catch { /* best-effort evidence copy */ }
    throw new StoreCorruptError(p.quarantine)
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.entries)) {
    try { await copyFile(p.store, p.quarantine) } catch { /* best-effort */ }
    throw new StoreCorruptError(p.quarantine)
  }
  if (typeof data.version !== 'number') {
    // v1 wrote no version field
    return { status: 'ok', store: migrateV1(data) }
  }
  if (data.version > STORE_VERSION) throw new StoreUnsupportedError(data.version)
  if (data.version < STORE_VERSION) return { status: 'ok', store: migrateV1(data) }
  return {
    status: 'ok',
    store: {
      ...emptyStore(),
      ...data,
      trash: Array.isArray(data.trash) ? data.trash : [],
      dedup: (data.dedup && typeof data.dedup === 'object') ? data.dedup : {},
    },
  }
}

// ---------------------------------------------------------------------------
// atomic write — temp -> fsync -> rename, prior generation kept as .bak
// ---------------------------------------------------------------------------

async function atomicSave(store) {
  const p = paths()
  await mkdir(p.dir, { recursive: true })
  const payload = JSON.stringify(store, null, 2) + '\n'
  const bytes = Buffer.byteLength(payload, 'utf8')
  if (bytes > LIMITS.maxFileBytes) {
    throw new Error(`memory store would exceed the ${LIMITS.maxFileBytes} byte budget (${bytes} bytes); forget some entries first`)
  }
  try { await copyFile(p.store, p.bak) } catch { /* first write or unreadable — no prior generation */ }
  const fh = await open(p.tmp, 'w')
  try {
    await fh.writeFile(payload, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  await rename(p.tmp, p.store)
  try {
    const dh = await open(p.dir, 'r')
    await dh.sync()
    await dh.close()
  } catch { /* directory fsync is best-effort on some platforms */ }
}

async function appendAudit(record) {
  const p = paths()
  await mkdir(p.dir, { recursive: true })
  const fh = await open(p.audit, 'a')
  try {
    await fh.appendFile(JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n', 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
}

// ---------------------------------------------------------------------------
// in-process mutation queue — every caller-visible mutation/load serializes
// ---------------------------------------------------------------------------

let chain = Promise.resolve()

function enqueue(job) {
  const run = chain.then(job, job)
  chain = run.then(() => {}, () => {})
  return run
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Run one read against the store. Reads never take the cross-process lock:
 * rename-published files are always complete, so a concurrent writer can only
 * make a read see the previous or the next generation, never a half state.
 */
export async function readStore() {
  return enqueue(async () => {
    const { store } = await loadRaw()
    return store
  })
}

/**
 * Run one mutation under the full contract: in-process queue, cross-process
 * lock, locked read-modify-write, atomic publish, durable audit record.
 *
 * @param {object} audit  base audit record (op/scope/source/…) — the executor
 *   appends id/outcome facts.
 * @param {(store: object) => {result: unknown, audit?: object}} mutator
 *   pure transform: receives the loaded store, returns the tool result value
 *   plus optional extra audit fields. MUST NOT mutate the store in place
 *   beyond what it intends to persist — the engine persists whatever the
 *   store object looks like on return.
 */
export async function mutate(audit, mutator) {
  return enqueue(async () => {
    const release = await acquireLock()
    try {
      const { store } = await loadRaw()
      const { result, audit: extra } = await mutator(store)
      store.rev = (store.rev ?? 0) + 1
      await atomicSave(store)
      await appendAudit({ ...audit, ...extra })
      return result
    } finally {
      await release()
    }
  })
}

/** Validate a note + tags against the budgets. Returns error strings. */
export function validateNote(text, tags) {
  const errors = []
  if (typeof text !== 'string' || !text.trim()) errors.push('text is required and must be a non-empty string')
  else if (text.length > LIMITS.noteChars) errors.push(`note exceeds ${LIMITS.noteChars} characters (${text.length})`)
  if (tags !== undefined) {
    if (!Array.isArray(tags)) errors.push('tags must be an array of strings')
    else {
      if (tags.length > LIMITS.maxTags) errors.push(`too many tags (${tags.length} > ${LIMITS.maxTags})`)
      for (const t of tags) {
        if (typeof t !== 'string' || !t.trim()) errors.push('tags must be non-empty strings')
        else if (t.length > LIMITS.tagChars) errors.push(`tag too long (${t.length} > ${LIMITS.tagChars} chars): ${t.slice(0, 20)}…`)
      }
    }
  }
  return errors
}

/** Allocate the next stable id and record dedup (bounded FIFO). */
export function allocateEntry(store, { text, tags, scope, source, rootCallId }) {
  if (rootCallId !== undefined && store.dedup[rootCallId] !== undefined) {
    const prior = store.entries.find((e) => e.id === store.dedup[rootCallId])
      ?? store.trash.find((e) => e.id === store.dedup[rootCallId])
    if (prior) return { deduplicated: prior }
  }
  const now = new Date().toISOString()
  const entry = {
    id: store.next_id,
    scope,
    text,
    tags: tags ?? [],
    source,
    trust: 'evidence',
    created_at: now,
    updated_at: now,
  }
  store.next_id += 1
  store.entries.push(entry)
  if (rootCallId !== undefined) {
    store.dedup[rootCallId] = entry.id
    const keys = Object.keys(store.dedup)
    if (keys.length > LIMITS.dedupWindow) delete store.dedup[keys[0]]
  }
  if (store.entries.length > LIMITS.maxEntries) {
    throw new Error(`memory store is full (${LIMITS.maxEntries} entries); forget some entries first`)
  }
  return { entry }
}

/** Move an entry to trash (soft delete with undo), evicting the oldest trash. */
export function trashEntry(store, id) {
  const idx = store.entries.findIndex((e) => e.id === id)
  if (idx === -1) return null
  const [entry] = store.entries.splice(idx, 1)
  entry.deleted_at = new Date().toISOString()
  store.trash.push(entry)
  while (store.trash.length > LIMITS.trashEntries) store.trash.shift()
  return entry
}

/** Restore a trashed entry back to live. */
export function restoreEntry(store, id) {
  const idx = store.trash.findIndex((e) => e.id === id)
  if (idx === -1) return null
  const [entry] = store.trash.splice(idx, 1)
  delete entry.deleted_at
  entry.restored_at = new Date().toISOString()
  store.entries.push(entry)
  return entry
}

/** Permanently delete a trashed entry. */
export function purgeEntry(store, id) {
  const idx = store.trash.findIndex((e) => e.id === id)
  if (idx === -1) return null
  const [entry] = store.trash.splice(idx, 1)
  return entry
}
