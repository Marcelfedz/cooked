/** One item of the plan Claude keeps (TodoWrite, or TaskCreate / TaskUpdate). */
export type Step = {
  id?: string
  content: string
  activeForm?: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** What this terminal is cooking: one prompt, from submit to answer. */
export type Cook = {
  phase: 'ready' | 'cooking' | 'cooked'
  /** The prompt that started it. */
  dish: string
  startedAt: number
  endedAt: number
  ops: number
  errors: number
  /** Subagents running now, by id. */
  cooks: string[]
  cooksLaunched: number
  /** The latest tool call, in words. */
  activity: string
  steps: Step[]
  /** Files edited or written, unique. */
  files: string[]
  /** Tool calls by tool name. */
  tools: Record<string, number>
  isAborted: boolean
}

/** A terminal as the kitchen sees it: one JSON file per session. */
export type KitchenRow = {
  sessionId: string
  name: string
  cwd: string
  phase: Cook['phase']
  dish: string
  activity: string
  step: string
  startedAt: number
  endedAt: number
  ops: number
  errors: number
  cooks: number
  done: number
  total: number
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    cooked: {
      cook: Cook
      /** This terminal's name. */
      name: string
      /** The other terminals, read from disk while the kitchen is open. */
      kitchen: KitchenRow[]
      /** Seconds, ticking while something cooks, so elapsed times redraw. */
      now: number
      /** Tokens this session has spent, every turn and subagent summed: input with cache reads and writes, and output. */
      tokens: { in: number; out: number }
      /** The session line the band draws at its foot: model, context bar, tokens, session time, limits. */
      status: string
    }
  }
}
