import { read } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RelayHandoff, RelayRole, RelayRosterEntry } from '../types'

// relay: planner/builder/reviewer handoffs between sessions, over the engine's
// own cross-session messaging ($.session.send / session.receive), plus an
// inbox/outbox bridge in the Obsidian vault for Claude chat and Cowork.
//
// Persistent state: $.store (shared by every session running relay)
//   roster   Record<sessionId, RelayRosterEntry>   who holds which role
//   handoffs RelayHandoff[]                         the newest HANDOFF_KEEP handoffs
// Session state: $.state (readable by any mod in this session, see types/)
//   role, pending, recent, roster, noticed

const ROLES: readonly RelayRole[] = ['planner', 'builder', 'reviewer']
const TICK_MS = 10_000
const HANDOFF_KEEP = 100
const RECENT_SHOWN = 20
const HANDOFF_TAG = /\[relay handoff ([^\]]+)\]/
const INBOX_TAG = '[relay inbox]'
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const ROLE = { plugin: 'relay', key: 'role' } as const
const PENDING = { plugin: 'relay', key: 'pending' } as const
const RECENT = { plugin: 'relay', key: 'recent' } as const
const ROSTER = { plugin: 'relay', key: 'roster' } as const
const NOTICED = { plugin: 'relay', key: 'noticed' } as const

type Roster = Record<string, RelayRosterEntry>
type Me = { sessionId: string; cwd: string; name: string }

const isRole = (value: string | undefined): value is RelayRole =>
  ROLES.includes(value as RelayRole)

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

async function whoami($: EngineInterface): Promise<Me> {
  const [sessionId, cwd] = await Promise.all([$.session.id(), $.session.cwd()])
  const name = cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd
  return { sessionId, cwd, name }
}

async function getRoster($: EngineInterface): Promise<Roster> {
  const raw = await $.store.get('roster')
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Roster) } : {}
}

async function getHandoffs($: EngineInterface): Promise<RelayHandoff[]> {
  const raw = await $.store.get('handoffs')
  return Array.isArray(raw) ? (raw as RelayHandoff[]) : []
}

const holderOf = (roster: Roster, role: string | undefined) =>
  Object.values(roster).find(entry => entry.role === role)

/** Mirrors the store into $.state for the band and for other mods; writes only what changed. */
async function publish($: EngineInterface, roster: Roster, handoffs: RelayHandoff[], sessionId: string) {
  const role = roster[sessionId]?.role ?? null
  const pending = handoffs.filter(h => h.status === 'pending' && h.to === role)
  const recent = handoffs.slice(-RECENT_SHOWN)
  const list = Object.values(roster)
  if (!same((await $.state.get(ROLE)).value, role)) await $.state.set(ROLE, role)
  if (!same((await $.state.get(PENDING)).value, pending)) await $.state.set(PENDING, pending)
  if (!same((await $.state.get(RECENT)).value, recent)) await $.state.set(RECENT, recent)
  if (!same((await $.state.get(ROSTER)).value, list)) await $.state.set(ROSTER, list)
}

async function filesTouched($: EngineInterface): Promise<string[]> {
  const files = new Set<string>()
  for (const message of await $.session.messages()) {
    for (const use of message.toolUses) {
      if (!EDIT_TOOLS.has(use.tool)) continue
      const path = use.input.file_path ?? use.input.notebook_path
      if (typeof path === 'string') files.add(path)
    }
  }
  return [...files]
}

const forkPrompt = (note: string) => `You are writing a handoff note for another engineer (or another Claude session) who will continue this work without access to this conversation.
Answer with exactly these four markdown sections, in this order, and nothing before or after them:
## Goal
## Plan
## Done when
## Open questions
Keep each section to short bullet points. Name files, commands and decisions precisely. Where something is unknown, say so under Open questions rather than guessing.
Note from the person for this handoff: ${note === '' ? '(none)' : JSON.stringify(note)}`

/** The sections of a handoff: the model's summary of this session, then the files it edited. */
async function composeBody($: EngineInterface, note: string): Promise<string> {
  const files = await filesTouched($)
  const forked = await $.model.fork({ prompt: forkPrompt(note) })
  const sections = forked.isAnswered
    ? forked.text.trim()
    : `## Goal\n_(not generated: ${forked.reason})_\n\n## Plan\n_(not generated)_\n\n## Done when\n_(not generated)_\n\n## Open questions\n${note === '' ? '_(none given)_' : `- ${note}`}`
  const list = files.length === 0 ? '- (no files edited in this session)' : files.map(f => `- ${f}`).join('\n')
  return `${sections}\n\n## Files touched\n${list}\n`
}

