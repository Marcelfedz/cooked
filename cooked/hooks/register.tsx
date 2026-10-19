import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, Timer } from 'claude-code'

import type { Cook, KitchenRow } from '../types'
import {
  FRESH,
  basename,
  describeTool,
  donenessOf,
  editedFile,
  finishText,
  formatDuration,
  isPlanTool,
  kitchenOrder,
  kitchenRow,
  oneLine,
  parseRow,
  progressOf,
  stepsAfterUpdate,
  statusLine,
  stepsFromTodos,
  tally,
} from './cook'
import { barCells, encodeCells, paellaPixels, pixelsToCells } from './paella'

const PANE = 'cooked-kitchen'
const TICK_MS = 150
const TICKS_PER_SECOND = 7
const HEARTBEAT_MS = 15_000
const STALE_MS = 45_000
const PAELLA_BAND = { columns: 20, rows: 6 }
const PAELLA_PANE = { columns: 32, rows: 10 }
const STATUS_MS = 15_000
// Said beside the bar when Claude keeps no task list: the bar then pulses and claims no share.
const NO_PLAN = ' no task list'
// The session line's colour: the theme's own blue (what Claude Code draws inline code in), so it follows the theme.
const SESSION = 'permission'

const cook = atom({ plugin: 'cooked', key: 'cook' } as const, FRESH)
const name = atom({ plugin: 'cooked', key: 'name' } as const, '')
const kitchen = atom({ plugin: 'cooked', key: 'kitchen' } as const, [])
const now = atom({ plugin: 'cooked', key: 'now' } as const, 0)
const tokens = atom({ plugin: 'cooked', key: 'tokens' } as const, { in: 0, out: 0 })
const status = atom({ plugin: 'cooked', key: 'status' } as const, '')

type $ = EngineInterface
type ToolInput = { tool: string } & Record<string, unknown>
type RasterTag = Elements['terminal']['Raster']
type BarLook = { fraction: number | null; isCooking: boolean; hasErrors?: boolean }
type Notifier = 'terminal-notifier' | 'osascript' | 'notify-send' | 'engine'

/** A Raster a render hook drew, kept so the ticker can repaint it. */
type Mounted = {
  requestId: string
  key: string
  columns: number
  rows: number
  draw: (frame: number) => Uint32Array
}

// What the module holds between hooks. It starts over on a hot reload, and
// session.start fills it again; what must survive lives in $.state.
const live = {
  isOn: false,
  cwd: '',
  dir: '',
  sessionId: '',
  mirror: FRESH,
  label: '',
  isPaneOpen: false,
  ticker: undefined as Timer | undefined,
  isTicking: false,
  frame: 0,
  lastPublish: 0,
  lastGathered: '',
  lastStatus: '',
  notifier: 'engine' as Notifier,
  tzOffsetMs: 0,
  thresholdMs: 120_000,
  isNotifying: true,
  sites: new Map<string, Mounted[]>(),
}

async function setCook($: $, change: (value: Cook) => Cook): Promise<Cook> {
  live.mirror = await update($, cook, change)
  return live.mirror
}

async function run($: $, argv: string[]) {
  return $.process.run(argv, { timeoutMs: 5000 }).catch(() => undefined)
}

/** Starts a command and lets it outlive the call: a sticky alert waits for a click. */
async function detach($: $, argv: string[]) {
  return run($, ['/bin/sh', '-c', '"$@" >/dev/null 2>&1 &', 'sh', ...argv])
}

async function has($: $, command: string) {
  return (await run($, ['/bin/sh', '-c', 'command -v "$1"', 'sh', command]))?.exitCode === 0
}

// The kitchen: every terminal writes its own row to a file; the pane reads them all.

async function publish($: $, isForced = false) {
  if (!live.dir) return
  const at = await $.clock.now()
  if (!isForced && at - live.lastPublish < 900) return
  live.lastPublish = at
  const id = await $.session.id()
  if (live.sessionId && id !== live.sessionId) await run($, ['rm', '-f', `${live.dir}/${live.sessionId}.json`])
  live.sessionId = id
  const row = kitchenRow(live.mirror, { sessionId: id, name: live.label, cwd: live.cwd, now: at })
  await $.fs.write(`${live.dir}/${id}.json`, JSON.stringify(row)).catch(() => undefined)
}

