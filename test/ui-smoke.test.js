// client.js render smoke — the layer the RPC suites cannot see.
//
// The browser half is a window.__ModuleLoader__ self-registration whose
// factory receives React from the host loader. Two failure classes live only
// in that layer and passed 31/31 RPC tests before:
//   - ReferenceError during render (prop shorthand referencing an undefined
//     variable crashes the whole card — the v0.3.0 export white-screen)
//   - JSX mis-nesting: syntactically valid parentheses that place a branch
//     inside the wrong parent (the v0.3.0 result-step swallow, where
//     `step === 'result' && ...` ended up inside the preview branch and
//     vanished with it — node --check passes, the UI silently loses nodes)
//
// So this suite renders client.js outside any browser:
//   - structure assertions run on a hook-mocked React (inert useState with
//     per-ordinal injection, no-op effects) and inspect the element tree —
//     zero dependencies, runs anywhere node runs
//   - renderToString smoke (real React from the harness checkout when
//     present, MEMORY_LITE_REACT_DIR to override, skipped otherwise) proves
//     every surface renders to HTML without throwing
//
// The useState ordinal tables below mirror the component bodies; when a
// component gains or reorders state, update the table with it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client.js')

// useState call ordinals, per component, in declaration order. ImportWizard
// and ExportPanel continue the counter because a child's hooks run while the
// mocked render walks down the tree.
const PANEL = { data: 0, text: 1, tags: 2, saveScope: 3, busy: 4, err: 5, confirmDel: 6, confirmPurge: 7, showTrash: 8, showWiz: 9, showExport: 10 }
const WIZ = { step: 11, presets: 12, srcText: 13, srcAgent: 14, srcPath: 15, scope: 16, candidates: 17, docDigest: 18, checks: 19, edits: 20, batchTags: 21, result: 22, busy: 23, err: 24 }
const EXPORT = { scope: 11, text: 12, count: 13, busy: 14, err: 15, copied: 16 }

function loadClient() {
  const source = readFileSync(CLIENT, 'utf8')
  let captured = null
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: (def) => { captured = def } } } })
  assert.ok(captured, 'client.js must register through window.__ModuleLoader__')
  return captured
}

// Hook-mocked React: createElement builds plain objects (flattening array
// children like React does), useState injects by ordinal, effects never run
// — pure structure inspection, zero deps.
function mockReact(injections) {
  let idx = 0
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState(init) {
      const i = idx++
      const value = i in injections ? injections[i] : (typeof init === 'function' ? init() : init)
      return [value, () => {}]
    },
    useEffect: () => {},
    useCallback: (fn) => fn,
    useRef: (init) => ({ current: init }),
  }
}

// Boot the module against mocked React and capture the settings card.
function mountCard(injections) {
  const def = loadClient()
  const mod = def.factory(() => mockReact(injections))
  let card = null
  mod.apply({
    effect: () => () => {},
    get: (key) => key === 'slots'
      ? { inject: (_slot, register) => register(), register: (_meta, comp) => { card = comp } }
      : null,
  })
  assert.ok(card, 'settings.section registration must produce the card component')
  return card({}).type({}) // unwrap h(MemoryPanel, props) -> execute MemoryPanel
}

function childClasses(el) {
  return (el.children ?? []).map(c => (!c ? null : (typeof c.type === 'function' ? '[component]' : (c.props.className ?? c.type))))
}

function findChild(el, className) {
  return (el.children ?? []).find(c => c && c.props && c.props.className === className)
}

test('client.js registers as a dsh module with apply/inject exports', () => {
  const def = loadClient()
  assert.equal(def.id, 'dsh-memory-lite')
  assert.equal(typeof def.factory, 'function')
  const mod = def.factory(() => mockReact({}))
  assert.equal(typeof mod.apply, 'function')
  // join, not deepEqual: the module runs inside a vm realm whose array
  // prototype never passes host-side structural equality
  assert.equal(mod.inject.join(','), 'slots')
})

test('MemoryPanel top level keeps header, panels, and body as siblings', () => {
  // The v0.3.0 mis-nesting swallowed every sibling into mem-header; assert
  // the layout shape instead of trusting balanced parentheses.
  const tree = mountCard({ [PANEL.data]: { entries: [], trash: [] } })
  assert.deepEqual(childClasses(tree), ['mem-header', null, null, 'div'])
  const header = findChild(tree, 'mem-header')
  assert.equal(header.children.length, 2, 'header holds title block and action row only')
})