const stamp = (iso: string) => iso.replace(/\.\d{3}Z$/, 'Z').replaceAll(':', '-')

function renderHandoff(record: RelayHandoff, body: string): string {
  const from = record.from.role ?? 'unassigned'
  return [
    '---',
    'type: relay-handoff',
    `id: ${record.id}`,
    `from: ${from}`,
    `from_name: ${record.from.name}`,
    `from_session: ${record.from.sessionId}`,
    `to: ${record.to}`,
    `at: ${record.at}`,
    `note: ${JSON.stringify(record.note)}`,
    '---',
    '',
    `# Handoff: ${from} → ${record.to}`,
    '',
    record.note === '' ? '' : `> ${record.note}\n`,
    body,
  ].join('\n')
}

/** Writes one handoff file and records it in the store; returns the record. */
async function writeHandoff($: EngineInterface, vault: string, me: Me, roster: Roster, to: RelayRole | 'chat', note: string): Promise<RelayHandoff> {
  const at = new Date(await $.clock.now()).toISOString()
  const fromRole = roster[me.sessionId]?.role ?? null
  const id = `${stamp(at)}_${fromRole ?? 'unassigned'}-to-${to}`
  const folder = to === 'chat' ? 'outbox' : 'handoffs'
  const record: RelayHandoff = {
    id,
    from: { sessionId: me.sessionId, role: fromRole, name: me.name },
    to,
    note,
    path: `${vault}/_relay/${folder}/${id}.md`,
    at,
    status: to === 'chat' ? 'out' : 'pending',
  }
  const body = await composeBody($, note)
  await $.fs.write(record.path, renderHandoff(record, body))
  const handoffs = [...(await getHandoffs($)), record].slice(-HANDOFF_KEEP)
  await $.store.set('handoffs', handoffs)
  await publish($, roster, handoffs, me.sessionId)
  return record
}

/** Delivers a relay message to the session holding a role: a prompt to this session, a peer message to another. */
async function deliver($: EngineInterface, me: Me, holder: RelayRosterEntry, text: string): Promise<boolean> {
  if (holder.sessionId === me.sessionId) {
    void $.prompt.submit({ text }).catch(() => undefined)
    return true
  }
  const sent = await $.session.send({ to: { sessionId: holder.sessionId }, text })
  return sent.isDelivered
}

/** Null when the vault can be used; else the line to tell the person. The folder must hold Obsidian's .obsidian/. */
async function vaultProblem($: EngineInterface, vault: string): Promise<string | null> {
  if (vault === '') return 'relay: set the vaultPath option first (/config → relay).'
  if (!(await $.fs.exists(`${vault}/.obsidian`))) return `relay: ${vault} is not an Obsidian vault (no .obsidian folder); fix vaultPath in /config.`
  return null
}

async function noteOnce($: EngineInterface, name: string, line: string) {
  const held = await $.state.get(NOTICED)
  const noticed = held.value ?? []
  if (noticed.includes(name)) return
  await $.state.set(NOTICED, [...noticed, name].slice(-200))
  $.ui.log(line)
}

/** One pass over <vault>/_relay/inbox/: each `to: <role>` file is claimed by moving it to done/, then delivered. */
async function watchInbox($: EngineInterface, vault: string, me: Me) {
  const inbox = `${vault}/_relay/inbox`
  const entries = await $.fs.list(inbox).catch(() => [])
  const files = entries.filter(f => f.kind === 'file' && f.name.endsWith('.md') && !f.name.startsWith('.'))
  if (files.length === 0) return
  const roster = await getRoster($)
  for (const file of files) {
    const src = `${inbox}/${file.name}`
    const content = await $.fs.read(src).catch(() => null)
    if (content === null) continue
    const to = /^\s*to:\s*([A-Za-z]+)\s*$/m.exec(content)?.[1]?.toLowerCase()
    const holder = isRole(to) ? holderOf(roster, to) : undefined
    if (!isRole(to) || holder === undefined) {
      await noteOnce($, file.name, `relay: inbox/${file.name} waits: no session holds the role "${to ?? '?'}"`)
      continue
    }
    const done = `${inbox}/done`
    if (!(await $.fs.exists(done))) await $.fs.write(`${done}/.keep`, '')
    const dst = `${done}/${file.name}`
    const claimed = await $.process.run(['mv', src, dst])
    if (claimed.exitCode !== 0) continue // another session claimed it first
    const text = `${INBOX_TAG} ${file.name} for ${to}\n\n${content.trim()}`
    if (await deliver($, me, holder, text)) {
      $.ui.log(`relay: delivered inbox/${file.name} to ${to} (${holder.name})`)
      continue
    }
    await $.process.run(['mv', dst, src])
    delete roster[holder.sessionId]
    await $.store.set('roster', roster)
    $.ui.log(`relay: ${holder.name} (${to}) is not running; dropped it from the roster, inbox/${file.name} stays`)
  }
}

