/**
 * storage.js contract tests — durability, concurrency, integrity, budgets.
 * Each test gets a fresh store directory via beforeEach, so no state leaks
 * across tests.
 */

import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import {
  LIMITS, GLOBAL_SCOPE, StoreCorruptError,
  paths, readStore, mutate, validateNote, allocateEntry, trashEntry, restoreEntry, purgeEntry,
} from '../storage.js'

const exec = promisify(execFile)

let root // per-file scratch root; each test gets <root>/<n>/store.json
let seq = 0

const save = (note, opts = {}) => mutate(
  { op: 'save', scope: opts.scope ?? GLOBAL_SCOPE, source: opts.source ?? 'test' },
  (s) => {
    const { entry, deduplicated } = allocateEntry(s, {
      text: note, tags: opts.tags, scope: opts.scope ?? GLOBAL_SCOPE,
      source: opts.source ?? 'test', rootCallId: opts.callId,
    })
    if (deduplicated) return { result: deduplicated, audit: { id: deduplicated.id, outcome: 'deduplicated' } }
    return { result: entry, audit: { id: entry.id, outcome: 'committed' } }
  },
)

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'memory-lite-test-'))
})

beforeEach(async () => {
  seq += 1
  const store = join(root, `t${seq}`, 'store.json')
  await mkdir(join(root, `t${seq}`), { recursive: true })
  process.env.MEMORY_LITE_STORE = store
})

after(async () => {
  delete process.env.MEMORY_LITE_STORE
  await rm(root, { recursive: true, force: true })
})

test('save/load roundtrip persists v2 shape, stable ids never reused', async () => {
  const a = await save('first note')
  const b = await save('second note', { scope: '/proj/a', tags: ['pref'] })
  assert.equal(a.id, 1)
  assert.equal(b.id, 2)
  await mutate({}, (s) => { trashEntry(s, 2); return { result: null } })
  const c = await save('third note')
  // id 2 was trashed — the counter must not hand it out again
  assert.equal(c.id, 3)
  const store = await readStore()
  assert.equal(store.version, 2)
  assert.equal(store.entries.length, 2)
  assert.equal(store.trash.length, 1)
  assert.deepEqual(store.entries.map((e) => e.id), [1, 3])
})

test('trash -> restore -> purge lifecycle', async () => {
  const e = await save('to be trashed')
  await mutate({}, (s) => { trashEntry(s, e.id); return { result: null } })
  let store = await readStore()
  assert.equal(store.entries.length, 0)
  assert.equal(store.trash[0].id, e.id)
  await mutate({}, (s) => { restoreEntry(s, e.id); return { result: null } })
  store = await readStore()
  assert.equal(store.entries.length, 1)
  assert.equal(store.trash.length, 0)
  await mutate({}, (s) => { trashEntry(s, e.id); return { result: null } })
  await mutate({}, (s) => { purgeEntry(s, e.id); return { result: null } })
  store = await readStore()
  assert.equal(store.entries.length, 0)
  assert.equal(store.trash.length, 0)
})

test('atomic publish: temp file never left behind, prior generation kept as .bak', async () => {
  await save('generation one')
  await save('generation two')
  const p = paths()
  const dir = join(p.store, '..')
  const files = await readdir(dir)
  assert.ok(!files.some((f) => f.endsWith('.tmp')), 'no temp residue')
  assert.ok(files.includes('.store.json.bak'), 'prior generation kept')
  const bak = JSON.parse(await readFile(p.bak, 'utf8'))
  assert.equal(bak.entries[0].text, 'generation one')
})

test('audit log records every mutation durably', async () => {
  const e = await save('audited note')
  const raw = await readFile(paths().audit, 'utf8')
  const records = raw.trim().split('\n').map((l) => JSON.parse(l))
  const mine = records.filter((r) => r.op === 'save' && r.id === e.id)
  assert.equal(mine.length, 1)
  assert.equal(mine[0].outcome, 'committed')
  assert.ok(typeof mine[0].ts === 'string')
})

test('corrupt store: quarantined once, reads and mutations fail closed', async () => {
  await save('good entry')
  await writeFile(paths().store, '{ not json !!!', 'utf8')
  await assert.rejects(() => readStore(), StoreCorruptError)
  await assert.rejects(() => save('should be refused'), StoreCorruptError)
  const dir = join(paths().store, '..')
  const files = await readdir(dir)
  const q = files.filter((f) => f.includes('corrupt'))
  assert.equal(q.length, 1, 'exactly one quarantine file, never a pile')
  // the corrupt live file stays in place — corrupt must not downgrade to missing
  const raw = await readFile(paths().store, 'utf8')
  assert.equal(raw, '{ not json !!!')
})