test('showWiz mounts ImportWizard as a header sibling, not inside it', () => {
  const tree = mountCard({ [PANEL.data]: { entries: [], trash: [] }, [PANEL.showWiz]: true })
  assert.deepEqual(childClasses(tree), ['mem-header', null, null, '[component]'])
})

test('showExport mounts ExportPanel as a header sibling with scopeOptions wired', () => {
  // Regression: the v0.3.0 white screen — h(ExportPanel, { scopeOptions })
  // shorthand referenced an undefined variable and crashed the whole card.
  const tree = mountCard({ [PANEL.data]: { entries: [], trash: [] }, [PANEL.showExport]: true })
  assert.deepEqual(childClasses(tree), ['mem-header', null, '[component]', 'div'])
})

test('ImportWizard: result branch renders at top level with stat and finish button', () => {
  // Regression: the result branch was nested inside the preview branch and
  // disappeared with it — the wizard showed "③ 完成" with no body.
  const injections = {
    [PANEL.data]: { entries: [], trash: [] },
    [PANEL.showWiz]: true,
    [WIZ.step]: 'result',
    [WIZ.result]: { imported: [{ id: 1, scope: 'global', text: '样例条目' }], skipped_unchanged: [], conflicts: 0, conflictReason: null },
  }
  const tree = mountCard(injections)
  const wizEl = (tree.children ?? []).find(c => c && typeof c.type === 'function')
  assert.ok(wizEl, 'wizard mounted')
  const wiz = wizEl.type({ onClose: () => {}, onDone: () => {}, scopeOptions: ['global'] })
  // Top level: header, err(false), source(false), preview(false), result(div)
  assert.deepEqual(childClasses(wiz), ['mem-header', null, null, null, 'div'])
  const resultBranch = wiz.children[4]
  const stat = findChild(resultBranch, 'mem-wiz-stat')
  assert.ok(stat, 'result stat present')
  assert.equal(stat.children[0].children[0], '导入 1 条')
  const actions = findChild(resultBranch, 'mem-add')
  assert.ok(actions, 'finish row present')
  assert.equal(actions.children[0].children[0], '完成')
})

test('ImportWizard: preview branch carries the stat, candidate list, and commit row', () => {
  const injections = {
    [PANEL.data]: { entries: [], trash: [] },
    [PANEL.showWiz]: true,
    [WIZ.step]: 'preview',
    [WIZ.candidates]: [
      { text: '必须始终使用中文回复', rule_like: true, item_digest: 'a' },
      { text: '用户在杭州工作', rule_like: false, item_digest: 'b' },
    ],
    [WIZ.checks]: { 1: true },
  }
  const tree = mountCard(injections)
  const wizEl = (tree.children ?? []).find(c => c && typeof c.type === 'function')
  const wiz = wizEl.type({ onClose: () => {}, onDone: () => {}, scopeOptions: ['global'] })
  assert.deepEqual(childClasses(wiz), ['mem-header', null, null, 'div', null])
  const preview = wiz.children[3]
  assert.ok(findChild(preview, 'mem-wiz-stat'), 'preview stat present')
  const list = findChild(preview, 'mem-list')
  assert.ok(list, 'candidate list present')
  assert.equal(list.children.length, 2)
  assert.equal(list.children[0].props.className, 'mem-wiz-cand rule', 'rule-like candidate carries the rule class')
  const ruleHint = list.children[0].children[1].children[1]
  assert.ok(ruleHint.props.className === 'mem-wiz-note', 'rule hint renders for rule-like candidates')
})

test('ImportWizard: source branch lists presets and the paste area', () => {
  const injections = {
    [PANEL.data]: { entries: [], trash: [] },
    [PANEL.showWiz]: true,
    [WIZ.step]: 'source',
    [WIZ.presets]: [{ agent: 'claude-code', label: 'Claude Code · ~/.claude/CLAUDE.md', path: '/x/CLAUDE.md', exists: false, error: null, content: '' }],
  }
  const tree = mountCard(injections)
  const wizEl = (tree.children ?? []).find(c => c && typeof c.type === 'function')
  const wiz = wizEl.type({ onClose: () => {}, onDone: () => {}, scopeOptions: ['global'] })
  const source = wiz.children.find(c => c && c.props && c.props.className === 'mem-list')
  assert.ok(source, 'source list present')
  // The paste area lives inside the source list, below the preset rows.
  const paste = findChild(source, 'mem-wiz-src')
  assert.ok(paste, 'paste textarea present')
  assert.equal(paste.props.placeholder, '或直接粘贴记忆内容（CLAUDE.md / AGENTS.md 片段、纯文本清单…）')
})

