import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { compactCount, contextBar, describeTool, donenessOf, formatSpan, progressOf, shortModel, statusLine, stepsAfterUpdate } from '../hooks/cook'

const BAND = {
  plugin: 'cooked',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 12,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
  viewport: { columns: 105, rows: 40, isFullscreen: true },
} as const

const PANE = {
  plugin: 'cooked',
  component: 'Pane',
  requestId: 'cooked-kitchen',
  props: {
    title: 'Kitchen',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
  viewport: { columns: 180, rows: 40, isFullscreen: true },
} as const

/** The engine beneath the plugin: each event cooked passes on is answered here. */
function kitchenFloor(on: On) {
  mock.clock(on, { now: 1_760_000_000_000 })
  mock.env(on, {})
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', ($, e) =>
    e.tool === 'TaskCreate' ? { result: { task: { id: '7', subject: e.subject } } } : { result: {} },
  )
}

const TODOS = [
  { content: 'Read the hooks', status: 'completed', activeForm: 'Reading the hooks' },
  { content: 'Write tests', status: 'in_progress', activeForm: 'Writing tests' },
  { content: 'Ship it', status: 'pending', activeForm: 'Shipping it' },
] as const

describe('the band above the prompt', () => {
  test('names the terminal before anything cooks', async ($, on) => {
    kitchenFloor(on)
    await $.session.start({ cwd: '/work/marshall', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'marshall' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ready to cook/ })).toBeDefined()
    await ui.unmount()
  })

  test('shows the plan as a real share, the step and the paella', async ($, on) => {
    kitchenFloor(on)
    await $.session.start({ cwd: '/work/marshall', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'upgrade cooked into a mod', turnId: 't1' })
    await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ type: 'Text', text: '1/3' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Writing tests/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /upgrade cooked into a mod/ })).toBeDefined()
      if (surface === 'terminal') expect(await ui.find({ type: 'Raster', key: 'paella' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('follows TaskCreate and TaskUpdate', async ($, on) => {
    kitchenFloor(on)
    await $.session.start({ cwd: '/work/marshall', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'plan it', turnId: 't1' })
    await $.tool.call({ tool: 'TaskCreate', subject: 'Draw the paella', description: 'pixels', activeForm: 'Drawing the paella' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress' })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: '0/1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Drawing the paella/ })).toBeDefined()
    await ui.unmount()
  })

  test('says what the last tool did when there is no plan', async ($, on) => {
    kitchenFloor(on)
    await $.session.start({ cwd: '/work/marshall', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'run the tests', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the test suite' })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /\$ Run the test suite/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 op/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /no task list/ })).toBeDefined()
    await ui.unmount()
  })

  test('reports the finished turn', async ($, on) => {
    kitchenFloor(on)
    await $.session.start({ cwd: '/work/marshall', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'quick one', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/work/marshall/README.md' })
    await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer' })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /cooked in/ })).toBeDefined()
    await ui.unmount()
  })

  test('draws the session line at its foot, in the theme blue', async ($, on) => {
    kitchenFloor(on)
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('session.usage', () => ({
      value: { startedAt: 1_760_000_000_000 - 65 * 60_000, context: { window: 200_000, percent: 34 }, rateLimits: [{ kind: 'five_hour', percentUsed: 42 }] },
    }))
    await $.session.start({ cwd: '/work/marshall', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'read things', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const line = await ui.find({ type: 'Text', text: /context ███░░░░░░░ 34% · session 1h 05m · 5h limit 42%/ })
    expect(line).toBeDefined()
    expect(line?.props).toMatchObject({ color: 'permission' })
    await ui.unmount()
  })

  test('/cooked name renames this terminal', async ($, on) => {
    kitchenFloor(on)
    await $.session.start({ cwd: '/work/marshall', surface: 'terminal', isInteractive: true })
    const ran = await $.command.run({
      command: 'cooked',
      args: 'name front-end',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 120 },
    })
    expect(ran.text).toBe('This terminal is now "front-end".')
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'front-end' })).toBeDefined()
    await ui.unmount()
  })
})

describe('the kitchen pane', () => {
  test('lists this terminal with its bar', async ($, on) => {
    kitchenFloor(on)
    await $.session.start({ cwd: '/work/marshall', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'cook something', turnId: 't1' })
    await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: 'Kitchen' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /1 terminal · 1 cooking/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /this terminal/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /1\/3/ })).toBeDefined()
      await ui.unmount()
    }
  })
})

describe('the words', () => {
  test('describe tool calls briefly', () => {
    expect(describeTool({ tool: 'Edit', file_path: '/a/b/register.tsx' })).toBe('editing register.tsx')
    expect(describeTool({ tool: 'mcp__github__create_issue' })).toBe('github · create_issue')
    expect(describeTool({ tool: 'Agent', description: 'Explore the repo' })).toBe('briefing a cook: Explore the repo')
  })

  test('a deleted task leaves the plan', () => {
    const steps = [
      { id: '1', content: 'a', status: 'completed' as const },
      { id: '2', content: 'b', status: 'pending' as const },
    ]
    expect(stepsAfterUpdate(steps, { tool: 'TaskUpdate', taskId: '2', status: 'deleted' })).toEqual([steps[0]])
    expect(progressOf(steps)).toEqual({ done: 1, total: 2, step: '' })
  })

  test('the status line says model, context, tokens, session time and limits', () => {
    expect(shortModel('claude-opus-5-5')).toBe('opus 5.5')
    expect(compactCount(950)).toBe('950')
    expect(compactCount(1_240)).toBe('1.2k')
    expect(compactCount(84_400)).toBe('84k')
    expect(compactCount(1_240_000)).toBe('1.2M')
    expect(formatSpan(30_000)).toBe('<1m')
    expect(contextBar(86)).toBe('█████████░ 86% near full')
    expect(formatSpan(65 * 60_000)).toBe('1h 05m')
    const base = { model: 'claude-opus-5-5', contextPercent: 34.4, tokensIn: 1_240_000, tokensOut: 84_000, sessionMs: 65 * 60_000 }
    expect(statusLine({ ...base, limits: [{ kind: 'five_hour', percentUsed: 42 }], costUsd: 3.1 })).toBe(
      'opus 5.5 · context ███░░░░░░░ 34% · ↑1.2M ↓84k tokens · session 1h 05m · 5h limit 42%',
    )
    expect(statusLine({ ...base, tokensIn: 0, tokensOut: 0, limits: [], costUsd: 3.1 })).toBe(
      'opus 5.5 · context ███░░░░░░░ 34% · session 1h 05m · $3.10',
    )
  })

  test('the paella never finishes before the turn does', () => {
    const none = { done: 0, total: 0, step: '' }
    expect(donenessOf('cooking', none, 60 * 60 * 1000)).toBeLessThan(0.91)
    expect(donenessOf('cooking', { done: 3, total: 3, step: '' }, 0)).toBeLessThan(1)
    expect(donenessOf('cooked', none, 0)).toBe(1)
  })
})
