// The $.state keys deck reads from the relay and thrift mods when they are installed.
// Each shape is that mod's own contract (relay/types/index.d.ts, thrift/types/index.d.ts),
// repeated here so deck loads and type-checks on its own; a session without those mods
// answers `undefined` for every key.

export type DeckPeerRole = 'planner' | 'builder' | 'reviewer'

export type DeckPeerRosterEntry = { sessionId: string; role: DeckPeerRole; name: string; cwd: string; since: string }

export type DeckPeerHandoff = {
  id: string
  from: { sessionId: string; role: DeckPeerRole | null; name: string }
  to: DeckPeerRole | 'chat'
  note: string
  path: string
  at: string
  status: 'pending' | 'accepted' | 'out'
}

export type DeckPeerThriftSummary = {
  enabled: boolean
  requests: number
  routedRequests: number
  routedTurns: number
  routedAgents: number
  mainActualUsd: number
  mainBaselineUsd: number
  agentActualUsd: number
  agentBaselineUsd: number
  mainSavedUsd: number
  agentSavedUsd: number
  lastRoute: string | null
}

declare module 'claude-code' {
  interface PluginState {
    relay: {
      role: DeckPeerRole | null
      pending: DeckPeerHandoff[]
      recent: DeckPeerHandoff[]
      roster: DeckPeerRosterEntry[]
    }
    thrift: {
      summary: DeckPeerThriftSummary
    }
  }
}
