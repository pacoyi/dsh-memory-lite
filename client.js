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
    const { useState, useEffect, useCallback } = React
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
.mem-add textarea { flex: 1 1 260px; min-height: 56px; resize: vertical; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }
.mem-add input { flex: 0 1 160px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }
.mem-list { display: flex; flex-direction: column; gap: 8px; }
.mem-item { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.mem-item-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.mem-tag { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.mem-meta { flex: 0 0 auto; font-size: 11px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; padding-top: 2px; }
.mem-text { flex: 1 1 auto; font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; }
.mem-del { flex: 0 0 auto; border: none; background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer; font-size: 15px; line-height: 1; padding: 2px 4px; border-radius: 6px; }
.mem-del:hover { color: var(--dsw-alias-fill-danger, #e5484d); }
.mem-empty { padding: 22px 0; text-align: center; font-size: 13px; color: var(--dsw-alias-label-tertiary); }
.mem-err { padding: 8px 12px; border-radius: 8px; font-size: 12px; color: var(--dsw-alias-fill-danger, #e5484d); background: var(--dsw-alias-bg-layer-2); }
    `

    function callRPC(method, args) {
      // Static bundle installs reach the host half over the generic
      // connection RPC bridge: channel '/memory-lite', endpoints list/save/forget.
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

    function MemoryPanel() {
      const [entries, setEntries] = useState(null)
      const [text, setText] = useState('')
      const [tags, setTags] = useState('')
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(null)

      const refresh = useCallback(() => {
        setErr(null)
        callRPC('memory-lite/list', { limit: 50 })
          .then(setEntries)
          .catch((e) => { setEntries([]); setErr(e.message) })
      }, [])

      useEffect(() => { refresh() }, [refresh])

      const add = () => {
        if (!text.trim() || busy) return
        setBusy(true); setErr(null)
        const tagList = tags.split(',').map((s) => s.trim()).filter(Boolean)
        callRPC('memory-lite/save', { text, tags: tagList })
          .then(() => { setText(''); setTags(''); refresh() })
          .catch((e) => setErr(e.message))
          .finally(() => setBusy(false))
      }

      const del = (id) => {
        if (busy) return
        setBusy(true); setErr(null)
        callRPC('memory-lite/forget', { id })
          .then(refresh)
          .catch((e) => setErr(e.message))
          .finally(() => setBusy(false))
      }

      const count = entries?.length ?? 0
      return h('div', { className: 'mem-section' },
        h('div', { className: 'mem-header' },
          h('div', null,
            h('h3', { className: 'mem-title' }, '记忆库'),
            h('p', { className: 'mem-sub' },
              `跨会话记忆（~/.dsh/memory-lite.json）· 最近 ${count} 条 · agent 可在对话中用 memory 工具读写`)),
          h('button', { className: 'mem-btn', onClick: refresh, disabled: busy }, '刷新')),
        err !== null && h('div', { className: 'mem-err' }, err),
        h('div', { className: 'mem-add' },
          h('textarea', {
            placeholder: '新增一条记忆（自包含、具体）…', value: text,
            onChange: (e) => setText(e.target.value),
          }),
          h('input', {
            placeholder: '标签，逗号分隔', value: tags,
            onChange: (e) => setTags(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') add() },
          }),
          h('button', { className: 'mem-btn', onClick: add, disabled: busy || !text.trim() }, busy ? '…' : '保存')),
        entries === null
          ? h('div', { className: 'mem-empty' }, '加载中…')
          : count === 0
            ? h('div', { className: 'mem-empty' }, '暂无记忆条目 —— 在上方添加，或直接在对话里让 agent 记住一件事')
            : h('div', { className: 'mem-list' },
              entries.map((e) => h('div', { key: e.id, className: 'mem-item' },
                h('span', { className: 'mem-meta' }, `#${e.id} · ${fmtTime(e.created_at)}`),
                h('div', { className: 'mem-text' },
                  e.text,
                  e.tags?.length > 0 && h('div', { className: 'mem-item-tags' },
                    e.tags.map((t) => h('span', { key: t, className: 'mem-tag' }, t)))),
                h('button', { className: 'mem-del', title: '删除', onClick: () => del(e.id), disabled: busy }, '✕')))))
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