test('ExportPanel renders scope select, preview area, and copy affordance', () => {
  const injections = {
    [PANEL.data]: { entries: [], trash: [] },
    [PANEL.showExport]: true,
    [EXPORT.text]: '- 样例条目 (tags: a, b)',
    [EXPORT.count]: 1,
  }
  const tree = mountCard(injections)
  const exportEl = (tree.children ?? []).find(c => c && typeof c.type === 'function')
  assert.ok(exportEl, 'export panel mounted')
  const panel = exportEl.type({ onClose: () => {}, scopeOptions: ['global'] })
  assert.equal(panel.props.className, 'mem-wiz')
  const select = findChild(panel, 'mem-add')
  assert.ok(select, 'scope row present')
  const preview = findChild(panel, 'mem-wiz-src')
  assert.ok(preview, 'preview textarea present')
  assert.equal(preview.props.value, '- 样例条目 (tags: a, b)')
  const stat = findChild(panel, 'mem-wiz-stat')
  assert.ok(stat, 'count row present')
})

// Real-React renderToString smoke: proves no render path throws (the
// ReferenceError white-screen class). Optional — skipped when the harness
// checkout (or MEMORY_LITE_REACT_DIR) is not around.
const REACT_DIR_CANDIDATES = [
  process.env.MEMORY_LITE_REACT_DIR,
  '/Users/pacomacpro/Downloads/DeepSeekHarness/deepseek-harness/apps/web/node_modules',
].filter(Boolean)

function resolveRealReact() {
  for (const dir of REACT_DIR_CANDIDATES) {
    try {
      const React = require(join(dir, 'react'))
      const { renderToString } = require(join(dir, 'react-dom', 'server'))
      if (typeof renderToString === 'function') return { React, renderToString }
    } catch { /* try the next candidate */ }
  }
  return null
}

const real = resolveRealReact()
test('renderToString smoke: every card surface renders without throwing', { skip: real === null ? 'real react not found (set MEMORY_LITE_REACT_DIR)' : false }, () => {
  const inertReact = (injections) => {
    let idx = 0
    const base = real.React
    return {
      ...base,
      useState(init) {
        const i = idx++
        const value = i in injections ? injections[i] : (typeof init === 'function' ? init() : init)
        return [value, () => {}]
      },
      useEffect: () => {},
      useCallback: (fn) => fn,
      useRef: (init) => ({ current: init }),
    }
  }
  const mount = (injections) => {
    const def = loadClient()
    const mod = def.factory(() => inertReact(injections))
    let card = null
    mod.apply({
      effect: () => () => {},
      get: (key) => key === 'slots'
        ? { inject: (_slot, register) => register(), register: (_meta, comp) => { card = comp } }
        : null,
    })
    return card({})
  }

  const empty = real.renderToString(mount({ [PANEL.data]: { entries: [], trash: [] } }))
  assert.ok(empty.includes('记忆库') && empty.includes('导入') && empty.includes('导出'))

  const listed = real.renderToString(mount({
    [PANEL.data]: { entries: [{ id: 1, scope: 'global', text: '条目文本', source: 'user', tags: ['x'], created_at: '2026-01-01' }], trash: [] },
  }))
  assert.ok(listed.includes('条目文本') && listed.includes('手动'))

  const wiz = real.renderToString(mount({ [PANEL.data]: { entries: [], trash: [] }, [PANEL.showWiz]: true }))
  assert.ok(wiz.includes('导入记忆') && wiz.includes('① 选择源'))

  const exported = real.renderToString(mount({ [PANEL.data]: { entries: [], trash: [] }, [PANEL.showExport]: true }))
  assert.ok(exported.includes('导出记忆'))

  const result = real.renderToString(mount({
    [PANEL.data]: { entries: [], trash: [] },
    [PANEL.showWiz]: true,
    [WIZ.step]: 'result',
    [WIZ.result]: { imported: [{ id: 1, scope: 'global', text: '样例' }], skipped_unchanged: [], conflicts: 0, conflictReason: null },
  }))
  assert.ok(result.includes('导入 1 条') && result.includes('完成'))
})
