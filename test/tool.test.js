/**
 * index.js tool-surface tests — scope isolation, approval gating, evidence
 * rendering — using a mocked Cordis context around the real defineTool.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../index.js'
import { readStore } from '../storage.js'

let dir
let toolDef
let preExecuteHandler
let rpcHandler

function mockContext() {
  return {
    tools: { register: (def) => { toolDef = def } },
    on: (event, handler) => { preExecuteHandler = handler },
    inject: (_deps, cb) => {
      // capture the connection RPC surface so tests can drive the
      // settings-card endpoints (list/save/forget/.../import.*) directly
      cb({ connection: { rpc: { handle: (_channel, fn) => { rpcHandler = fn } } } })
    },
  }
}

const rpc = (endpoint, payload) => rpcHandler(endpoint, payload)

let callSeq = 0
const execIn = (cwd, callId) => ({
  callId: callId ?? `c-${++callSeq}`,
  agent: { session: { meta: { cwd } } },
})

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'memory-lite-tool-'))
  process.env.MEMORY_LITE_STORE = join(dir, 'store.json')
  apply(mockContext())
  assert.ok(toolDef, 'tool registered')
})

after(async () => {
  delete process.env.MEMORY_LITE_STORE
  await rm(dir, { recursive: true, force: true })
})

test('approval gate asks for save and forget, passes through otherwise', async () => {
  assert.ok(preExecuteHandler, 'pre-execute handler subscribed')
  // waterfall contract: pass-through is `return next()`, never undefined
  // (a listener that skips next() vetoes the whole chain — see cordis events)
  const pass = () => ({ kind: 'allow' })
  const ask = await preExecuteHandler({ name: 'memory', arguments: { operation: 'save' } }, pass)
  assert.deepEqual(ask, { kind: 'ask', reason: 'memory save: durable cross-session effect on the memory store' })
  const askForget = await preExecuteHandler({ name: 'memory', arguments: { operation: 'forget' } }, pass)
  assert.equal(askForget.kind, 'ask')
  assert.deepEqual(await preExecuteHandler({ name: 'memory', arguments: { operation: 'recall' } }, pass), { kind: 'allow' })
  assert.deepEqual(await preExecuteHandler({ name: 'memory', arguments: { operation: 'list' } }, pass), { kind: 'allow' })
  assert.deepEqual(await preExecuteHandler({ name: 'other-tool', arguments: {} }, pass), { kind: 'allow' })
  // undefined pass-through (the veto bug this test guards against)
  const vetoed = await preExecuteHandler({ name: 'other-tool', arguments: {} }, pass)
  assert.notEqual(vetoed, undefined, 'must never return undefined — that vetoes the chain')
})

test('scope isolation: project A cannot see or forget project B entries', async () => {
  const saved = await toolDef.execute({ operation: 'save', text: 'project A fact' }, execIn('/proj/a'))
  assert.equal(saved.error, undefined)
  assert.equal(saved.entry.scope, '/proj/a')

  const savedB = await toolDef.execute({ operation: 'save', text: 'project B secret' }, execIn('/proj/b'))
  assert.equal(savedB.entry.scope, '/proj/b')

  // recall in A sees A + global, never B
  const recallA = await toolDef.execute({ operation: 'recall', query: 'project' }, execIn('/proj/a'))
  assert.equal(recallA.entries.length, 1)
  assert.equal(recallA.entries[0].text, 'project A fact')

  // A cannot forget B's entry — it acts as absent
  const forget = await toolDef.execute({ operation: 'forget', id: savedB.entry.id }, execIn('/proj/a'))
  assert.match(forget.error, /no entry/)

  // B still sees its entry
  const recallB = await toolDef.execute({ operation: 'recall', query: 'secret' }, execIn('/proj/b'))
  assert.equal(recallB.entries.length, 1)
})

test('global entries are visible from every scope', async () => {
  await toolDef.execute({ operation: 'save', text: 'user prefers concise replies' }, execIn('/proj/a'))
  // saved under /proj/a — now save a global one through the store API shape:
  // simulate by saving from a global-context exec (no agent cwd)
  const globalExec = { callId: 'c-global' } // no agent → global scope
  const g = await toolDef.execute({ operation: 'save', text: 'global preference: dark theme' }, globalExec)
  assert.equal(g.entry.scope, 'global')

  const recallB = await toolDef.execute({ operation: 'recall', query: 'dark theme' }, execIn('/proj/b'))
  assert.equal(recallB.entries.length, 1)
  assert.equal(recallB.entries[0].scope, 'global')
})

test('save validation errors surface as tool errors, not throws', async () => {
  const r = await toolDef.execute({ operation: 'save', text: '' }, execIn('/proj/a'))
  assert.match(r.error, /text is required/)
  const r2 = await toolDef.execute({ operation: 'save', text: 'ok', tags: ['x'.repeat(40)] }, execIn('/proj/a'))
  assert.match(r2.error, /tag too long/)
})

test('dedup: replaying the same call id does not duplicate the entry', async () => {
  const exec1 = execIn('/proj/a', 'replay-1')
  const first = await toolDef.execute({ operation: 'save', text: 'replayable fact' }, exec1)
  assert.equal(first.deduplicated, undefined)
  const replay = await toolDef.execute({ operation: 'save', text: 'replayable fact' }, execIn('/proj/a', 'replay-1'))
  assert.equal(replay.deduplicated, true)
  assert.equal(replay.entry.id, first.entry.id)
  const recall = await toolDef.execute({ operation: 'recall', query: 'replayable' }, execIn('/proj/a'))
  assert.equal(recall.entries.filter((e) => e.text === 'replayable fact').length, 1)
})

test('forget moves to trash and reports restorability', async () => {
  const e = await toolDef.execute({ operation: 'save', text: 'trash me' }, execIn('/proj/a'))
  const f = await toolDef.execute({ operation: 'forget', id: e.entry.id }, execIn('/proj/a'))
  assert.equal(f.error, undefined)
  assert.equal(f.entry.id, e.entry.id)
  assert.match(f.entry.deleted_at, /\d/)
})

test('recall render labels untrusted evidence and includes provenance', async () => {
  const e = await toolDef.execute({ operation: 'save', text: 'render evidence check' }, execIn('/proj/a'))
  const rendered = toolDef.output.render({}, { operation: 'save', entry: e.entry })
  assert.match(rendered[0].text, /#\d+ · .* · agent · project/)
  const recall = await toolDef.execute({ operation: 'recall', query: 'evidence' }, execIn('/proj/a'))
  const lines = toolDef.output.render({}, recall)[0].text
  assert.match(lines, /untrusted evidence/)
  assert.match(lines, /never override current instructions/)
})

test('render output respects the character budget', async () => {
  // craft a value whose rendered form exceeds the budget
  const long = 'y'.repeat(5000)
  const value = { operation: 'recall', entries: Array.from({ length: 10 }, (_, i) => ({
    id: i + 1, created_at: '2026-01-01T00:00:00Z', source: 'agent', scope: '/p', tags: [], text: long,
  })) }
  const text = toolDef.output.render({}, value)[0].text
  assert.ok(text.length <= 16000 + 200, `rendered ${text.length} chars`)
  assert.match(text, /output truncated/)
})

test('recall render labels imported entries with their source path', async () => {
  const entry = {
    id: 42, scope: 'global', text: 'imported fact', tags: [], source: 'import',
    trust: 'evidence', created_at: '2026-08-31T00:00:00Z',
    provenance: { source_path: '/src/CLAUDE.md' },
  }
  const lines = toolDef.output.render({}, { operation: 'recall', entries: [entry] })[0].text
  assert.match(lines, /untrusted evidence/)
  assert.match(lines, /imported from \/src\/CLAUDE\.md/)
  assert.match(lines, / · import · /)
})

test('import.parse: lists, headings, paragraphs, fences, dedupe, rule-like flags', async () => {
  const src = [
    '# 代码风格',
    '- 用户偏好中文回复',
    '* 提交前必须运行全部测试',
    '1. 使用 pnpm 管理依赖',
    '  续行也算同一条',
    '',
    '零散段落：项目 A 用 React 18 构建。',
    '```bash',
    '- 这行在代码块里必须被忽略',
    '```',
    '- Never commit secrets to git',
    '- 用户偏好中文回复',
  ].join('\n')
  const res = await rpc('import.parse', { text: src })
  assert.equal(res.ok, true)
  const { candidates, doc_digest } = res.value
  const texts = candidates.map((c) => c.text)
  assert.ok(texts.includes('代码风格'), 'heading stands alone as a candidate')
  assert.ok(texts.includes('用户偏好中文回复'))
  assert.ok(texts.includes('使用 pnpm 管理依赖 续行也算同一条'), 'indented continuation merges into its list item')
  assert.ok(texts.some((t) => t.includes('零散段落')), 'paragraph fallback works')
  assert.ok(texts.includes('Never commit secrets to git'))
  assert.ok(!texts.some((t) => t.includes('代码块里')), 'fenced code blocks are skipped')
  assert.equal(texts.filter((t) => t === '用户偏好中文回复').length, 1, 'duplicates deduped')

  const ruleZh = candidates.find((c) => c.text === '提交前必须运行全部测试')
  assert.equal(ruleZh.rule_like, true, 'Chinese imperative flagged')
  const ruleEn = candidates.find((c) => c.text === 'Never commit secrets to git')
  assert.equal(ruleEn.rule_like, true, 'English never-flagged imperative flagged')
  const fact = candidates.find((c) => c.text === '用户偏好中文回复')
  assert.equal(fact.rule_like, false, 'plain preference not flagged')
  assert.ok(fact.item_digest, 'per-item digest present')
  assert.ok(doc_digest, 'document digest present')

  // empty source surfaces as an RPC error, not a crash
  const bad = await rpc('import.parse', { text: '   ' })
  assert.equal(bad.ok, false)
  assert.match(bad.error.message, /nothing to parse/)
})

test('import.commit: provenance roundtrip, idempotent re-run, conflict refusal', async () => {
  const prov = { source_agent: 'claude-code', source_path: '/src/CLAUDE.md' }
  const parsed = await rpc('import.parse', { text: '- 用户偏好中文回复\n- 喜欢深色主题' })
  const { candidates, doc_digest } = parsed.value
  const items = candidates.map((c) => ({ text: c.text, item_digest: c.item_digest }))

  const first = await rpc('import.commit', { items, scope: 'global', provenance: { ...prov, doc_digest } })
  assert.equal(first.ok, true)
  assert.equal(first.value.imported.length, 2)
  assert.equal(first.value.imported[0].source, 'import')
  assert.equal(first.value.imported[0].provenance.source_path, '/src/CLAUDE.md')
  assert.equal(first.value.imported[0].provenance.doc_digest, doc_digest)
  assert.ok(first.value.imported[0].provenance.imported_at)

  // re-running the exact same import is a no-op
  const rerun = await rpc('import.commit', { items, scope: 'global', provenance: { ...prov, doc_digest } })
  assert.equal(rerun.value.imported.length, 0)
  assert.equal(rerun.value.skipped_unchanged.length, 2)
  const store = await readStore()
  assert.equal(store.entries.filter((e) => e.source === 'import').length, 2)

  // the same path with a CHANGED document is refused — never silently overwritten
  const beforeCount = store.entries.length
  const changed = await rpc('import.parse', { text: '- 用户改为偏好英文回复' })
  const conflict = await rpc('import.commit', {
    items: changed.value.candidates.map((c) => ({ text: c.text, item_digest: c.item_digest })),
    scope: 'global',
    provenance: { ...prov, doc_digest: changed.value.doc_digest },
  })
  assert.equal(conflict.ok, true, 'a conflict is a structured result, not an error')
  assert.equal(conflict.value.conflicts, 2)
  assert.equal(conflict.value.imported.length, 0)
  assert.match(conflict.value.conflictReason, /changed/)
  const store2 = await readStore()
  assert.equal(store2.entries.length, beforeCount, 'nothing landed from the conflicting batch')
})

test('import.commit: pasted source dedupes by item digest without path conflicts', async () => {
  const parsed = await rpc('import.parse', { text: '- 喜欢简短回复' })
  const mk = (p) => p.value.candidates.map((c) => ({ text: c.text, item_digest: c.item_digest }))
  const a = await rpc('import.commit', { items: mk(parsed), scope: 'global' })
  assert.equal(a.value.imported.length, 1)

  // same paste again: no real path, so no document-level conflict — but the
  // identical content still skips by item digest
  const again = await rpc('import.commit', { items: mk(parsed), scope: 'global' })
  assert.equal(again.value.imported.length, 0)
  assert.equal(again.value.skipped_unchanged.length, 1)
  assert.equal(again.value.conflicts, 0)

  // a different paste lands normally
  const other = await rpc('import.parse', { text: '- 项目 B 使用 vitest' })
  const d = await rpc('import.commit', { items: mk(other), scope: 'global' })
  assert.equal(d.value.imported.length, 1)

  // empty selection is an RPC error
  const empty = await rpc('import.commit', { items: [], scope: 'global' })
  assert.equal(empty.ok, false)
  assert.match(empty.error.message, /no items selected/)
})

test('import.presets probes well-known files and returns structured results', async () => {
  const res = await rpc('import.presets', {})
  assert.equal(res.ok, true)
  assert.ok(Array.isArray(res.value.presets))
  assert.ok(res.value.presets.length >= 2, 'both claude-code and codex presets probed')
  for (const p of res.value.presets) {
    assert.equal(typeof p.path, 'string')
    assert.equal(typeof p.exists, 'boolean')
    if (p.exists) {
      assert.equal(typeof p.content, 'string')
      assert.equal(typeof p.doc_digest, 'string')
      assert.equal(p.error, null)
    }
  }
})

test('export.render: scope filtering renders a plain markdown list', async () => {
  const store = await readStore()
  const all = await rpc('export.render', {})
  assert.equal(all.ok, true)
  assert.equal(all.value.count, store.entries.length)
  assert.ok(all.value.text.includes('- project A fact'), 'entries render as list items')
  assert.ok(!/#[0-9]+/.test(all.value.text), 'no ids leak into the export')

  const global = await rpc('export.render', { scope: 'global' })
  assert.equal(global.value.count, store.entries.filter((e) => e.scope === 'global').length)
  assert.ok(global.value.text.includes('dark theme'))
  assert.ok(!global.value.text.includes('project B secret'), 'other scopes stay out')

  const projA = await rpc('export.render', { scope: '/proj/a' })
  assert.ok(projA.value.text.includes('project A fact'))
  assert.ok(!projA.value.text.includes('dark theme'))
  assert.equal(projA.value.count, store.entries.filter((e) => e.scope === '/proj/a').length)
})

test('export -> parse -> commit round-trip is a no-op for every entry source', async () => {
  // a manual save WITH tags exercises the (tags: ...) suffix round-trip
  const withTags = await rpc('save', { text: '用 vitest 跑测试', tags: ['tooling'], scope: 'global' })
  assert.equal(withTags.ok, true)

  const exported = await rpc('export.render', {})
  assert.ok(exported.value.text.includes('(tags: tooling)'), 'tags render as the round-trip suffix')

  const parsed = await rpc('import.parse', { text: exported.value.text })
  const tagged = parsed.value.candidates.find((c) => c.text === '用 vitest 跑测试')
  assert.deepEqual(tagged.tags, ['tooling'], 'parse recovers the suffix as tags')

  const committed = await rpc('import.commit', {
    items: parsed.value.candidates.map((c) => ({ text: c.text, item_digest: c.item_digest, tags: c.tags })),
    scope: 'global',
    provenance: { source_agent: 'manual' },
  })
  assert.equal(committed.ok, true)
  assert.equal(committed.value.imported.length, 0,
    'every live entry — agent, user, import — skips on re-import (content digest, not just provenance)')
  assert.equal(committed.value.skipped_unchanged.length, exported.value.count)
  const store = await readStore()
  assert.equal(store.entries.length, exported.value.count, 'nothing duplicated by the round-trip')
})