const describeHandoff = (h: RelayHandoff) =>
  `- ${h.id}: from ${h.from.role ?? 'unassigned'} (${h.from.name})${h.note === '' ? '' : ` — ${h.note}`}\n  ${h.path}`

export const register: Register = (on, options) => {
  const vault = String(options.vaultPath ?? '').replace(/[\\/]+$/, '')
  let ticking = false // transient re-entrancy guard; nothing to keep across a reload

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'role',
      description: 'Tag this session as planner, builder or reviewer so relay handoffs can find it',
      argumentHint: '[planner|builder|reviewer]',
    })
    await $.command.register({
      name: 'handoff',
      description: 'Hand this work to another session by role, accept pending handoffs, or write one out for chat',
      argumentHint: '<role> [note] | out <note> | accept',
    })
    const tick = async () => {
      if (ticking) return
      ticking = true
      try {
        const me = await whoami($)
        await publish($, await getRoster($), await getHandoffs($), me.sessionId)
        const problem = await vaultProblem($, vault)
        if (problem === null) await watchInbox($, vault, me)
        else await noteOnce($, '<vault>', problem)
      } catch {
        // fail open: the next tick tries again
      } finally {
        ticking = false
      }
    }
    void tick()
    $.clock.every(TICK_MS, tick)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    const roster = await getRoster($)
    if (roster[e.sessionId] !== undefined) {
      delete roster[e.sessionId]
      await $.store.set('roster', roster)
    }
    return next(e)
  })

  on('command.run', { command: 'role' }, async ($, e) => {
    try {
      const me = await whoami($)
      const roster = await getRoster($)
      const arg = e.args.trim().toLowerCase()
      if (arg === '') {
        const mine = roster[me.sessionId]?.role
        const others = Object.values(roster).filter(r => r.sessionId !== me.sessionId)
        return {
          text: [
            `relay: this session is ${mine === undefined ? 'unassigned' : `the ${mine}`}.`,
            ...others.map(r => `- ${r.role}: ${r.name} (${r.sessionId})`),
          ].join('\n'),
        }
      }
      if (!isRole(arg)) return { text: `relay: roles are ${ROLES.join(', ')}.` }
      const previous = Object.values(roster).find(r => r.role === arg && r.sessionId !== me.sessionId)
      if (previous !== undefined) delete roster[previous.sessionId]
      roster[me.sessionId] = {
        sessionId: me.sessionId,
        role: arg,
        name: me.name,
        cwd: me.cwd,
        since: new Date(await $.clock.now()).toISOString(),
      }
      await $.store.set('roster', roster)
      await publish($, roster, await getHandoffs($), me.sessionId)
      return { text: `relay: this session is now the ${arg}${previous === undefined ? '' : ` (took it from ${previous.name})`}.` }
    } catch (error) {
      return { text: `relay: /role failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    try {
      const [head = '', ...rest] = e.args.trim().split(/\s+/)
      const sub = head.toLowerCase()
      const note = rest.join(' ').trim()
      const me = await whoami($)
      const roster = await getRoster($)
      const handoffs = await getHandoffs($)
      const myRole = roster[me.sessionId]?.role ?? null
      const pending = handoffs.filter(h => h.status === 'pending' && h.to === myRole)

      if (sub === '') {
        if (pending.length === 0) {
          return { text: `relay: no pending handoffs${myRole === null ? '; this session has no role (/role <planner|builder|reviewer>)' : ` for ${myRole}`}.` }
        }
        return { text: [`relay: ${pending.length} pending for ${myRole}:`, ...pending.map(describeHandoff), 'Run /handoff accept to take them.'].join('\n') }
      }

      if (sub === 'accept') {
        if (pending.length === 0) {
          return { text: `relay: nothing to accept${myRole === null ? '; this session has no role' : ''}.` }
        }
        const ids = new Set(pending.map(h => h.id))
        const updated = handoffs.map(h => (ids.has(h.id) ? { ...h, status: 'accepted' as const } : h))
        await $.store.set('handoffs', updated)
        await publish($, roster, updated, me.sessionId)
        const context: string[] = []
        for (const h of pending) {
          const content = await $.fs.read(h.path).catch(() => `(relay could not read ${h.path})`)
          context.push(`Handoff ${h.id} accepted by the person (${h.path}):\n\n${content}`)
        }
        return {
          text: [`relay: accepted ${pending.length} handoff${pending.length === 1 ? '' : 's'}:`, ...pending.map(h => `- ${h.path}`), 'Their contents are in context for your next prompt.'].join('\n'),
          context,
        }
      }

      const problem = await vaultProblem($, vault)
      if (problem !== null) return { text: problem }

      if (sub === 'out') {
        const record = await writeHandoff($, vault, me, roster, 'chat', note)
        return { text: `relay: wrote ${record.path} for chat or Cowork to read.` }
      }

      if (!isRole(sub)) {
        return { text: 'relay: usage: /handoff <planner|builder|reviewer> [note] | /handoff out <note> | /handoff accept' }
      }
      if (sub === myRole) return { text: `relay: this session is the ${sub}; hand off to another role, or use /handoff out <note>.` }

      const holder = holderOf(roster, sub)
      const record = await writeHandoff($, vault, me, roster, sub, note)
      if (holder === undefined) {
        return { text: `relay: wrote ${record.path}\nNo session holds ${sub} right now; it shows as pending once one runs /role ${sub}.` }
      }
      const message = `[relay handoff ${record.id}] ${myRole ?? 'unassigned'} (${me.name}) → ${sub}${note === '' ? '' : `: ${note}`}\n${record.path}`
      const sent = await $.session.send({ to: { sessionId: holder.sessionId }, text: message })
      return {
        text: sent.isDelivered
          ? `relay: handoff sent to ${sub} (${holder.name}).\n${record.path}`
          : `relay: wrote ${record.path}\nCould not reach ${sub} (${holder.name}): ${sent.reason}. It stays pending for whoever holds ${sub}.`,
      }
    } catch (error) {
      return { text: `relay: /handoff failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  })

  // A relay message from another session: a handoff is held for /handoff accept
  // (the model never sees it until then); an inbox delivery goes on to the model.
  // Relay never sends anything in answer to a received message.
  on('session.receive', async ($, e, next) => {
    if (e.agentId !== undefined || e.origin.kind !== 'peer' || e.origin.plugin !== 'relay') return next(e)
    const handoff = HANDOFF_TAG.exec(e.text)
    if (handoff !== null) {
      const id = handoff[1] ?? ''
      const me = await whoami($)
      const roster = await getRoster($)
      let handoffs = await getHandoffs($)
      let record = handoffs.find(h => h.id === id)
      if (record === undefined) {
        const lines = e.text.trim().split('\n')
        record = {
          id,
          from: { sessionId: 'unknown', role: null, name: 'another session' },
          to: roster[me.sessionId]?.role ?? 'chat',
          note: '',
          path: lines.at(-1) ?? '',
          at: new Date(await $.clock.now()).toISOString(),
          status: 'pending',
        }
        handoffs = [...handoffs, record].slice(-HANDOFF_KEEP)
        await $.store.set('handoffs', handoffs)
      }
      await publish($, roster, handoffs, me.sessionId)
      $.ui.log(`relay: handoff from ${record.from.role ?? 'unassigned'} (${record.from.name}): ${record.path}`)
      $.ui.toast(`Handoff from ${record.from.role ?? 'another session'}: /handoff accept`)
      return { consumed: 'relay: handoff held in the band until /handoff accept' }
    }
    if (e.text.includes(INBOX_TAG)) {
      const first = e.text.split('\n').find(line => line.includes(INBOX_TAG)) ?? ''
      $.ui.log(`relay: inbox delivery ${first.slice(first.indexOf(INBOX_TAG) + INBOX_TAG.length).trim()}`)
      $.ui.toast('relay: inbox message delivered to this session')
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const pending = (await read($, PENDING)) ?? []
    if (e.props.hasSurvey || pending.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(10, e.props.bodyColumns)
    const row = (item: RelayHandoff) => {
      const line = `${item.from.role ?? 'unassigned'} (${item.from.name})${item.note === '' ? '' : `: ${item.note}`}`
      return line.length > width ? `${line.slice(0, width - 1)}…` : line
    }
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>relay:</Text> {pending.length} pending handoff{pending.length === 1 ? '' : 's'}{' '}
          <Text dimColor>/handoff accept</Text>
        </Text>
        {pending.slice(0, 5).map(item => (
          <Text dimColor wrap="truncate-end">
            {row(item)}
          </Text>
        ))}
      </Box>
    )
  })
}
