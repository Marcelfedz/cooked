// What a turn is cooking, in plain data: counting, the plan, and the words
// the band, the kitchen and the notifications say. No engine calls here.
import type { Cook, KitchenRow, Step } from '../types'

export const FRESH: Cook = {
  phase: 'ready',
  dish: '',
  startedAt: 0,
  endedAt: 0,
  ops: 0,
  errors: 0,
  cooks: [],
  cooksLaunched: 0,
  activity: '',
  steps: [],
  files: [],
  tools: {},
  isAborted: false,
}

const PLAN_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export const isPlanTool = (tool: string) => PLAN_TOOLS.has(tool)

export const basename = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

export const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, Math.max(1, max - 1))}…` : flat
}

type ToolInput = { tool: string } & Record<string, unknown>

const field = (e: ToolInput, key: string) => {
  const value = e[key]
  return typeof value === 'string' ? value : ''
}

/** A tool call in a few words: what the band shows as the activity. */
export function describeTool(e: ToolInput): string {
  const path = field(e, 'file_path') || field(e, 'notebook_path')
  switch (e.tool) {
    case 'Bash':
      return `$ ${oneLine(field(e, 'description') || field(e, 'command'), 60)}`
    case 'Read':
      return `reading ${basename(path)}`
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `editing ${basename(path)}`
    case 'Write':
      return `writing ${basename(path)}`
    case 'Grep':
    case 'Glob':
      return `searching ${oneLine(field(e, 'pattern'), 40)}`
    case 'WebSearch':
      return `searching the web: ${oneLine(field(e, 'query'), 40)}`
    case 'WebFetch':
      return `fetching ${field(e, 'url').replace(/^https?:\/\//, '').split('/')[0] ?? ''}`
    case 'Agent':
      return `briefing a cook: ${oneLine(field(e, 'description'), 50)}`
    case 'Skill':
      return `using ${field(e, 'skill')}`
    case 'AskUserQuestion':
      return 'waiting on you'
    case 'ToolSearch':
      return 'looking for a tool'
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(e.tool)
      return mcp ? `${mcp[1]} · ${mcp[2]}` : e.tool
    }
  }
}

/** The file a call edits, when it edits one. */
export const editedFile = (e: ToolInput) =>
  EDIT_TOOLS.has(e.tool) ? field(e, 'file_path') || field(e, 'notebook_path') : ''

const isStatus = (value: unknown): value is Step['status'] =>
  value === 'pending' || value === 'in_progress' || value === 'completed'

/** The plan after a TodoWrite: its list replaces the old one. */
export function stepsFromTodos(todos: unknown): Step[] {
  if (!Array.isArray(todos)) return []
  return todos.flatMap(item => {
    if (typeof item !== 'object' || item === null) return []
    const { content, status, activeForm } = item as Record<string, unknown>
    if (typeof content !== 'string' || !isStatus(status)) return []
    return [{ content, status, ...(typeof activeForm === 'string' ? { activeForm } : {}) }]
  })
}

/** The plan after a TaskUpdate: the task changed, or gone when deleted. */
export function stepsAfterUpdate(steps: Step[], e: ToolInput): Step[] {
  const id = field(e, 'taskId')
  const status = e.status
  if (status === 'deleted') return steps.filter(step => step.id !== id)
  return steps.map(step => {
    if (step.id !== id) return step
    return {
      ...step,
      ...(isStatus(status) ? { status } : {}),
      ...(field(e, 'subject') ? { content: field(e, 'subject') } : {}),
      ...(field(e, 'activeForm') ? { activeForm: field(e, 'activeForm') } : {}),
    }
  })
}

export type Progress = { done: number; total: number; step: string }

export function progressOf(steps: readonly Step[]): Progress {
  const total = steps.length
  const done = steps.filter(step => step.status === 'completed').length
  const current = steps.find(step => step.status === 'in_progress')
  return { done, total, step: current ? current.activeForm || current.content : '' }
}

/**
 * How cooked the paella looks: the plan's share when there is one; else it
 * browns slowly with time and never quite finishes until the turn does. The
 * bar, not the paella, is what claims progress.
 */