async function gather($: $) {
  if (!live.dir) return
  const at = await $.clock.now()
  const entries = await $.fs.list(live.dir).catch(() => [])
  const rows: KitchenRow[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    if (entry.name === `${live.sessionId}.json` || at - entry.mtimeMs > STALE_MS) continue
    const row = parseRow(await $.fs.read(`${live.dir}/${entry.name}`).catch(() => ''))
    if (row) rows.push(row)
  }
  rows.sort(kitchenOrder)
  const seen = JSON.stringify(rows)
  if (seen === live.lastGathered) return
  live.lastGathered = seen
  await update($, kitchen, () => rows)
}

// The ticker: repaints the paellas and bars, and once a second the words.

async function isAnyoneCooking($: $) {
  if (live.mirror.phase === 'cooking') return true
  return live.isPaneOpen && (await read($, kitchen)).some(row => row.phase === 'cooking')
}

async function tick($: $) {
  if (live.isTicking) return
  live.isTicking = true
  try {
    live.frame += 1
    for (const [requestId, mounted] of live.sites) {
      for (const raster of mounted) {
        const cells = encodeCells(raster.draw(live.frame))
        const blitted = await $.ui.blit({ requestId, key: raster.key, columns: raster.columns, rows: raster.rows, cells })
        if (blitted.deny !== undefined) live.sites.delete(requestId)
      }
    }
    if (live.frame % TICKS_PER_SECOND === 0) {
      const seconds = Math.floor((await $.clock.now()) / 1000)
      await update($, now, () => seconds)
      if (live.mirror.phase === 'cooking') await publish($)
      if (live.isPaneOpen) await gather($)
      await refreshStatus($)
      if (!live.isPaneOpen && !(await isAnyoneCooking($))) stopTicker()
    }
  } finally {
    live.isTicking = false
  }
}

function startTicker($: $) {
  if (live.ticker || !live.isOn) return
  live.ticker = $.clock.every(TICK_MS, () => void tick($))
}

function stopTicker() {
  live.ticker?.cancel()
  live.ticker = undefined
}

// The finish notification, as v2 sent it: a banner, or a sticky alert after a long turn.

async function serve($: $, done: Cook) {
  if (!live.isNotifying || done.isAborted) return
  const elapsed = done.endedAt - done.startedAt
  const { body, details } = finishText(done, elapsed)
  const isLong = elapsed >= live.thresholdMs
  const subtitle = `${live.label} · Cooked!`
  const clock = new Date(done.endedAt + live.tzOffsetMs).toISOString().slice(11, 16)
  if (isLong && (live.notifier === 'osascript' || live.notifier === 'terminal-notifier')) {
    const message = [`Cooked! — ${body}`, `finished ${clock}`, '', ...details].join('\n')
    await detach($, [
      'osascript',
      '-e', 'on run argv',
      '-e', 'display alert (item 1 of argv) message (item 2 of argv) as informational',
      '-e', 'end run',
      `Claude Code 🥘 ${live.label}`,
      message,
    ])
    return
  }
  if (live.notifier === 'terminal-notifier') {
    const icon = `${$.plugin.root}/assets/cooked.jpeg`
    await detach($, ['terminal-notifier', '-title', 'Claude Code', '-subtitle', subtitle, '-message', body, '-appIcon', icon, '-sound', 'Ping'])
  } else if (live.notifier === 'osascript') {
    await detach($, [
      'osascript',
      '-e', 'on run argv',
      '-e', 'display notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv) sound name "Ping"',
      '-e', 'end run',
      body,
      'Claude Code',
      subtitle,
    ])
  } else if (live.notifier === 'notify-send') {
    const text = isLong ? [`${subtitle} — ${body}`, '', ...details].join('\n') : `${subtitle} — ${body}`
    await detach($, ['notify-send', ...(isLong ? ['-u', 'critical'] : []), 'Claude Code', text])
  } else {
    await $.ui.notify(`${subtitle} — ${body}`, { title: 'Claude Code' }).catch(() => undefined)
  }
}

