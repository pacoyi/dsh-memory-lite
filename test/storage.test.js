/**
 * storage.js contract tests — durability, concurrency, integrity, budgets.
 * Each test gets a fresh store directory via beforeEach, so no state leaks
 * across tests.
 */

import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, appendFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import {
  LIMITS, GLOBAL_SCOPE, StoreCorruptError,
  paths, readStore, mutate, validateNote, allocateEntry, trashEntry, restoreEntry, purgeEntry,
  importEntries, reconcileAudit,
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

test('audit log records every mutation durably (two-phase pending/committed)', async () => {
  const e = await save('audited note')
  const raw = await readFile(paths().audit, 'utf8')
  const records = raw.trim().split('\n').map((l) => JSON.parse(l))
  const mine = records.filter((r) => r.op === 'save' && r.id === e.id)
  assert.equal(mine.length, 2, 'one pending line plus one committed line per mutation')
  assert.equal(mine[0].phase, 'pending')
  assert.equal(mine[1].phase, 'committed')
  assert.equal(mine[0].rev, mine[1].rev, 'both phases name the same store revision')
  assert.equal(mine[1].outcome, 'committed')
  assert.ok(typeof mine[0].ts === 'string')
  const store = await readStore()
  assert.equal(store.rev, mine[1].rev, 'committed rev matches the persisted store')
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

test('reconcileAudit closes crash-orphaned pending intents (applied/orphan) and is idempotent', async () => {
  await save('first')  // rev 1 — fully committed
  await save('second') // rev 2 — fully committed
  const p = paths()
  // crash AFTER atomicSave but BEFORE the committed line: the store moved to
  // rev 3, the audit trail stops at "pending 3"
  const bumped = await readStore()
  bumped.rev = 3
  await writeFile(p.store, JSON.stringify(bumped, null, 2) + '\n', 'utf8')
  await appendFile(p.audit, JSON.stringify({ ts: new Date().toISOString(), op: 'save', id: 99, phase: 'pending', rev: 3 }) + '\n', 'utf8')
  // crash BEFORE atomicSave: pending 4 never landed anywhere
  await appendFile(p.audit, JSON.stringify({ ts: new Date().toISOString(), op: 'save', id: 100, phase: 'pending', rev: 4 }) + '\n', 'utf8')

  const result = await reconcileAudit()
  assert.equal(result.reconciled, 1, 'rev 3 was applied but unproven')
  assert.equal(result.orphaned, 1, 'rev 4 never applied')

  const records = (await readFile(p.audit, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
  const closes = records.filter((r) => r.op === 'reconcile')
  assert.deepEqual(closes.map((r) => [r.rev, r.applied]).sort(), [[3, true], [4, false]])
  assert.ok(closes.every((r) => r.phase === 'reconciled'))

  // idempotent: a second startup run closes nothing new and appends nothing
  const linesBefore = (await readFile(p.audit, 'utf8')).trim().split('\n').length
  const again = await reconcileAudit()
  assert.equal(again.reconciled + again.orphaned, 0)
  const linesAfter = (await readFile(p.audit, 'utf8')).trim().split('\n').length
  assert.equal(linesAfter, linesBefore)
})

test('importEntries: atomic batch with provenance; one invalid item rejects all', async () => {
  const prov = {
    source_agent: 'claude-code', source_path: '/x/CLAUDE.md',
    doc_digest: 'd1', item_digest: 'i1',
    imported_at: new Date().toISOString(), importer_version: 1,
  }
  const imported = await mutate({ op: 'import', scope: GLOBAL_SCOPE, source: 'user' }, (store) => {
    const entries = importEntries(store, [
      { text: 'likes concise replies', scope: GLOBAL_SCOPE, provenance: prov },
      { text: 'prefers dark theme', tags: ['ui'], scope: GLOBAL_SCOPE, provenance: { ...prov, item_digest: 'i2' } },
    ])
    return { result: entries, audit: { outcome: 'imported', count: entries.length } }
  })
  assert.deepEqual(imported.map((e) => e.id), [1, 2])
  const store = await readStore()
  assert.equal(store.entries[0].source, 'import')
  assert.equal(store.entries[0].provenance.source_path, '/x/CLAUDE.md')
  assert.equal(store.entries[0].trust, 'evidence')

  // one invalid item rejects the whole batch — no partial import ever lands
  await assert.rejects(
    () => mutate({ op: 'import', scope: GLOBAL_SCOPE, source: 'user' }, (s) => {
      importEntries(s, [
        { text: 'ok entry', scope: GLOBAL_SCOPE },
        { text: 'x'.repeat(LIMITS.noteChars + 1), scope: GLOBAL_SCOPE },
      ])
      return { result: null }
    }),
    /note exceeds/,
  )
  const store2 = await readStore()
  assert.equal(store2.entries.length, 2, 'no partial import ever lands')

  // empty batch and missing scope are refused outright
  await assert.rejects(() => mutate({}, (s) => { importEntries(s, []); return { result: null } }), /non-empty/)
  await assert.rejects(
    () => mutate({}, (s) => { importEntries(s, [{ text: 'no scope' }]); return { result: null } }),
    /scope/,
  )
})

test('v2 store carrying provenance fields loads cleanly (additive compatibility)', async () => {
  await writeFile(paths().store, JSON.stringify({
    version: 2, rev: 7, next_id: 8,
    entries: [{
      id: 7, scope: GLOBAL_SCOPE, text: 'imported fact', tags: [], source: 'import',
      trust: 'evidence',
      provenance: {
        source_agent: 'codex', source_path: '/y/AGENTS.md',
        doc_digest: 'a', item_digest: 'b',
        imported_at: '2026-08-31T00:00:00Z', importer_version: 1,
      },
      created_at: '2026-08-30T00:00:00Z', updated_at: '2026-08-30T00:00:00Z',
    }],
    trash: [], dedup: {},
  }), 'utf8')
  const store = await readStore()
  assert.equal(store.entries[0].provenance.source_agent, 'codex')
  // mutations keep working on top of the extended shape
  const next = await save('after provenance load')
  assert.equal(next.id, 8)
  assert.equal((await readStore()).entries.length, 2)
})
