import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'

const VAULT = '/vault'
const OPTIONS = { options: { vaultPath: VAULT } }
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0)
const DAY = 24 * 60 * 60 * 1000
const START = { cwd: '/work/app', surface: 'terminal' as const, isInteractive: true }
const typed = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } })
const PANE = { plugin: 'deck', component: 'Pane' as const, requestId: 'deck', props: { title: 'Deck', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} } }
const BAND = { plugin: 'deck', component: 'AbovePrompt' as const, props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } }

const EXPLORER: AgentInfo = { id: 'A1', description: 'find the config loader', type: 'Explore', status: 'running' }

/** relay and thrift as deck meets them: inline plugins that publish the $.state keys deck reads. */
const peers: Plugin[] = [
  {
    name: 'relay',
    register: on => {
      on('session.start', async ($, e, next) => {
        const h = { id: 'h1', from: { sessionId: 'S2', role: 'planner' as const, name: 'other' }, to: 'builder' as const, note: 'wire the API', path: '/vault/_relay/handoffs/h1.md', at: '2026-10-07T11:30:00.000Z', status: 'pending' as const }
        await $.state.set({ plugin: 'relay', key: 'role' } as const, 'builder')
        await $.state.set({ plugin: 'relay', key: 'pending' } as const, [h])
        await $.state.set({ plugin: 'relay', key: 'recent' } as const, [{ ...h, id: 'h0', status: 'accepted' as const, note: 'earlier' }, h])
        await $.state.set({ plugin: 'relay', key: 'roster' } as const, [
          { sessionId: 'S1', role: 'builder', name: 'app', cwd: '/work/app', since: '2026-10-07T10:00:00.000Z' },
          { sessionId: 'S2', role: 'planner', name: 'other', cwd: '/work/other', since: '2026-10-07T09:00:00.000Z' },
        ])
        return next(e)
      })
    },
  },
  {
    name: 'thrift',
    register: on => {
      on('session.start', async ($, e, next) => {
        await $.state.set({ plugin: 'thrift', key: 'summary' } as const, {
          enabled: true, requests: 12, routedRequests: 5, routedTurns: 2, routedAgents: 3,
          mainActualUsd: 0.5, mainBaselineUsd: 0.3, agentActualUsd: 0.1, agentBaselineUsd: 0.55,
          mainSavedUsd: -0.2, agentSavedUsd: 0.45, lastRoute: 'thrift: this turn ran on haiku (git housekeeping)',
        })
        return next(e)
      })
    },
  },
]

type World = { placed?: boolean; surfaces?: ('terminal' | 'desktop')[]; vault?: boolean }

