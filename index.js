/**
 * dsh-memory-lite — lightweight cross-session memory for DeepSeek Harness.
 *
 * Registers one `memory` tool with four operations (save / recall / list /
 * forget). Entries persist as plain JSON at ~/.dsh/memory-lite.json so they
 * survive restarts, upgrades, and profile changes. No server, no index —
 * substring matching keeps the dependency footprint at zero.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-memory-lite'
export const inject = ['tools']

const STORE = join(homedir(), '.dsh', 'memory-lite.json')

async function loadStore() {
  try {
    const data = JSON.parse(await readFile(STORE, 'utf8'))
    if (Array.isArray(data.entries)) return data
  } catch { /* missing or corrupt — start fresh */ }
  return { version: 1, entries: [] }
}

async function saveStore(store) {
  await mkdir(join(homedir(), '.dsh'), { recursive: true })
  await writeFile(STORE, JSON.stringify(store, null, 2) + '\n', 'utf8')
}

function fmt(e) {
  const tags = e.tags?.length ? ` [${e.tags.join(', ')}]` : ''
  return `#${e.id} (${e.created_at})${tags} ${e.text}`
}

function renderText(value) {
  if (value.error) return `memory: error — ${value.error}`
  if (value.operation === 'save') return `memory: saved ${fmt(value.entry)}`
  if (value.operation === 'forget') return `memory: forgot ${fmt(value.entry)}`
  const { entries } = value
  if (!entries.length) return 'memory: no entries'
  return `memory: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}\n` + entries.map(fmt).join('\n')
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'memory',
    description:
      'Cross-session persistent memory. save: record durable facts (user preferences, project decisions, key constraints). ' +
      'recall: retrieve entries by keyword or tag — do this at the start of a session or before decisions that may ' +
      'depend on earlier context. list: browse recent entries. forget: delete an entry by id. ' +
      'Prefer specific, self-contained notes over transcripts.',
    parameters: {
      operation: {
        type: 'string',
        enum: ['save', 'recall', 'list', 'forget'],
        required: true,
        description: "Which memory operation to run: 'save', 'recall', 'list', or 'forget'.",
      },
      text: {
        type: 'string',
        description: "For save: the note to remember, self-contained and specific.",
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tags for save (e.g. ["preference", "project-x"]).',
      },
      query: {
        type: 'string',
        description: 'For recall: keyword matched case-insensitively against text and tags.',
      },
      tag: {
        type: 'string',
        description: 'For recall: match entries carrying this exact tag.',
      },
      limit: {
        type: 'integer',
        description: 'For list/recall: max entries to return (default 10, max 100).',
      },
      id: {
        type: 'integer',
        description: 'For forget: the entry id to delete.',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderText(value) }],
    },
    execute: async args => {
      try {
        const store = await loadStore()
        const entries = store.entries
        if (args.operation === 'save') {
          if (!args.text?.trim()) return { operation: 'save', error: 'text is required for save' }
          const entry = {
            id: entries.reduce((m, e) => Math.max(m, e.id), 0) + 1,
            text: args.text.trim(),
            tags: args.tags ?? [],
            created_at: new Date().toISOString(),
          }
          entries.push(entry)
          await saveStore(store)
          return { operation: 'save', entry }
        }
        if (args.operation === 'forget') {
          const idx = entries.findIndex(e => e.id === args.id)
          if (idx === -1) return { operation: 'forget', error: `no entry with id ${args.id}` }
          const [entry] = entries.splice(idx, 1)
          await saveStore(store)
          return { operation: 'forget', entry }
        }
        if (args.operation === 'recall') {
          const limit = Math.max(1, Math.min(args.limit ?? 10, 100))
          let hits = entries
          if (args.tag) hits = hits.filter(e => e.tags?.includes(args.tag))
          if (args.query) {
            const q = args.query.toLowerCase()
            hits = hits.filter(e => e.text.toLowerCase().includes(q) || e.tags?.some(t => t.toLowerCase().includes(q)))
          }
          return { operation: 'recall', entries: hits.slice(-limit).reverse() }
        }
        // list
        const limit = Math.max(1, Math.min(args.limit ?? 10, 100))
        return { operation: 'list', entries: entries.slice(-limit).reverse() }
      } catch (err) {
        return { operation: args.operation, error: String(err?.message ?? err) }
      }
    },
  }))

  // RPC bridge: expose list/save/forget to the browser half (settings UI),
  // following the dsh-plugin-usage static-bundle pattern: the `connection`
  // service is provided asynchronously by the client-connection plugin.
  const handlers = new Map()
  handlers.set('list', async (args = {}) => {
    const limit = Math.max(1, Math.min(args.limit ?? 50, 100))
    const store = await loadStore()
    return store.entries.slice(-limit).reverse()
  })
  handlers.set('save', async (args = {}) => {
    if (!args.text?.trim()) throw new Error('text is required')
    const store = await loadStore()
    const entry = {
      id: store.entries.reduce((m, e) => Math.max(m, e.id), 0) + 1,
      text: args.text.trim(),
      tags: args.tags ?? [],
      created_at: new Date().toISOString(),
    }
    store.entries.push(entry)
    await saveStore(store)
    return entry
  })
  handlers.set('forget', async (args = {}) => {
    const store = await loadStore()
    const idx = store.entries.findIndex(e => e.id === args.id)
    if (idx === -1) throw new Error(`no entry with id ${args.id}`)
    const [entry] = store.entries.splice(idx, 1)
    await saveStore(store)
    return entry
  })
  ctx.inject(['connection'], (connectionCtx) => {
    const connection = connectionCtx.connection
    if (connection === undefined || connection.rpc === undefined || typeof connection.rpc.handle !== 'function') {
      console.warn('[memory-lite] connection RPC surface unavailable — settings UI will not load data')
      return
    }
    // rc.7 API: handle(channel, handler, options) — options.authority is required;
    // 'loopback' trusts only same-machine requests (empty trust list).
    connection.rpc.handle('/memory-lite', async (endpoint, payload) => {
      const fn = handlers.get(endpoint)
      if (fn === undefined) {
        return { ok: false, error: { code: 'bad-request', message: `unknown endpoint: ${endpoint}`, details: { issues: [] } } }
      }
      try {
        return { ok: true, value: await fn(payload) }
      } catch (err) {
        return { ok: false, error: { code: 'internal', message: String(err?.message ?? err), details: { issues: [] } } }
      }
    }, { authority: 'loopback' })
  })
}
