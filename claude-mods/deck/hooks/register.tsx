import { read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DeckAgent, DeckBrain, DeckNote, DeckSnapshot, DeckTab, DeckUsage } from '../types'
import type { DeckPeerHandoff, DeckPeerRole, DeckPeerRosterEntry, DeckPeerThriftSummary } from '../types/peers'

// deck: a dashboard pane (Agents, Usage, Brain, Handoffs). Data is gathered on a timer,
// after each turn and on /deck into $.state `deck.snapshot`; the render hooks only read.
// Relay's and thrift's figures come from their $.state keys when those mods are installed.
// Fallbacks: a pane that cannot be placed -> the compact band above the prompt;
// nothing drawing at all -> /deck answers with the dashboard as text.

const PANE = 'deck'
const TICK_MS = 60_000
const TAB = { plugin: 'deck', key: 'tab' } as const
const SNAPSHOT = { plugin: 'deck', key: 'snapshot' } as const
const BAND = { plugin: 'deck', key: 'band' } as const
const RELAY_ROLE = { plugin: 'relay', key: 'role' } as const
const RELAY_PENDING = { plugin: 'relay', key: 'pending' } as const
const RELAY_RECENT = { plugin: 'relay', key: 'recent' } as const
const RELAY_ROSTER = { plugin: 'relay', key: 'roster' } as const
const THRIFT_SUMMARY = { plugin: 'thrift', key: 'summary' } as const

const TABS: readonly { id: DeckTab; label: string; hotkey: string }[] = [
  { id: 'agents', label: 'Agents', hotkey: '1' },
  { id: 'usage', label: 'Usage', hotkey: '2' },
  { id: 'brain', label: 'Brain', hotkey: '3' },
  { id: 'handoffs', label: 'Handoffs', hotkey: '4' },
]

// ---- gathering (on a timer, after a turn, on /deck; never while drawing) ----

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const RECENT_MAX = 100
const TASKS_MAX = 50
const OPEN_TASK = /^\s*[-*+]\s+\[ \]\s+(.+?)\s*$/

async function gatherAgents($: EngineInterface): Promise<DeckAgent[]> {
  return (await $.agent.list()).map(agent => ({
    id: agent.id,
    type: agent.type,
    ...(agent.name === undefined ? {} : { name: agent.name }),
    status: agent.status,
    description: agent.description,
  }))
}

async function gatherUsage($: EngineInterface, now: number): Promise<DeckUsage> {
  const usage = await $.session.usage()
  return {
    contextPercent: usage.context.percent ?? null,
    contextTokens: usage.context.tokens ?? null,
    window: usage.context.window,
    rateLimits: usage.rateLimits.map(limit => ({
      kind: limit.kind,
      percentUsed: limit.percentUsed,
      ...(limit.resetsAt === undefined
        ? {}
        : { resetsAt: limit.resetsAt, resetsInMinutes: Math.max(0, Math.round((Date.parse(limit.resetsAt) - now) / 60_000)) }),
    })),
    costUsd: usage.cost?.usd ?? null,
  }
}

const noBrain = (problem: string): DeckBrain => ({ problem, recent: [], recentTotal: 0, inboxCount: 0, tasks: [] })

/** Read-only look at the vault: notes changed in 7 days (one `find`, then a stat each), the Inbox count, the open tasks. */
async function gatherBrain($: EngineInterface, vault: string, now: number): Promise<DeckBrain> {
  if (vault === '') return noBrain('set the vaultPath option (/config → deck)')
  if (!(await $.fs.exists(`${vault}/.obsidian`))) return noBrain(`${vault} is not an Obsidian vault (no .obsidian folder)`)
  const found = await $.process.run([
    'find', vault, '-type', 'f', '-name', '*.md', '-mtime', '-7', '-not', '-path', '*/.*', '-not', '-path', `${vault}/_relay/*`,
  ])
  const paths = found.stdout.split('\n').filter(Boolean)
  const recent: DeckNote[] = []
  for (const path of paths.slice(0, RECENT_MAX)) {
    const stat = await $.fs.stat(path).catch(() => null)
    if (stat !== null && now - stat.mtimeMs <= WEEK_MS) recent.push({ path: path.slice(vault.length + 1), mtimeMs: stat.mtimeMs })
  }
  recent.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const inbox = await $.fs.list(`${vault}/Inbox`).catch(() => [])
  const inboxCount = inbox.filter(entry => entry.kind === 'file' && entry.name.endsWith('.md') && entry.name !== 'Tasks.md').length
  const tasksText = await $.fs.read(`${vault}/Inbox/Tasks.md`).catch(() => '')
  const tasks = tasksText
    .split('\n')
    .map(line => OPEN_TASK.exec(line)?.[1])
    .filter((task): task is string => task !== undefined)
    .slice(0, TASKS_MAX)
  return { problem: null, recent, recentTotal: paths.length, inboxCount, tasks }
}

