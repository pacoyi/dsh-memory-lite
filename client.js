// dsh-memory-lite client half — settings.section UI.
// Self-registers as a lazy CJS module (the dsh browser module-loader pattern):
// the host serves this file over /plugins and the browser materializes it on
// demand. React comes from the loader; nothing else is imported.
window.__ModuleLoader__.load({
  id: 'dsh-memory-lite',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const { useState, useEffect, useCallback, useRef } = React
    const h = React.createElement

    let _ctx = null

    const CSS = `
.mem-section { width: 100%; display: flex; flex-direction: column; gap: 14px; color: var(--dsw-alias-label-primary); }
.mem-header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.mem-title { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
.mem-sub { margin: 2px 0 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.mem-btn { padding: 6px 14px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); border-radius: 8px; cursor: pointer; font: inherit; font-size: 13px; }
.mem-btn:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.mem-btn:disabled { opacity: 0.5; cursor: default; }
.mem-add { display: flex; gap: 8px; flex-wrap: wrap; }
.mem-add textarea { flex: 1 1 240px; min-height: 56px; resize: vertical; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }
.mem-add input { flex: 1 1 150px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }
.mem-add select { flex: 0 1 170px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }
.mem-group-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); padding: 4px 2px 0; }
.mem-group-label code { font-weight: 400; font-size: 11px; }
.mem-list { display: flex; flex-direction: column; gap: 8px; }
.mem-item { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.mem-item.trashed { opacity: 0.75; }
.mem-item-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.mem-tag { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.mem-meta { flex: 0 0 auto; font-size: 11px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; padding-top: 2px; }
.mem-text { flex: 1 1 auto; font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; }
.mem-src { display: inline-block; font-size: 10px; padding: 0 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary); margin-right: 4px; }
.mem-del { flex: 0 0 auto; border: none; background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer; font-size: 15px; line-height: 1; padding: 2px 4px; border-radius: 6px; }
.mem-del:hover { color: var(--dsw-alias-fill-danger, #e5484d); }
.mem-del.confirm { color: #fff; background: var(--dsw-alias-fill-danger, #e5484d); font-size: 11px; padding: 3px 8px; }
.mem-act { flex: 0 0 auto; border: 1px solid var(--dsw-alias-border-l2); background: none; color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 8px; }
.mem-act:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
.mem-act:disabled { opacity: 0.5; cursor: default; }
.mem-act.danger:hover:not(:disabled) { color: var(--dsw-alias-fill-danger, #e5484d); border-color: var(--dsw-alias-fill-danger, #e5484d); }
.mem-empty { padding: 22px 0; text-align: center; font-size: 13px; color: var(--dsw-alias-label-tertiary); }
.mem-err { padding: 8px 12px; border-radius: 8px; font-size: 12px; color: var(--dsw-alias-fill-danger, #e5484d); background: var(--dsw-alias-bg-layer-2); }
.mem-trash-toggle { align-self: flex-start; font-size: 12px; color: var(--dsw-alias-label-secondary); background: none; border: none; cursor: pointer; padding: 2px 0; text-decoration: underline dotted; }
.mem-wiz { display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); }
.mem-wiz-preset { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; }
.mem-wiz-preset-label { flex: 1 1 auto; overflow-wrap: anywhere; }
.mem-wiz-miss { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.mem-wiz-note { font-size: 12px; color: var(--dsw-alias-fill-warn, #f5a524); }
.mem-wiz-src { width: 100%; min-height: 120px; resize: vertical; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; box-sizing: border-box; }
.mem-wiz-stat { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.mem-wiz-stat-acts { display: flex; gap: 6px; }
.mem-wiz-cand { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.mem-wiz-cand.rule { border-color: var(--dsw-alias-fill-warn, #f5a524); }
.mem-wiz-cand input[type=checkbox] { flex: 0 0 auto; margin-top: 3px; }
.mem-wiz-cand-body { flex: 1 1 auto; display: flex; flex-direction: column; gap: 4px; }
.mem-wiz-cand-body textarea { width: 100%; min-height: 48px; resize: vertical; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; box-sizing: border-box; }
    `

    function callRPC(method, args) {
      // Static bundle installs reach the host half over the generic
      // connection RPC bridge: channel '/memory-lite', endpoints
      // list/save/forget/restore/purge.
      const scope = _ctx && typeof _ctx.get === 'function' ? _ctx : null
      if (scope === null) return Promise.reject(new Error('context unavailable'))
      let connection
      try { connection = scope.get('connection') } catch (e) { connection = undefined }
      if (connection === undefined || connection.rpc === undefined) {
        return Promise.reject(new Error('connection service unavailable'))
      }
      const name = String(method)
      const slash = name.indexOf('/')
      const channel = slash === -1 ? name : name.slice(0, slash)
      const endpoint = slash === -1 ? name : name.slice(slash + 1)
      return connection.rpc.call('/' + channel.replace(/^\/+/, ''), endpoint, args).then((res) => {
        if (res && res.ok) return res.value
        throw new Error((res && res.error && res.error.message) || ('RPC ' + method + ' failed'))
      })
    }

    function fmtTime(iso) {
      try {
        const d = new Date(iso)
        const p = (n) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
      } catch (e) { return iso }
    }

    function scopeLabel(scope) {
      return scope === 'global' ? '全局' : scope
    }

    // Three-step import wizard: source (presets + paste) -> per-item
    // curation with rule-like pre-unchecking -> result. A human-driven
    // Settings-card flow — the checked items are the approval, and commit
    // goes through the same locked engine as every other mutation.
    function ImportWizard({ onClose, onDone, scopeOptions }) {
      const [step, setStep] = useState('source')
      const [presets, setPresets] = useState(null)
      const [srcText, setSrcText] = useState('')
      const [srcAgent, setSrcAgent] = useState('manual')
      const [srcPath, setSrcPath] = useState(null) // null = free paste
      const [scope, setScope] = useState('global')
      const [candidates, setCandidates] = useState([])
      const [docDigest, setDocDigest] = useState(null)
      const [checks, setChecks] = useState({}) // idx -> checked
      const [edits, setEdits] = useState({}) // idx -> edited text
      const [batchTags, setBatchTags] = useState('')
      const [result, setResult] = useState(null)
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(null)

      useEffect(() => {
        callRPC('memory-lite/import.presets', {})
          .then((d) => setPresets(d.presets ?? []))
          .catch(() => setPresets([]))
      }, [])

      const usePreset = (p) => {
        setSrcText(p.content ?? '')
        setSrcAgent(p.agent)
        setSrcPath(p.path)
        setErr(null)
      }

      const parse = () => {
        if (!srcText.trim() || busy) return
        setBusy(true); setErr(null)
        callRPC('memory-lite/import.parse', { text: srcText })
          .then((d) => {
            setCandidates(d.candidates ?? [])
            setDocDigest(d.doc_digest ?? null)
            const next = {}
            ;(d.candidates ?? []).forEach((cand, i) => { if (!cand.rule_like) next[i] = true })
            setChecks(next)
            setEdits({})
            setStep('preview')
          })
          .catch((e) => setErr(e.message))
          .finally(() => setBusy(false))
      }

      const commit = () => {
        const idxs = Object.keys(checks).filter((k) => checks[k]).map(Number).sort((a, b) => a - b)
        if (idxs.length === 0 || busy) return
        const tagList = batchTags.split(',').map((s) => s.trim()).filter(Boolean)
        const items = idxs.map((i) => {
          // edited text carries the original digest no more — drop it so the
          // host classifies the fresh text by content instead of skipping it
          const edited = edits[i] !== undefined
          const merged = Array.from(new Set([...(candidates[i].tags ?? []), ...tagList]))
          return {
            text: edited ? edits[i] : candidates[i].text,
            item_digest: edited ? undefined : candidates[i].item_digest,
            tags: merged.length ? merged : undefined,
          }
        })
        setBusy(true); setErr(null)
        callRPC('memory-lite/import.commit', {
          items, scope,
          provenance: {
            source_agent: srcAgent,
            source_path: srcPath ?? undefined,
            doc_digest: docDigest ?? undefined,
          },
        })
          .then((r) => { setResult(r); setStep('result') })
          .catch((e) => setErr(e.message))
          .finally(() => setBusy(false))
      }

      const checkedCount = Object.values(checks).filter(Boolean).length
      const ruleCount = candidates.filter((c) => c.rule_like).length

      return h('div', { className: 'mem-wiz' },
        h('div', { className: 'mem-header' },
          h('div', null,
            h('h3', { className: 'mem-title' }, '导入记忆'),
            h('p', { className: 'mem-sub' },
              step === 'source' ? '① 选择源 —— 探测其他 agent 的记忆文件，或直接粘贴'
                : step === 'preview' ? '② 逐条勾选 —— 规则样文本默认不勾（规则更适合 Skill/工作区指令）'
                  : '③ 完成 —— 结果与去向')),
          h('button', { className: 'mem-btn', onClick: onClose, disabled: busy }, '关闭')),
        err !== null && h('div', { className: 'mem-err' }, err),

        step === 'source' && h('div', { className: 'mem-list' },
          presets === null
            ? h('div', { className: 'mem-empty' }, '探测常见记忆文件…')
            : presets.map((p) => h('div', { key: p.path, className: 'mem-wiz-preset' },
              h('span', { className: 'mem-wiz-preset-label' }, p.label),
              p.error !== null && h('span', { className: 'mem-wiz-note' }, p.error),
              p.error === null && !p.exists && h('span', { className: 'mem-wiz-miss' }, '未检出'),
              p.exists && h('button', { className: 'mem-act', onClick: () => usePreset(p) },
                `使用（${p.content.length} 字符）`))),
          h('textarea', {
            className: 'mem-wiz-src',
            placeholder: '或直接粘贴记忆内容（CLAUDE.md / AGENTS.md 片段、纯文本清单…）',
            value: srcText, onChange: (e) => { setSrcText(e.target.value); setSrcPath(null); setSrcAgent('manual') },
          }),
          h('div', { className: 'mem-add' },
            h('select', { value: scope, onChange: (e) => setScope(e.target.value), title: '导入条目的目标作用域' },
              scopeOptions.map((s) => h('option', { key: s, value: s }, scopeLabel(s)))),
            h('button', { className: 'mem-btn', onClick: parse, disabled: busy || !srcText.trim() },
              busy ? '解析中…' : '解析并预览'))),

        step === 'preview' && h('div', null,
          h('div', { className: 'mem-wiz-stat' },
            h('span', null,
              `共 ${candidates.length} 条候选 · 已勾选 ${checkedCount} 条`
              + (ruleCount > 0 ? ` · ${ruleCount} 条疑似规则（默认未勾）` : '')),
            h('span', { className: 'mem-wiz-stat-acts' },
              h('button', { className: 'mem-act', onClick: () => {
                const all = {}; candidates.forEach((_c, i) => { all[i] = true })
                setChecks(all)
              } }, '全选'),
              h('button', { className: 'mem-act', onClick: () => setChecks({}) }, '清空'))),
          h('div', { className: 'mem-list' },
            candidates.map((cand, i) => h('div', { key: i, className: 'mem-wiz-cand' + (cand.rule_like ? ' rule' : '') },
              h('input', {
                type: 'checkbox', checked: !!checks[i],
                onChange: (e) => setChecks({ ...checks, [i]: e.target.checked }),
              }),
              h('div', { className: 'mem-wiz-cand-body' },
                edits[i] !== undefined
                  ? h('textarea', {
                    value: edits[i],
                    onChange: (e) => setEdits({ ...edits, [i]: e.target.value }),
                  })
                  : h('div', { className: 'mem-text' }, cand.text),
                cand.rule_like && h('div', { className: 'mem-wiz-note' },
                  '指令/规则样文本 —— 若是每次必须执行的规则，更适合存 Skill 或工作区指令，而非语义记忆'),
                h('button', { className: 'mem-act', onClick: () => {
                  if (edits[i] !== undefined) {
                    const next = { ...edits }; delete next[i]
                    setEdits(next) // keep the edited text (empty edit falls back to the original)
                    if (edits[i].trim()) setEdits({ ...next, [i]: edits[i] })
                  } else {
                    setEdits({ ...edits, [i]: cand.text })
                  }
                } }, edits[i] !== undefined ? '完成编辑' : '编辑'))))),
          h('div', { className: 'mem-add' },
            h('input', {
              placeholder: '统一标签（可选，逗号分隔，应用到全部勾选条目）',
              value: batchTags, onChange: (e) => setBatchTags(e.target.value),
            }),
            h('button', { className: 'mem-btn', onClick: commit, disabled: busy || checkedCount === 0 },
              busy ? '导入中…' : `导入 ${checkedCount} 条`),
            h('button', { className: 'mem-btn', onClick: () => setStep('source'), disabled: busy }, '上一步'))),

        step === 'result' && h('div', null,
          h('div', { className: 'mem-wiz-stat' },
            h('span', null,
              `导入 ${(result?.imported ?? []).length} 条`
              + ((result?.skipped_unchanged ?? []).length > 0 ? ` · 跳过 ${result.skipped_unchanged.length} 条（内容已存在）` : '')
              + ((result?.conflicts ?? 0) > 0 ? ` · 冲突 ${result.conflicts} 条（源文件已变更，未导入）` : ''))),
          result?.conflictReason && h('div', { className: 'mem-wiz-note' }, result.conflictReason),
          (result?.imported ?? []).length > 0 && h('div', { className: 'mem-list' },
            result.imported.map((e) => h('div', { key: e.id, className: 'mem-item' },
              h('span', { className: 'mem-meta' }, `#${e.id} · ${scopeLabel(e.scope)}`),
              h('div', { className: 'mem-text' }, e.text)))),
          h('div', { className: 'mem-add' },
            h('button', { className: 'mem-btn', onClick: onDone }, '完成'))))
    }

    // Export panel: read-only render of the live entries as a plain
    // markdown list (whole store or one scope) with copy-to-clipboard. The
    // output pastes into another agent's memory file and re-imports here
    // losslessly — content digests make the round-trip a no-op.
    function ExportPanel({ onClose, scopeOptions }) {
      const [scope, setScope] = useState('all')
      const [text, setText] = useState('')
      const [count, setCount] = useState(0)
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(null)
      const [copied, setCopied] = useState(false)
      const taRef = useRef(null)

      useEffect(() => {
        setBusy(true); setErr(null); setCopied(false)
        callRPC('memory-lite/export.render', { scope })
          .then((d) => { setText(d.text ?? ''); setCount(d.count ?? 0) })
          .catch((e) => setErr(e.message))
          .finally(() => setBusy(false))
      }, [scope])

      const markCopied = () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
      const copy = () => {
        if (!text || busy) return
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(markCopied).catch(() => fallbackCopy())
        } else fallbackCopy()
      }
      const fallbackCopy = () => {
        if (taRef.current) {
          taRef.current.select()
          try { document.execCommand('copy'); markCopied() } catch (e) { setErr('复制失败——请手动全选复制') }
        }
      }

      return h('div', { className: 'mem-wiz' },
        h('div', { className: 'mem-header' },
          h('div', null,
            h('h3', { className: 'mem-title' }, '导出记忆'),
            h('p', { className: 'mem-sub' },
              '纯 markdown 列表——可粘到其他 agent 的记忆文件，也可粘回导入向导（重导入自动跳过已有条目）')),
          h('button', { className: 'mem-btn', onClick: onClose, disabled: busy }, '关闭')),
        err !== null && h('div', { className: 'mem-err' }, err),
        h('div', { className: 'mem-add' },
          h('select', { value: scope, onChange: (e) => setScope(e.target.value), title: '导出的作用域范围' },
            [h('option', { key: 'all', value: 'all' }, '全部作用域')].concat(
              scopeOptions.map((s) => h('option', { key: s, value: s }, scopeLabel(s)))))),
        h('textarea', {
          ref: taRef, className: 'mem-wiz-src', readOnly: true,
          value: busy ? '渲染中…' : (text || '（该范围暂无条目）'),
        }),
        h('div', { className: 'mem-wiz-stat' },
          h('span', null, `${count} 条 · 只含内容与标签，不含 id/来源/时间戳`),
          h('button', { className: 'mem-btn', onClick: copy, disabled: busy || count === 0 },
            copied ? '已复制 ✓' : '复制到剪贴板')))
    }

    function MemoryPanel() {
      const [data, setData] = useState(null) // { entries, trash }
      const [text, setText] = useState('')
      const [tags, setTags] = useState('')
      const [saveScope, setSaveScope] = useState('global')
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(null)
      const [confirmDel, setConfirmDel] = useState(null) // entry id awaiting second click
      const [confirmPurge, setConfirmPurge] = useState(null)
      const [showTrash, setShowTrash] = useState(false)
      const [showWiz, setShowWiz] = useState(false)
      const [showExport, setShowExport] = useState(false)

      useEffect(() => {
        if (confirmDel === null) return undefined
        const t = setTimeout(() => setConfirmDel(null), 3000)
        return () => clearTimeout(t)
      }, [confirmDel])
      useEffect(() => {
        if (confirmPurge === null) return undefined
        const t = setTimeout(() => setConfirmPurge(null), 3000)
        return () => clearTimeout(t)
      }, [confirmPurge])

      const refresh = useCallback(() => {
        setErr(null)
        callRPC('memory-lite/list', {})
          .then((d) => setData({ entries: d.entries ?? [], trash: d.trash ?? [] }))
          .catch((e) => { setData({ entries: [], trash: [] }); setErr(e.message) })
      }, [])

      useEffect(() => { refresh() }, [refresh])

      const add = () => {
        if (!text.trim() || busy) return
        setBusy(true); setErr(null)
        const tagList = tags.split(',').map((s) => s.trim()).filter(Boolean)
        callRPC('memory-lite/save', { text, tags: tagList, scope: saveScope })
          .then(() => { setText(''); setTags(''); refresh() })
          .catch((e) => setErr(e.message))
          .finally(() => setBusy(false))
      }

      const del = (id) => {
        if (busy) return
        if (confirmDel !== id) { setConfirmDel(id); return } // first click arms, second confirms
        setBusy(true); setErr(null); setConfirmDel(null)
        callRPC('memory-lite/forget', { id })
          .then(refresh)
          .catch((e) => setErr(e.message))
          .finally(() => setBusy(false))
      }

      const restore = (id) => {
        if (busy) return
        setBusy(true); setErr(null)
        callRPC('memory-lite/restore', { id })
          .then(refresh)
          .catch((e) => setErr(e.message))
          .finally(() => setBusy(false))
      }

      const purge = (id) => {
        if (busy) return
        if (confirmPurge !== id) { setConfirmPurge(id); return }
        setBusy(true); setErr(null); setConfirmPurge(null)
        callRPC('memory-lite/purge', { id })
          .then(refresh)
          .catch((e) => setErr(e.message))
          .finally(() => setBusy(false))
      }

      const entries = data?.entries ?? []
      const trash = data?.trash ?? []
      const scopes = Array.from(new Set(entries.map((e) => e.scope)))
      const scopeOrder = ['global', ...scopes.filter((s) => s !== 'global').sort()]
      const count = entries.length

      return h('div', { className: 'mem-section' },
        h('div', { className: 'mem-header' },
          h('div', null,
            h('h3', { className: 'mem-title' }, '记忆库'),
            h('p', { className: 'mem-sub' },
              `${count} 条活跃 · ${trash.length} 条回收站 · 按项目目录隔离 · agent 写入需审批 · 全部变更记入审计日志`)),
          h('div', { className: 'mem-add' },
            h('button', { className: 'mem-btn', onClick: () => setShowWiz(true) }, '导入'),
            h('button', { className: 'mem-btn', onClick: () => setShowExport(!showExport) }, '导出'),
            h('button', { className: 'mem-btn', onClick: refresh, disabled: busy }, '刷新'))),
        err !== null && h('div', { className: 'mem-err' }, err),
        showExport && h(ExportPanel, {
          onClose: () => setShowExport(false),
          scopeOptions: scopeOrder,
        }),
        showWiz
          ? h(ImportWizard, {
            onClose: () => setShowWiz(false),
            onDone: () => { setShowWiz(false); refresh() },
            scopeOptions: scopeOrder,
          })
          : h('div', null,
            h('div', { className: 'mem-add' },
          h('textarea', {
            placeholder: '新增一条记忆（自包含、具体）…', value: text,
            onChange: (e) => setText(e.target.value),
          }),
          h('input', {
            placeholder: '标签，逗号分隔', value: tags,
            onChange: (e) => setTags(e.target.value),
          }),
          h('select', { value: saveScope, onChange: (e) => setSaveScope(e.target.value), title: '记忆归属的作用域' },
            scopeOrder.map((s) => h('option', { key: s, value: s }, scopeLabel(s)))),
          h('button', { className: 'mem-btn', onClick: add, disabled: busy || !text.trim() }, busy ? '…' : '保存')),
        data === null
          ? h('div', { className: 'mem-empty' }, '加载中…')
          : count === 0
            ? h('div', { className: 'mem-empty' }, '暂无记忆条目 —— 在上方添加，或直接在对话里让 agent 记住一件事')
            : h('div', { className: 'mem-list' },
              scopeOrder
                .filter((s) => entries.some((e) => e.scope === s))
                .map((s) => h('div', { key: s },
                  h('div', { className: 'mem-group-label' }, '作用域：', h('code', null, scopeLabel(s))),
                  entries
                    .filter((e) => e.scope === s)
                    .map((e) => h('div', { key: e.id, className: 'mem-item' },
                      h('span', { className: 'mem-meta' }, `#${e.id} · ${fmtTime(e.created_at)}`),
                      h('div', { className: 'mem-text' },
                        h('span', { className: 'mem-src', title: '来源' }, e.source === 'user' ? '手动' : 'agent'),
                        e.text,
                        e.tags?.length > 0 && h('div', { className: 'mem-item-tags' },
                          e.tags.map((t) => h('span', { key: t, className: 'mem-tag' }, t)))),
                      h('button', {
                        className: 'mem-del' + (confirmDel === e.id ? ' confirm' : ''),
                        title: confirmDel === e.id ? '再次点击确认移入回收站' : '移入回收站（可恢复）',
                        onClick: () => del(e.id), disabled: busy,
                      }, confirmDel === e.id ? '确认?' : '✕')))))),
        trash.length > 0 && h('button', { className: 'mem-trash-toggle', onClick: () => setShowTrash(!showTrash) },
          showTrash ? '收起回收站' : `回收站（${trash.length}）`),
        showTrash && trash.length > 0 && h('div', { className: 'mem-list' },
          trash.map((e) => h('div', { key: e.id, className: 'mem-item trashed' },
            h('span', { className: 'mem-meta' }, `#${e.id} · 删于 ${fmtTime(e.deleted_at)}`),
            h('div', { className: 'mem-text' },
              h('span', { className: 'mem-src', title: '来源' }, e.source === 'user' ? '手动' : 'agent'),
              e.text),
            h('button', { className: 'mem-act', onClick: () => restore(e.id), disabled: busy }, '恢复'),
            h('button', {
              className: 'mem-act danger', onClick: () => purge(e.id), disabled: busy,
              title: confirmPurge === e.id ? '再次点击确认永久删除' : '永久删除（不可恢复）',
            }, confirmPurge === e.id ? '确认永久删除?' : '永久删除'))))))
    }

    function apply(ctx) {
      _ctx = ctx
      ctx.effect(() => {
        const el = document.createElement('style')
        el.setAttribute('data-plugin', 'dsh-memory-lite')
        el.textContent = CSS
        document.head.appendChild(el)
        return () => { el.remove() }
      }, 'memory-lite: styles')
      let slots = null
      try { slots = typeof ctx.get === 'function' ? ctx.get('slots') : null } catch (e) { slots = null }
      if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
        console.warn('[memory-lite] settings.section slot unavailable')
        return
      }
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'memory-lite', order: 30, label: () => '记忆库' },
        (props) => h(MemoryPanel, props),
      ))
    }

    const _plugin = { inject: ['slots'], apply }
    exports.apply = function applyCtx(ctx) { _ctx = ctx; return _plugin.apply(ctx) }
    exports.inject = _plugin.inject
    return module.exports
  }
})
