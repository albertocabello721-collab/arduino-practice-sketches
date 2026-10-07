/** 0 haiku, 1 sonnet, 2 the big models (opus, fable, anything else). */
export type ThriftTier = 0 | 1 | 2

/** What thrift decided for one main-conversation turn, at its start, held for every request of the turn. */
export type ThriftDecision = {
  turnId: string
  /** The lowest tier the prompt warrants; 2 keeps the chosen model. */
  tier: ThriftTier
  reason: string
  /** The session's model as the first request named it; null until that request. */
  asked: string | null
  /** The alias the turn's requests were rewritten to (`haiku`, `sonnet`), or null when the turn kept its model. */
  model: string | null
}

/** One subagent thrift sent to haiku. */
export type ThriftAgent = { asked: string; used: string; type: string }

/** Facts for the next turn: a `!!` prefix seen at prompt.submit, the permission mode from the last UserPromptSubmit. */
export type ThriftPending = { force: boolean; mode: string | null }

/** One model request in the ledger (every main-conversation request, and each request of a rerouted subagent). */
export type ThriftLedgerRow = {
  at: string
  turnId: string
  agentId?: string
  /** The model the session or the spawn asked for. */
  asked: string
  /** The model that answered, as the API reported it. */
  used: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** Estimated cost of what happened, at API list prices. */
  actualUsd: number
  /** Estimated cost had the request run on `asked` with a cache that never switched models. */
  baselineUsd: number
  reason: string
}

/** Running totals since the ledger began, kept in thrift's store; the ledger itself is capped. */
export type ThriftTotals = {
  requests: number
  routedRequests: number
  routedTurns: number
  routedAgents: number
  mainActualUsd: number
  mainBaselineUsd: number
  agentActualUsd: number
  agentBaselineUsd: number
}

/** What other mods read: thrift's standing and its savings so far. */
export type ThriftSummary = ThriftTotals & {
  enabled: boolean
  /** baseline minus actual, main conversation; negative when rerouting cost more than it saved. */
  mainSavedUsd: number
  agentSavedUsd: number
  /** One line about the latest rerouted turn, or null. */
  lastRoute: string | null
}

declare module 'claude-code' {
  interface PluginState {
    thrift: {
      enabled: boolean
      pending: ThriftPending
      decision: ThriftDecision | null
      agents: Record<string, ThriftAgent>
      summary: ThriftSummary
      /** The model the last main-conversation request ran on, to tell a model switch (a cache miss) from a plain request. */
      lastMainModel: string | null
    }
  }
}