/** Everything the pane shows that costs a call to collect; each part fails on its own. */
async function gatherSnapshot($: EngineInterface, vault: string): Promise<DeckSnapshot> {
  const now = await $.clock.now()
  const [sessionId, agents, usage, brain] = await Promise.all([
    $.session.id(),
    gatherAgents($).catch((): DeckAgent[] => []),
    gatherUsage($, now).catch((): DeckUsage | null => null),
    gatherBrain($, vault, now).catch((error: unknown) => noBrain(`could not read the vault: ${error instanceof Error ? error.message : String(error)}`)),
  ])
  return { at: now, sessionId, agents, usage, brain }
}

type Peers = {
  relay: { installed: boolean; role: DeckPeerRole | null; pending: DeckPeerHandoff[]; recent: DeckPeerHandoff[]; roster: DeckPeerRosterEntry[] }
  thrift: DeckPeerThriftSummary | null
}

async function readPeers($: EngineInterface): Promise<Peers> {
  const [role, pending, recent, roster, thrift] = await Promise.all([
    read($, RELAY_ROLE), read($, RELAY_PENDING), read($, RELAY_RECENT), read($, RELAY_ROSTER), read($, THRIFT_SUMMARY),
  ])
  const installed = role !== undefined || roster !== undefined || recent !== undefined
  return { relay: { installed, role: role ?? null, pending: pending ?? [], recent: recent ?? [], roster: roster ?? [] }, thrift: thrift ?? null }
}