function world(on: On, { placed = true, surfaces = ['terminal'], vault = true }: World = {}) {
  const clock = mock.clock(on, { now: NOW })
  const files = new Map<string, { text: string; mtimeMs: number }>()
  if (vault) files.set(`${VAULT}/.obsidian/app.json`, { text: '{}', mtimeMs: NOW - 30 * DAY })
  files.set(`${VAULT}/Inbox/Tasks.md`, { text: '# Tasks\n- [x] done thing\n- [ ] call the bank\n* [ ] renew the domain\n- [ ]\n', mtimeMs: NOW - DAY })
  files.set(`${VAULT}/Inbox/idea.md`, { text: 'an idea', mtimeMs: NOW - 2 * DAY })
  files.set(`${VAULT}/Inbox/clip.md`, { text: 'a clip', mtimeMs: NOW - 10 * DAY })
  files.set(`${VAULT}/Projects/relay.md`, { text: 'notes', mtimeMs: NOW - 3 * 60 * 60 * 1000 })
  files.set(`${VAULT}/Archive/old.md`, { text: 'old', mtimeMs: NOW - 40 * DAY })
  files.set(`${VAULT}/_relay/handoffs/h1.md`, { text: 'handoff', mtimeMs: NOW })
  const agents: AgentInfo[] = [EXPLORER]
  const opens: string[] = []
  const closes: string[] = []
  let paneOpen = false

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.render', () => ({ type: 'Box' as const }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: 'S1' }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW - DAY,
      context: { window: 200_000, tokens: 84_000, percent: 42 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 31, resetsAt: new Date(NOW + 125 * 60_000).toISOString() },
        { kind: 'seven_day', percentUsed: 12.5, resetsAt: new Date(NOW + 3 * DAY + 4 * 60 * 60_000).toISOString() },
      ],
      cost: { usd: 1.234 },
    },
  }))
  on('agent.list', () => ({ value: agents }))
  on('ui.open', ($, e) => { opens.push(e.id); paneOpen = true; return { value: placed ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'the terminal is 90 columns wide; an unasked pane needs 144' } } })
  on('ui.close', ($, e) => { closes.push(e.id); paneOpen = false; return { value: undefined } })
  on('ui.panes', () => ({ value: paneOpen ? [{ id: 'deck', title: 'Deck', isShown: true, isFocused: false, isPlaced: placed }] : [] }))
  on('fs.exists', ($, e) => ({ value: [...files.keys()].some(p => p === e.path || p.startsWith(`${e.path}/`)) }))
  on('fs.read', ($, e) => { const f = files.get(e.path); return f === undefined ? { deny: `ENOENT ${e.path}` } : { value: f.text } })
  on('fs.stat', ($, e) => { const f = files.get(e.path); return f === undefined ? { deny: `ENOENT ${e.path}` } : { value: { kind: 'file' as const, size: f.text.length, mtimeMs: f.mtimeMs, isLink: false } } })
  on('fs.list', ($, e) => {
    const prefix = `${e.path}/`
    const names = new Set<string>()
    for (const p of files.keys()) if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split('/')[0] ?? '')
    if (names.size === 0) return { deny: `ENOENT ${e.path}` }
    return { value: [...names].map(name => { const f = files.get(prefix + name); return { name, kind: f === undefined ? ('dir' as const) : ('file' as const), size: f?.text.length ?? 0, mtimeMs: f?.mtimeMs ?? 0, isLink: false } }) }
  })
  on('process.run', ($, e) => {
    if (e.argv[0] !== 'find') return { deny: `unexpected command ${e.argv.join(' ')}` }
    const root = e.argv[1] ?? ''
    const hits = [...files.entries()]
      .filter(([p, f]) => p.startsWith(`${root}/`) && p.endsWith('.md') && !p.includes('/.') && !p.startsWith(`${root}/_relay/`) && NOW - f.mtimeMs < 7 * DAY)
      .map(([p]) => p)
    return { value: { exitCode: 0, stdout: `${hits.join('\n')}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { clock, files, agents, opens, closes }
}

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text)

async function openDeck($: Engine, w: ReturnType<typeof world>) {
  await $.session.start(START)
  await w.clock.advance(1_000)
  return $.command.run(typed('deck', ''))
}

test('/deck opens the pane; the tabs show agents and roles, usage with resets and thrift, the vault, and handoffs', { ...OPTIONS, plugins: peers }, async ($, on) => {
  const w = world(on)
  const ran = await openDeck($, w)
  expect(ran.text).toMatch(/^Deck pane opened\./)
  expect(w.opens).toEqual(['deck'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['Agents', 'Usage', 'Brain', 'Handoffs'])
    await ui.press({ key: 'tab-agents' })
    let shown = await texts(ui)
    expect(shown).toContainEqual(expect.stringMatching(/running\s+Explore\s+find the config loader/))
    expect(shown).toContainEqual(expect.stringMatching(/builder\s+this session\s+since/))
    expect(shown).toContainEqual(expect.stringMatching(/last handoff .*→ builder: wire the API \[pending\]$/))
    expect(shown).toContainEqual(expect.stringMatching(/planner\s+other\s+since/))

    await ui.press({ key: 'tab-usage' })
    shown = await texts(ui)
    expect(shown).toContain('Context   42% of 200k (84k tokens)')
    expect(shown).toContainEqual(expect.stringMatching(/^5-hour {4}31% used · resets in 2h 05m \(/))
    expect(shown).toContainEqual(expect.stringMatching(/^7-day {5}12\.5% used · resets in 3d 4h \(/))
    expect(shown).toContain('Cost      $1.23 this session')
    expect(shown).toContain('thrift    on · main -$0.20 (losing) · subagents +$0.45 · 2 turns, 3 agents rerouted')

    await ui.press({ key: 'tab-brain' })
    shown = await texts(ui)
    expect(shown).toContain('Vault vault')
    expect(shown).toContain('Inbox: 2 notes · 2 open tasks in Inbox/Tasks.md')
    expect(shown).toContain('Changed in the last 7 days (3)')
    expect(shown.filter(t => /^  [A-Z][a-z]{2} [ \d]\d  /.test(t)).map(t => t.slice(10))).toEqual(['Projects/relay.md', 'Inbox/Tasks.md', 'Inbox/idea.md'])
    expect(shown).toContain('  [ ] call the bank')
    expect(shown).toContain('  [ ] renew the domain')

    await ui.press({ key: 'tab-handoffs' })
    shown = await texts(ui)
    expect(shown).toContain('Pending for builder (1)')
    expect(shown).toContainEqual(expect.stringContaining('planner (other) → builder: wire the API'))
    expect(shown).toContain('Recent (2)')
    expect(shown).toContainEqual(expect.stringMatching(/\[accepted\]$/))
    await ui.unmount()
  }
})

test('without relay and thrift the tabs say so instead of inventing data', OPTIONS, async ($, on) => {
  const w = world(on)
  await openDeck($, w)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await texts(ui)).toContain('  relay is not installed: no roles to show')
  await ui.press({ key: 'tab-usage' })
  expect(await texts(ui)).toContain('thrift    not installed')
  await ui.press({ key: 'tab-handoffs' })
  expect(await texts(ui)).toContain('relay is not installed: no handoffs to show')
  await ui.unmount()
})

test('a vault without .obsidian is reported and never read', OPTIONS, async ($, on) => {
  const w = world(on, { vault: false })
  await openDeck($, w)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-brain' })
  expect(await texts(ui)).toContain('Vault: /vault is not an Obsidian vault (no .obsidian folder)')
  await ui.unmount()
})

test('when the pane cannot be placed the band above the prompt carries the essentials, and /deck close hides it', { ...OPTIONS, plugins: peers }, async ($, on) => {
  const w = world(on, { placed: false })
  const ran = await openDeck($, w)
  expect(ran.text).toMatch(/^Deck: no room for a pane \(the terminal is 90 columns wide/)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const line = (await ui.find({ type: 'Text' }))?.text ?? ''
    expect(line).toBe('deck · ctx 42% · 5-hour 31% (2h 05m) · 7-day 12.5% (3d 4h) · thrift +$0.25 · 1 agent running · 1 pending handoff · vault: 3 notes/7d, Inbox 2, 2 tasks')
    await ui.unmount()
  }
  expect((await $.command.run(typed('deck', 'close'))).text).toBe('Deck closed.')
  expect(w.closes).toEqual(['deck'])
  const quiet = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await quiet.find({ type: 'Text' })).toBeUndefined()
  await quiet.unmount()
})

test('where nothing draws, /deck answers with the dashboard as text', { ...OPTIONS, plugins: peers }, async ($, on) => {
  const w = world(on, { surfaces: [] })
  const ran = await openDeck($, w)
  expect(w.opens).toEqual([])
  const text = ran.text ?? ''
  for (const heading of ['## Agents', '## Usage', '## Brain', '## Handoffs']) expect(text).toContain(heading)
  expect(text).toContain('Context   42% of 200k (84k tokens)')
  expect(text).toContain('  [ ] call the bank')
})

test('the snapshot is gathered again after a turn and on the timer, never while drawing', OPTIONS, async ($, on) => {
  const w = world(on)
  await openDeck($, w)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await texts(ui)).some(t => t.includes('find the config loader'))).toBe(true)

  w.agents.push({ id: 'A2', description: 'write the migration', type: 'general-purpose', status: 'completed' })
  await ui.redraw()
  expect((await texts(ui)).some(t => t.includes('write the migration'))).toBe(false)

  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  await w.clock.advance(0)
  expect((await texts(ui)).some(t => /completed\s+general-purpose\s+write the migration/.test(t))).toBe(true)

  w.agents.length = 0
  await w.clock.advance(60_000)
  expect(await texts(ui)).toContain('  none')
  await ui.unmount()
})