async function setUp($: $, cwd: string) {
  live.cwd = cwd
  live.mirror = await read($, cook)
  live.label = (await read($, name)) || (await update($, name, () => basename(cwd)))

  await $.command.register({
    name: 'cooked',
    description: 'Open the kitchen: every terminal and what it is cooking',
    argumentHint: '[name <terminal name>]',
  })

  const home = await $.env.get('HOME')
  if (home) live.dir = `${home}/.claude/cooked/kitchen`
  const threshold = Number((await $.env.get('COOKED_ALERT_THRESHOLD')) ?? (await $.env.get('PAELLA_ALERT_THRESHOLD')))
  if (Number.isFinite(threshold) && threshold > 0) live.thresholdMs = threshold * 1000
  live.isNotifying = (await $.env.get('COOKED_NOTIFY')) !== 'off'

  const system = (await run($, ['uname']))?.stdout.trim()
  if (system === 'Darwin') live.notifier = (await has($, 'terminal-notifier')) ? 'terminal-notifier' : 'osascript'
  else if (system === 'Linux' && (await has($, 'notify-send'))) live.notifier = 'notify-send'
  const zone = /^([+-])(\d\d)(\d\d)$/.exec((await run($, ['date', '+%z']))?.stdout.trim() ?? '')
  if (zone) live.tzOffsetMs = (zone[1] === '-' ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3])) * 60_000

  if (live.dir) {
    await run($, ['find', live.dir, '-name', '*.json', '-mmin', '+720', '-delete'])
    await publish($, true)
    $.clock.every(HEARTBEAT_MS, () => void publish($, true))
  }
  live.isPaneOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
  if (live.mirror.phase === 'cooking' || live.isPaneOpen) startTicker($)
  $.ui.status(undefined) // the line an earlier version pinned under the prompt
  void refreshStatus($) // never holds the first prompt
  $.clock.every(STATUS_MS, () => void refreshStatus($))
}

/**
 * The session line at the foot of the band: model, context, the session's tokens, its time and the
 * usage limits. Drawn by the band, not `$.ui.status`, whose colour is the engine's (a warning yellow).
 */
async function refreshStatus($: $) {
  if (!live.isOn) return
  try {
    const [usage, model, at, used] = await Promise.all([$.session.usage(), $.session.model(), $.clock.now(), read($, tokens)])
    const text = statusLine({
      model,
      contextPercent: usage.context.percent,
      tokensIn: used.in,
      tokensOut: used.out,
      sessionMs: at - usage.startedAt,
      limits: usage.rateLimits,
      costUsd: usage.cost?.usd,
    })
    if (text === live.lastStatus) return
    live.lastStatus = text
    await update($, status, () => text)
  } catch {
    // A figure the host cannot give yet; the next tick tries again.
  }
}

async function trackPlan($: $, e: ToolInput, result: unknown) {
  if (e.tool === 'TodoWrite') {
    const steps = stepsFromTodos(e.todos)
    await setCook($, c => ({ ...c, steps }))
  } else if (e.tool === 'TaskCreate') {
    const task = (result as { task?: { id?: unknown } } | undefined)?.task
    const content = typeof e.subject === 'string' ? e.subject : ''
    const activeForm = typeof e.activeForm === 'string' ? e.activeForm : ''
    if (typeof task?.id === 'string' && content) {
      const id = task.id
      await setCook($, c => ({
        ...c,
        steps: [...c.steps, { id, content, status: 'pending', ...(activeForm ? { activeForm } : {}) }],
      }))
    }
  } else if (e.tool === 'TaskUpdate') {
    await setCook($, c => ({ ...c, steps: stepsAfterUpdate(c.steps, e) }))
  }
}

async function openKitchen($: $) {
  const opened = await $.ui.open({ id: PANE, title: 'Kitchen' })
  live.isPaneOpen = true
  await gather($)
  startTicker($)
  return opened.isPlaced ? 'Kitchen open.' : `The kitchen opens when there is room: ${opened.reason}`
}

