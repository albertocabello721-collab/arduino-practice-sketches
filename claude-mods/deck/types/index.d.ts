export type DeckTab = 'agents' | 'usage' | 'brain' | 'handoffs'

/** One of this session's subagents, as `$.agent.list()` names it. */
export type DeckAgent = { id: string; type: string; name?: string; status: string; description: string }

export type DeckRateLimit = { kind: string; percentUsed: number; resetsAt?: string; resetsInMinutes?: number }

export type DeckUsage = {
  contextPercent: number | null
  contextTokens: number | null
  window: number
  rateLimits: DeckRateLimit[]
  costUsd: number | null
}

/** A vault note changed in the last 7 days; `path` is relative to the vault. */
export type DeckNote = { path: string; mtimeMs: number }

export type DeckBrain = {
  /** Why the vault was not read, or null. */
  problem: string | null
  recent: DeckNote[]
  /** How many notes changed in the last 7 days in all (recent lists the newest 100). */
  recentTotal: number
  /** Notes in Inbox/, Tasks.md not counted. */
  inboxCount: number
  /** Open `- [ ]` items of Inbox/Tasks.md. */
  tasks: string[]
}

/** What the timer and turn.complete gather; the pane only reads it. */
export type DeckSnapshot = {
  at: number
  sessionId: string
  agents: DeckAgent[]
  usage: DeckUsage | null
  brain: DeckBrain
}

declare module 'claude-code' {
  interface PluginState {
    deck: {
      tab: DeckTab
      snapshot: DeckSnapshot | null
      /** True while the compact band stands in for a pane that could not be placed. */
      band: boolean
    }
  }
}
