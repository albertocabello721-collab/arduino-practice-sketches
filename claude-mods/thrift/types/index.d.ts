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
  /** The full model id the turn's requests are sent to instead of `asked`; null while the turn keeps its model, and again once a reroute failed. */
  model: string | null
  /** The cheaper model that answered requests of the turn, as the API reported it; null while none has. */
  used: string | null
  /** How many of the turn's requests were answered so far. */
  requests: number
  /** How many of those `used` answered. */
  routed: number
}

/** One subagent thrift sent to haiku; `used` is the cheaper model its requests ran on as the API reported it, null until one did. */
export type ThriftAgent = { asked: string; used: string | null; type: string }

/** Facts for the next turn: a `!!` prefix seen at prompt.submit, the permission mode from the last UserPromptSubmit. */
export type ThriftPending = { force: boolean; mode: string | null }

/** Why thrift stopped rerouting for the rest of the session: the model a request was sent to and what became of it. */
export type ThriftHalt = { at: string; model: string; cause: string }

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
  /** Estimated cost had the request run on `asked` with a cache that never switched models; 0 for a discarded response. */
  baselineUsd: number
  reason: string
  /** Present when the response was thrown away (a rerouted request another model answered, or one that ended without an answer) and the request ran again on `asked`. */
  discarded?: true
}

/** Running totals since the ledger began, kept in thrift's store; the ledger itself is capped. */
export type ThriftTotals = {
  requests: number
  /** Requests a cheaper model than the one asked for answered. */
  routedRequests: number
  /** Main-conversation turns with at least one such request. */
  routedTurns: number
  /** Subagents with at least one such request. */
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
      /** Set when a rerouted request failed: nothing is rerouted again this session until `/thrift on`. */
      halted: ThriftHalt | null
    }
  }
}