/** The paella, kept in `mounted` while it cooks so the ticker animates it. */
function paella(Raster: RasterTag, mounted: Mounted[], requestId: string, size: { columns: number; rows: number }, doneness: number, isCooking: boolean) {
  const { columns, rows } = size
  const draw = (frame: number) =>
    pixelsToCells(paellaPixels(columns, rows * 2, { doneness, frame, isCooking }), columns, rows * 2)
  if (isCooking) mounted.push({ requestId, key: 'paella', columns, rows, draw })
  return <Raster key="paella" columns={columns} rows={rows} cells={encodeCells(draw(live.frame))} />
}

/** One progress bar, kept in `mounted` while it cooks so the ticker animates it. */
function bar(Raster: RasterTag, mounted: Mounted[], requestId: string, key: string, columns: number, look: BarLook) {
  const draw = (frame: number) => barCells(columns, { ...look, frame })
  if (look.isCooking) mounted.push({ requestId, key, columns, rows: 1, draw })
  return <Raster key={key} columns={columns} rows={1} cells={encodeCells(draw(live.frame))} />
}

/** A bar in plain text, for surfaces that draw no Raster. */
function textBar(columns: number, fraction: number | null): string {
  if (fraction === null) return '━'.repeat(columns)
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * columns)
  return `${'━'.repeat(filled)}${'─'.repeat(columns - filled)}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    live.isOn = e.isInteractive
    if (live.isOn) await setUp($, e.cwd)
    return started
  })

  on('session.end', async ($, e, next) => {
    if (live.dir) await run($, ['rm', '-f', `${live.dir}/${e.sessionId}.json`])
    if (e.reason === 'clear') {
      await setCook($, () => FRESH)
      await update($, tokens, () => ({ in: 0, out: 0 }))
      live.sessionId = ''
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!live.isOn) return next(e)
    const agentId = e.agentId
    if (agentId !== undefined) {
      await setCook($, c =>
        c.cooks.includes(agentId) ? c : { ...c, cooks: [...c.cooks, agentId], cooksLaunched: c.cooksLaunched + 1 },
      )
      return next(e)
    }
    const at = await $.clock.now()
    await setCook($, c => ({
      ...FRESH,
      phase: 'cooking',
      dish: e.text.trim() || c.dish,
      startedAt: at,
      cooks: c.cooks,
      // A plan still open carries over to the next prompt; a finished one does not.
      steps: c.steps.some(step => step.status !== 'completed') ? c.steps : [],
    }))
    await update($, now, () => Math.floor(at / 1000))
    void publish($, true)
    startTicker($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!live.isOn) return next(e)
    const spent = e.usage
    if (spent) {
      await update($, tokens, t => ({
        in: t.in + spent.input_tokens + spent.cache_read_input_tokens + spent.cache_creation_input_tokens,
        out: t.out + spent.output_tokens,
      }))
      void refreshStatus($)
    }
    const agentId = e.agentId
    if (agentId !== undefined) {
      await setCook($, c => ({ ...c, cooks: c.cooks.filter(id => id !== agentId) }))
      return next(e)
    }
    const at = await $.clock.now()
    const done = await setCook($, c => ({
      ...c,
      phase: 'cooked',
      endedAt: at,
      startedAt: c.startedAt || at - e.durationMs,
      isAborted: e.isAborted,
    }))
    void publish($, true)
    void serve($, done)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (!live.isOn) return next(e)
    const input = e as unknown as ToolInput
    const isMain = e.agentId === undefined
    const file = editedFile(input)
    await setCook($, c => ({
      ...c,
      ops: c.ops + 1,
      activity: isPlanTool(e.tool) ? c.activity : `${isMain ? '' : 'cook · '}${describeTool(input)}`,
      tools: { ...c.tools, [e.tool]: (c.tools[e.tool] ?? 0) + 1 },
      files: file && !c.files.includes(file) ? [...c.files, file] : c.files,
    }))

    const ran = await next(e)

    if (ran.isError) await setCook($, c => ({ ...c, errors: c.errors + 1 }))
    else if (isMain && ran.deny === undefined) await trackPlan($, input, ran.result)
    return ran
  }).catch(($, e, next) => next(e)) // a meter never blocks a tool: on a failure the call goes on, once

  on('command.run', { command: 'cooked' }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(/\s+/)
    if (verb === 'name') {
      live.label = await update($, name, () => oneLine(rest.join(' '), 40) || basename(live.cwd))
      await publish($, true)
      return { text: `This terminal is now "${live.label}".` }
    }
    if (verb) return { text: 'Usage: /cooked opens or closes the kitchen · /cooked name <name> renames this terminal' }
    if (live.isPaneOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'Kitchen closed.' }
    }
    return { text: await openKitchen($) }
  })

  on('ui.close', ($, e, next) => {
    if (e.id === PANE) {
      live.isPaneOpen = false
      live.sites.delete(PANE)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The band above the prompt: this terminal's name, its bar and its paella.

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!live.isOn || e.props.hasSurvey) return next(e)
    const c = await read($, cook)
    const title = (await read($, name)) || basename(live.cwd)
    const nowMs = (await read($, now)) * 1000
    const width = e.props.bodyColumns
    const progress = progressOf(c.steps)
    const fraction = progress.total > 0 ? progress.done / progress.total : null
    const table = $.ui.resolve(e)
    const { Box, Text } = table
    const Raster = 'Raster' in table ? table.Raster : undefined
    const mounted: Mounted[] = []
    live.sites.set(e.requestId, mounted)
    const session = await read($, status)
    const sessionLine = session ? <Text color={SESSION} wrap="truncate-end">{session}</Text> : null

    if (c.phase === 'ready') {
      return (
        <Box flexDirection="column">
          <Box>
            <Text bold>{title}</Text>
            <Text dimColor>  ready to cook · /cooked opens the kitchen</Text>
          </Box>
          {sessionLine}
        </Box>
      )
    }

    if (c.phase === 'cooked') {
      const elapsed = c.endedAt - c.startedAt
      const verdict = c.isAborted ? `stopped after ${formatDuration(elapsed)}` : `cooked in ${formatDuration(elapsed)}`
      const extra = [
        `${c.ops} ops`,
        c.files.length > 0 ? `${c.files.length} files` : '',
        c.cooks.length > 0 ? `${c.cooks.length} cooks still going` : '',
        c.errors > 0 ? `${c.errors} errors` : '',
      ].filter(Boolean)
      const columns = Math.max(4, Math.min(12, width - title.length - 50))
      return (
        <Box flexDirection="column">
          <Box>
            <Text bold>{title}</Text>
            <Text>  </Text>
            {Raster ? (
              bar(Raster, mounted, e.requestId, 'bar', columns, { fraction: 1, isCooking: false, hasErrors: c.errors > 0 })
            ) : (
              <Text dimColor>{textBar(columns, 1)}</Text>
            )}
            <Text dimColor wrap="truncate-end"> {verdict} · {extra.join(' · ')}</Text>
          </Box>
          {sessionLine}
        </Box>
      )
    }

    const elapsed = Math.max(0, nowMs - c.startedAt)
    const doneness = donenessOf(c.phase, progress, elapsed)
    const counter = progress.total > 0 ? `${progress.done}/${progress.total}` : ''
    const doing = progress.step || c.activity || 'warming up'
    const stats = tally({ ops: c.ops, cooks: c.cooks.length, elapsedMs: elapsed })
    const rightOfPaella = Raster ? width - PAELLA_BAND.columns - 2 : width
    const barColumns = Math.max(6, Math.min(48, rightOfPaella - title.length - 2 - (counter ? counter.length + 1 : NO_PLAN.length) - 1))

    const words = (
      <Box flexDirection="column" flexGrow={1}>
        <Box>
          <Text bold>{title}</Text>
          <Text>  </Text>
          {Raster ? (
            bar(Raster, mounted, e.requestId, 'bar', barColumns, { fraction, isCooking: true, hasErrors: c.errors > 0 })
          ) : (
            <Text dimColor>{textBar(barColumns, fraction)}</Text>
          )}
          {counter ? <Text> {counter}</Text> : <Text dimColor>{NO_PLAN}</Text>}
        </Box>
        <Text wrap="truncate-end">▸ {doing}</Text>
        <Text dimColor wrap="truncate-end">
          {stats}
          {progress.step && c.activity ? ` · ${c.activity}` : ''}
        </Text>
        {c.dish ? <Text dimColor italic wrap="truncate-end">“{oneLine(c.dish, 200)}”</Text> : null}
        {sessionLine}
      </Box>
    )

    if (!Raster) return words
    return (
      <Box>
        {paella(Raster, mounted, e.requestId, PAELLA_BAND, doneness, true)}
        <Box marginLeft={2} flexGrow={1}>{words}</Box>
      </Box>
    )
  })

  // The kitchen pane: every terminal on this machine running cooked.

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const c = await read($, cook)
    const title = (await read($, name)) || basename(live.cwd)
    const others = await read($, kitchen)
    const nowMs = (await read($, now)) * 1000
    const width = e.props.bodyColumns
    const mine = kitchenRow(c, { sessionId: live.sessionId || 'this', name: title, cwd: live.cwd, now: nowMs })
    const rows = [mine, ...others]
    const cooking = rows.filter(row => row.phase === 'cooking')
    const table = $.ui.resolve(e)
    const { Box, Text } = table
    const Raster = 'Raster' in table ? table.Raster : undefined
    const mounted: Mounted[] = []
    live.sites.set(e.requestId, mounted)

    const size = width >= 56 ? PAELLA_PANE : PAELLA_BAND
    const shares = cooking.map(row =>
      donenessOf(row.phase, { done: row.done, total: row.total, step: row.step }, nowMs - row.startedAt),
    )
    const isAnyCooked = rows.some(row => row.phase === 'cooked')
    const doneness = shares.length > 0 ? shares.reduce((a, b) => a + b, 0) / shares.length : isAnyCooked ? 1 : 0
    const barColumns = Math.max(8, Math.min(60, width - 22))

    return (
      <Box flexDirection="column">
        <Box>
          {Raster ? paella(Raster, mounted, e.requestId, size, doneness, cooking.length > 0) : null}
          <Box flexDirection="column" marginLeft={2} justifyContent="center">
            <Text bold>Kitchen</Text>
            <Text dimColor>
              {rows.length} {rows.length === 1 ? 'terminal' : 'terminals'} · {cooking.length} cooking
            </Text>
            <Text dimColor>/cooked name &lt;name&gt; renames this one</Text>
          </Box>
        </Box>
        {rows.map(row => {
          const isMine = row === mine
          const elapsed = row.phase === 'cooked' ? row.endedAt - row.startedAt : Math.max(0, nowMs - row.startedAt)
          const fraction = row.phase === 'cooked' ? 1 : row.total > 0 ? row.done / row.total : row.phase === 'ready' ? 0 : null
          const right =
            row.phase === 'ready'
              ? 'ready'
              : row.phase === 'cooked'
                ? `cooked in ${formatDuration(elapsed)} · ${row.ops} ops`
                : [row.total > 0 ? `${row.done}/${row.total}` : '', tally({ ops: row.ops, cooks: row.cooks, elapsedMs: elapsed })]
                    .filter(Boolean)
                    .join(' · ')
          const doing = row.phase === 'cooking' ? row.step || row.activity || 'warming up' : ''
          return (
            <Box key={`row-${row.sessionId}`} flexDirection="column" marginTop={1}>
              <Box>
                {row.phase === 'ready' ? (
                  <Text bold dimColor>{row.name}</Text>
                ) : (
                  <Text bold>{row.name}</Text>
                )}
                <Text dimColor wrap="truncate-end">
                  {isMine ? '  this terminal' : `  ${basename(row.cwd)}`}
                </Text>
              </Box>
              <Box>
                {Raster ? (
                  bar(Raster, mounted, e.requestId, `bar-${row.sessionId}`, barColumns, {
                    fraction,
                    isCooking: row.phase === 'cooking',
                    hasErrors: row.errors > 0,
                  })
                ) : (
                  <Text dimColor>{textBar(barColumns, fraction)}</Text>
                )}
                <Text dimColor wrap="truncate-end"> {right}</Text>
              </Box>
              {doing ? <Text wrap="truncate-end">▸ {doing}</Text> : null}
              {row.dish ? <Text dimColor italic wrap="truncate-end">“{row.dish}”</Text> : null}
            </Box>
          )
        })}
      </Box>
    )
  })
}