// ---- formatting (pure) ----

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fit = (text: string, width: number) => (text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text)
const clock = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const day = (ms: number) => { const d = new Date(ms); return `${MONTHS[d.getMonth()] ?? '?'} ${String(d.getDate()).padStart(2, ' ')}` }
const isoClock = (iso: string) => { const ms = Date.parse(iso); return Number.isNaN(ms) ? iso : clock(ms) }
const usd = (n: number) => `${n < 0 ? '-' : '+'}$${Math.abs(n).toFixed(Math.abs(n) < 0.1 ? 3 : 2)}`
const count = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const inMinutes = (m: number) => (m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`)
const limitName = (kind: string) => (kind === 'five_hour' ? '5-hour' : kind === 'seven_day' ? '7-day' : kind.replaceAll('_', ' '))
const handoffLine = (h: DeckPeerHandoff) =>
  `${isoClock(h.at)} ${h.from.role ?? 'unassigned'} (${h.from.name}) → ${h.to}${h.note === '' ? '' : `: ${h.note}`}`

function agentsLines(snapshot: DeckSnapshot | null, peers: Peers): string[] {
  const lines = ['Subagents of this session']
  const agents = snapshot?.agents ?? []
  if (agents.length === 0) lines.push('  none')
  for (const agent of agents) lines.push(`  ${agent.status.padEnd(9)} ${(agent.name ?? agent.type).padEnd(18)} ${agent.description}`)
  lines.push('', 'Other sessions (relay roles)')
  if (!peers.relay.installed) lines.push('  relay is not installed: no roles to show')
  else if (peers.relay.roster.length === 0) lines.push('  no session holds a role yet (/role planner|builder|reviewer)')
  for (const entry of peers.relay.roster) {
    const last = [...peers.relay.recent].reverse().find(h => h.from.sessionId === entry.sessionId || h.to === entry.role)
    const who = entry.sessionId === snapshot?.sessionId ? 'this session' : entry.name
    lines.push(`  ${entry.role.padEnd(9)} ${who.padEnd(18)} since ${isoClock(entry.since)}`)
    if (last !== undefined) lines.push(`            last handoff ${handoffLine(last)} [${last.status}]`)
  }
  return lines
}

function usageLines(snapshot: DeckSnapshot | null, peers: Peers): string[] {
  const usage = snapshot?.usage
  const lines: string[] = []
  if (usage === undefined || usage === null) lines.push('Context   not measured yet')
  else {
    lines.push(`Context   ${usage.contextPercent === null ? '?' : `${usage.contextPercent}%`} of ${count(usage.window)}${usage.contextTokens === null ? '' : ` (${count(usage.contextTokens)} tokens)`}`)
    if (usage.rateLimits.length === 0) lines.push('Limits    none reported yet (they arrive with the first API response)')
    for (const limit of usage.rateLimits) {
      const reset = limit.resetsInMinutes === undefined || limit.resetsAt === undefined ? '' : ` · resets in ${inMinutes(limit.resetsInMinutes)} (${isoClock(limit.resetsAt)})`
      lines.push(`${limitName(limit.kind).padEnd(9)} ${limit.percentUsed}% used${reset}`)
    }
    if (usage.costUsd !== null) lines.push(`Cost      $${usage.costUsd.toFixed(2)} this session`)
  }
  const thrift = peers.thrift
  if (thrift === null) lines.push('thrift    not installed')
  else {
    lines.push(`thrift    ${thrift.enabled ? 'on' : 'off'} · main ${usd(thrift.mainSavedUsd)}${thrift.mainSavedUsd < 0 ? ' (losing)' : ''} · subagents ${usd(thrift.agentSavedUsd)} · ${thrift.routedTurns} turns, ${thrift.routedAgents} agents rerouted`)
    if (thrift.lastRoute !== null) lines.push(`          ${thrift.lastRoute}`)
  }
  return lines
}

function brainLines(snapshot: DeckSnapshot | null, vault: string): string[] {
  const brain = snapshot?.brain
  if (brain === undefined) return ['gathering…']
  if (brain.problem !== null) return [`Vault: ${brain.problem}`]
  const lines = [
    `Vault ${vault.split('/').filter(Boolean).at(-1) ?? vault}`,
    `Inbox: ${brain.inboxCount} note${brain.inboxCount === 1 ? '' : 's'} · ${brain.tasks.length} open task${brain.tasks.length === 1 ? '' : 's'} in Inbox/Tasks.md`,
    '',
    `Changed in the last 7 days (${brain.recentTotal})`,
  ]
  if (brain.recent.length === 0) lines.push('  none')
  for (const note of brain.recent.slice(0, 15)) lines.push(`  ${day(note.mtimeMs)}  ${note.path}`)
  if (brain.recentTotal > 15) lines.push(`  … ${brain.recentTotal - 15} more`)
  lines.push('', 'Open tasks')
  if (brain.tasks.length === 0) lines.push('  none')
  for (const task of brain.tasks.slice(0, 15)) lines.push(`  [ ] ${task}`)
  if (brain.tasks.length > 15) lines.push(`  … ${brain.tasks.length - 15} more`)
  return lines
}

function handoffsLines(peers: Peers): string[] {
  if (!peers.relay.installed) return ['relay is not installed: no handoffs to show']
  const lines = [`Pending for ${peers.relay.role ?? 'this session (no role)'} (${peers.relay.pending.length})`]
  if (peers.relay.pending.length === 0) lines.push('  none')
  for (const h of peers.relay.pending) lines.push(`  ${handoffLine(h)}`, `      ${h.path}`)
  lines.push('', `Recent (${peers.relay.recent.length})`)
  if (peers.relay.recent.length === 0) lines.push('  none')
  for (const h of [...peers.relay.recent].reverse().slice(0, 10)) lines.push(`  ${handoffLine(h)} [${h.status}]`)
  return lines
}

/** One compact line for the band or a narrow place. */
function bandLine(snapshot: DeckSnapshot | null, peers: Peers): string {
  const parts = ['deck']
  const usage = snapshot?.usage
  if (usage !== undefined && usage !== null) {
    if (usage.contextPercent !== null) parts.push(`ctx ${usage.contextPercent}%`)
    for (const limit of usage.rateLimits) parts.push(`${limitName(limit.kind)} ${limit.percentUsed}%${limit.resetsInMinutes === undefined ? '' : ` (${inMinutes(limit.resetsInMinutes)})`}`)
  }
  if (peers.thrift !== null) parts.push(`thrift ${usd(peers.thrift.mainSavedUsd + peers.thrift.agentSavedUsd)}`)
  const running = (snapshot?.agents ?? []).filter(a => a.status === 'running').length
  if (running > 0) parts.push(`${running} agent${running === 1 ? '' : 's'} running`)
  if (peers.relay.installed && peers.relay.pending.length > 0) parts.push(`${peers.relay.pending.length} pending handoff${peers.relay.pending.length === 1 ? '' : 's'}`)
  const brain = snapshot?.brain
  if (brain !== undefined && brain.problem === null) parts.push(`vault: ${brain.recentTotal} notes/7d, Inbox ${brain.inboxCount}, ${brain.tasks.length} tasks`)
  return parts.join(' · ')
}

function asText(snapshot: DeckSnapshot | null, peers: Peers, vault: string): string {
  return [
    '## Agents', ...agentsLines(snapshot, peers), '',
    '## Usage', ...usageLines(snapshot, peers), '',
    '## Brain', ...brainLines(snapshot, vault), '',
    '## Handoffs', ...handoffsLines(peers),
  ].join('\n')
}

const linesFor = (tab: DeckTab, snapshot: DeckSnapshot | null, peers: Peers, vault: string) =>
  tab === 'agents' ? agentsLines(snapshot, peers)
    : tab === 'usage' ? usageLines(snapshot, peers)
      : tab === 'brain' ? brainLines(snapshot, vault)
        : handoffsLines(peers)

let gathering = false // transient re-entrancy guard; nothing to keep across a reload

/** Gathers the snapshot into $.state; the pane only reads it. Called by the timer, after a turn and by /deck. */
async function refresh($: EngineInterface, vault: string) {
  if (gathering) return
  gathering = true
  try {
    const snapshot = await gatherSnapshot($, vault)
    await update($, SNAPSHOT, () => snapshot)
    const pane = (await $.ui.panes()).find(p => p.id === PANE)
    if (pane?.isPlaced === true && (await read($, BAND)) === true) await update($, BAND, () => false)
  } catch {
    // fail open: the pane keeps the last snapshot
  } finally {
    gathering = false
  }
}

export const register: Register = (on, options) => {
  const vault = String(options.vaultPath ?? '').replace(/[\\/]+$/, '')

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'deck', description: 'Open the dashboard pane: agents, usage, brain, handoffs', argumentHint: '[close]' })
    $.clock.after(1_000, () => void refresh($, vault))
    $.clock.every(TICK_MS, () => void refresh($, vault))
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) $.clock.after(0, () => void refresh($, vault))
    return next(e)
  })

  on('command.run', { command: 'deck' }, async ($, e) => {
    try {
      const sub = e.args.trim().toLowerCase()
      if (sub === 'close') {
        await $.ui.close({ id: PANE })
        await update($, BAND, () => false)
        return { text: 'Deck closed.' }
      }
      if (sub !== '') return { text: 'deck: usage: /deck | /deck close' }
      await refresh($, vault)
      if ((await $.session.surfaces()).length === 0) {
        return { text: asText((await read($, SNAPSHOT)) ?? null, await readPeers($), vault) }
      }
      const opened = await $.ui.open({ id: PANE, title: 'Deck', columns: 72 })
      if (opened.isPlaced) {
        await update($, BAND, () => false)
        return { text: 'Deck pane opened. Tabs: 1 Agents · 2 Usage · 3 Brain · 4 Handoffs (digits while the pane has focus). /deck close closes it.' }
      }
      await update($, BAND, () => true)
      return { text: `Deck: no room for a pane (${opened.reason}); the compact band above the prompt shows the essentials until there is. /deck close hides it.` }
    } catch (error) {
      return { text: `deck: /deck failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const tab = (await read($, TAB)) ?? 'agents'
    const snapshot = (await read($, SNAPSHOT)) ?? null
    const peers = await readPeers($)
    const width = Math.max(20, e.props.bodyColumns)
    const lines = linesFor(tab, snapshot, peers, vault)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {TABS.map(entry => (
            <Button
              key={`tab-${entry.id}`}
              label={entry.label}
              hotkey={entry.hotkey}
              variant={entry.id === tab ? 'primary' : 'secondary'}
              onPress={() => update($, TAB, () => entry.id)}
            />
          ))}
        </Box>
        <Text dimColor>{snapshot === null ? 'gathering…' : `updated ${clock(snapshot.at)}`}</Text>
        {lines.map(line => (
          <Text wrap="truncate-end">{fit(line, width)}</Text>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, BAND)) !== true) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const line = bandLine((await read($, SNAPSHOT)) ?? null, await readPeers($))
    return (
      <Box>
        <Text dimColor wrap="wrap">{line}</Text>
      </Box>
    )
  })
}
