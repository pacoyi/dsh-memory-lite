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

let dir
let toolDef
let preExecuteHandler

function mockContext() {
  return {
    tools: { register: (def) => { toolDef = def } },
    on: (event, handler) => { preExecuteHandler = handler },
    inject: () => {},
  }
}

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
