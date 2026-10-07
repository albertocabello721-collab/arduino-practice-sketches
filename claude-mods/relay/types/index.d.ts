export type RelayRole = 'planner' | 'builder' | 'reviewer'

/** One session that took a role with /role; keyed by session id in relay's store. */
export type RelayRosterEntry = {
  sessionId: string
  role: RelayRole
  /** The session's project folder name (basename of its cwd). */
  name: string
  cwd: string
  /** ISO time the role was taken. */
  since: string
}

/** One handoff file relay wrote, and where it stands. */
export type RelayHandoff = {
  id: string
  from: { sessionId: string; role: RelayRole | null; name: string }
  /** The role it is for, or `chat` for a /handoff out file in the outbox. */
  to: RelayRole | 'chat'
  note: string
  /** Absolute path of the handoff file. */
  path: string
  /** ISO time it was written. */
  at: string
  status: 'pending' | 'accepted' | 'out'
}

declare module 'claude-code' {
  interface PluginState {
    relay: {
      /** This session's role, or null. */
      role: RelayRole | null
      /** Handoffs addressed to this session's role, not yet accepted. */
      pending: RelayHandoff[]
      /** The newest handoffs relay knows of, any role, any status. */
      recent: RelayHandoff[]
      /** Every session holding a role, as relay's store has it. */
      roster: RelayRosterEntry[]
      /** Inbox file names already reported as undeliverable, so each is said once. */
      noticed: string[]
    }
  }
}