export function donenessOf(phase: Cook['phase'], progress: Progress, elapsedMs: number): number {
  if (phase === 'cooked') return 1
  if (phase === 'ready') return 0
  if (progress.total > 0) return Math.min(0.95, progress.done / progress.total)
  return 0.9 * (1 - Math.exp(-elapsedMs / 150_000))
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** `12 ops · 2 cooks · 1m 20s`: the turn's tally. */
export function tally(parts: { ops: number; cooks: number; elapsedMs: number; files?: number }): string {
  return [
    plural(parts.ops, 'op', 'ops'),
    parts.cooks > 0 ? plural(parts.cooks, 'cook', 'cooks') : '',
    parts.files ? plural(parts.files, 'file', 'files') : '',
    formatDuration(parts.elapsedMs),
  ]
    .filter(Boolean)
    .join(' · ')
}

export function kitchenRow(cook: Cook, meta: { sessionId: string; name: string; cwd: string; now: number }): KitchenRow {
  const progress = progressOf(cook.steps)
  return {
    sessionId: meta.sessionId,
    name: meta.name,
    cwd: meta.cwd,
    phase: cook.phase,
    dish: oneLine(cook.dish, 140),
    activity: cook.activity,
    step: progress.step,
    startedAt: cook.startedAt,
    endedAt: cook.endedAt,
    ops: cook.ops,
    errors: cook.errors,
    cooks: cook.cooks.length,
    done: progress.done,
    total: progress.total,
    updatedAt: meta.now,
  }
}

/** Parses a kitchen file; undefined when it is not one. */
export function parseRow(text: string): KitchenRow | undefined {
  try {
    const row = JSON.parse(text) as Partial<KitchenRow>
    const isRow =
      typeof row.sessionId === 'string' &&
      typeof row.name === 'string' &&
      typeof row.updatedAt === 'number' &&
      (row.phase === 'ready' || row.phase === 'cooking' || row.phase === 'cooked')
    return isRow ? (row as KitchenRow) : undefined
  } catch {
    return undefined
  }
}

/** Cooking first, then the most recently cooked, then the idle ones. */
export function kitchenOrder(a: KitchenRow, b: KitchenRow): number {
  const rank = (row: KitchenRow) => (row.phase === 'cooking' ? 0 : row.phase === 'cooked' ? 1 : 2)
  return rank(a) - rank(b) || b.endedAt - a.endedAt || a.name.localeCompare(b.name)
}

/** The finish notification: a one-line body, and the long-turn details. */
export function finishText(cook: Cook, elapsedMs: number): { body: string; details: string[] } {
  const mark = cook.errors === 0 ? '✅' : '❌'
  const body = `${tally({ ops: cook.ops, cooks: cook.cooksLaunched, elapsedMs })} · ${mark}`
  const details: string[] = []
  if (cook.dish) details.push(`Asked: "${oneLine(cook.dish, 80)}"`)
  const dirs = new Map<string, number>()
  for (const file of cook.files) {
    const parts = file.split(/[\\/]/)
    const dir = parts.length >= 2 ? parts[parts.length - 2] : undefined
    if (dir) dirs.set(dir, (dirs.get(dir) ?? 0) + 1)
  }
  for (const [dir, count] of [...dirs].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    details.push(`• ${dir}/  — ${plural(count, 'file', 'files')}`)
  }
  const mix = [
    cook.tools.Bash ? `${cook.tools.Bash} bash` : '',
    cook.tools.Read ? `${cook.tools.Read} reads` : '',
    cook.tools.Edit || cook.tools.Write ? `${(cook.tools.Edit ?? 0) + (cook.tools.Write ?? 0)} edits` : '',
  ].filter(Boolean)
  if (mix.length > 0) details.push(`• ${mix.join(' · ')}`)
  if (cook.cooksLaunched > 0) details.push(`• ${plural(cook.cooksLaunched, 'sub-agent', 'sub-agents')}`)
  if (cook.files.length > 0) details.push(`${plural(cook.files.length, 'file', 'files')} modified`)
  return { body, details }
}

/** `claude-opus-5-5` → `opus 5.5`; an alias stays as it is. */
export const shortModel = (model: string) =>
  model.replace(/^claude-/, '').replace(/-(\d+)-(\d+)/, ' $1.$2').replace(/-/g, ' ')

/** 950 → `950`, 12_400 → `12k`, 1_240_000 → `1.2M`. */
export function compactCount(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/** A session's length to the minute: `<1m`, `12m`, `1h 05m`. */
export function formatSpan(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** `███░░░░░░░ 34%`; from 80% on it says so, since compaction is close. */
export function contextBar(percent: number, cells = 10): string {
  const p = Math.max(0, Math.min(100, percent))
  const filled = Math.round((p / 100) * cells)
  return `${'█'.repeat(filled)}${'░'.repeat(cells - filled)} ${Math.round(p)}%${p >= 80 ? ' near full' : ''}`
}

export type StatusFigures = {
  model: string
  contextPercent?: number
  tokensIn: number
  tokensOut: number
  sessionMs: number
  limits: readonly { kind: string; percentUsed: number }[]
  costUsd?: number
}

/**
 * `opus 5.5 · context ███░░░░░░░ 34% · ↑1.2M ↓84k tokens · session 1h 05m · 5h limit 42%`.
 * On a subscription the usage limits say what matters; with an API key, the cost.
 */
export function statusLine(f: StatusFigures): string {
  const limitName = (kind: string) => (kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind.replace(/_/g, ' '))
  return [
    shortModel(f.model),
    f.contextPercent !== undefined ? `context ${contextBar(f.contextPercent)}` : '',
    f.tokensIn || f.tokensOut ? `↑${compactCount(f.tokensIn)} ↓${compactCount(f.tokensOut)} tokens` : '',
    `session ${formatSpan(f.sessionMs)}`,
    ...f.limits.map(limit => `${limitName(limit.kind)} limit ${Math.round(limit.percentUsed)}%`),
    f.limits.length === 0 && f.costUsd !== undefined ? `$${f.costUsd.toFixed(2)}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}