test('missing store starts empty; v1 store migrates to v2 with global scope', async () => {
  const store = await readStore()
  assert.equal(store.entries.length, 0)
  // v1 shape: no version field, plain entries
  await writeFile(paths().store, JSON.stringify({
    entries: [{ id: 7, text: 'legacy', tags: ['x'], created_at: '2026-01-01T00:00:00.000Z' }],
  }), 'utf8')
  const migrated = await readStore()
  assert.equal(migrated.version, 2)
  assert.equal(migrated.entries[0].scope, GLOBAL_SCOPE)
  assert.equal(migrated.next_id, 8)
})

test('future store version is rejected as unsupported', async () => {
  await writeFile(paths().store, JSON.stringify({ version: 99, entries: [] }), 'utf8')
  await assert.rejects(() => readStore(), (e) => e.code === 'STORE_UNSUPPORTED')
})

test('note and tag budgets are enforced', () => {
  assert.equal(validateNote('ok note', ['a', 'b']).length, 0)
  assert.ok(validateNote('x'.repeat(LIMITS.noteChars + 1)).length > 0)
  assert.ok(validateNote('ok', Array.from({ length: LIMITS.maxTags + 1 }, (_, i) => `t${i}`)).length > 0)
  assert.ok(validateNote('ok', ['t'.repeat(LIMITS.tagChars + 1)]).length > 0)
  assert.ok(validateNote('   ').length > 0)
  assert.ok(validateNote('ok', 'not-an-array').length > 0)
})

test('entry-count ceiling eventually rejects further saves', async () => {
  let lastErr = null
  for (let i = 0; i < LIMITS.maxEntries + 2; i++) {
    try {
      await save(`filler ${i}`, { callId: `fill-${i}` })
    } catch (err) { lastErr = err; break }
  }
  assert.ok(lastErr, 'entry-count ceiling eventually rejects')
  assert.match(lastErr.message, /full|byte budget/)
})

test('dedup: same call id saves once, different call ids save twice', async () => {
  const first = await save('idempotent note', { callId: 'call-42' })
  assert.equal(first.deduplicated, undefined)
  const second = await save('idempotent note', { callId: 'call-42' })
  assert.equal(second.id, first.id)
  const store = await readStore()
  assert.equal(store.entries.filter((e) => e.text === 'idempotent note').length, 1)
  await save('other note', { callId: 'call-43' })
  const store2 = await readStore()
  assert.equal(store2.entries.length, 2)
})

test('in-process concurrency: 50 parallel saves all land with unique sequential ids', async () => {
  const results = await Promise.all(
    Array.from({ length: 50 }, (_, i) => save(`concurrent ${i}`, { callId: `cc-${i}` })),
  )
  const ids = results.map((r) => r.id).sort((a, b) => a - b)
  assert.deepEqual(ids, Array.from({ length: 50 }, (_, i) => i + 1))
  const store = await readStore()
  assert.equal(store.entries.length, 50)
})

test('cross-process concurrency: two writers under the mkdir lock lose nothing', async () => {
  const storeFile = process.env.MEMORY_LITE_STORE
  const storageUrl = new URL('../storage.js', import.meta.url).href
  const childScript = `
    process.env.MEMORY_LITE_STORE = ${JSON.stringify(storeFile)}
    const { mutate, allocateEntry } = await import(${JSON.stringify(storageUrl)})
    for (let i = 0; i < 10; i++) {
      await mutate({ op: 'save', scope: 'global', source: 'child' }, (s) => {
        const { entry } = allocateEntry(s, { text: 'child-' + process.argv[1] + '-' + i, scope: 'global', source: 'child' })
        return { result: entry, audit: { id: entry.id, outcome: 'committed' } }
      })
    }
    console.log('done')
  `
  const [a, b] = await Promise.all([
    exec(process.execPath, ['--input-type=module', '-e', childScript, 'A']),
    exec(process.execPath, ['--input-type=module', '-e', childScript, 'B']),
  ])
  assert.equal(a.stdout.trim(), 'done')
  assert.equal(b.stdout.trim(), 'done')
  const store = await readStore()
  assert.equal(store.entries.length, 20, 'both writers fully persisted')
  const ids = store.entries.map((e) => e.id).sort((a2, b2) => a2 - b2)
  assert.deepEqual(ids, Array.from({ length: 20 }, (_, i) => i + 1), 'ids unique and dense')
})

test('store survives manual inspection: plain JSON, readable without the plugin', async () => {
  await save('human readable')
  const raw = JSON.parse(await readFile(paths().store, 'utf8'))
  assert.equal(raw.entries[0].text, 'human readable')
  assert.equal(raw.entries[0].source, 'test')
})
