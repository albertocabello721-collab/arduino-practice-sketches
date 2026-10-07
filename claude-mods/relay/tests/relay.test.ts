import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { RelayHandoff } from '../types'

const VAULT = '/vault'
const OPTIONS = { options: { vaultPath: VAULT } }
const SECTIONS = '## Goal\n- ship it\n\n## Plan\n- step one\n\n## Done when\n- tests pass\n\n## Open questions\n- none'
const START = { cwd: '/work/app', surface: 'terminal' as const, isInteractive: true }
const BAND = {
  plugin: 'relay',
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
}
const ok = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const S1 = { sessionId: 'S1', name: 'app', cwd: '/work/app', since: 'x' }
const S2 = { sessionId: 'S2', name: 'other', cwd: '/work/other', since: 'x' }

type Files = Map<string, string>
type World = { store?: Record<string, unknown>; vault?: boolean; deliver?: boolean }

/** The world beneath relay: a session identity, an in-memory store and file system with `mv`, a fork that answers, and recorders. */
function world(on: On, files: Files, { store = {}, vault = true, deliver = true }: World = {}) {
  if (vault) files.set(`${VAULT}/.obsidian/app.json`, '{}')
  const kv = new Map<string, unknown>(Object.entries(store))
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 7, 12, 0, 0) })
  const sent: { to: string; text: string }[] = []
  const submitted: string[] = []
  const logs: string[] = []
  const toasts: string[] = []
  const commands: string[] = []
  const race = new Set<string>() // paths another watcher takes right after relay reads them
  const edits = [{ tool_use_id: 't1', tool: 'Edit', input: { file_path: '/work/app/src/a.ts' } }]

  on('store.get', ($, e) => ({ value: kv.get(e.key) }))
  on('store.set', ($, e) => { kv.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined } })
  on('store.delete', ($, e) => { kv.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...kv.keys()] }))

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.receive', ($, e) => ({ text: e.text }))
  on('ui.render', () => ({ type: 'Box' as const })) // the engine's own empty band, when relay passes
  on('session.id', () => ({ value: 'S1' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.messages', () => ({ value: [{ role: 'assistant' as const, text: '', toolUses: edits }] }))
  on('session.send', ($, e) => {
    sent.push({ to: e.to, text: e.text })
    return deliver ? { isDelivered: true as const } : { isDelivered: false as const, reason: 'not running' }
  })
  on('prompt.submit', ($, e) => { submitted.push(e.text); return { text: e.text } })
  on('model.fork', () => ({ value: { isAnswered: true as const, text: SECTIONS, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('command.register', ($, e) => { commands.push(e.name); return { value: { command: e.name } } })
  on('ui.log', ($, e) => { logs.push(e.text); return { value: undefined } })
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })

  on('fs.write', ($, e) => { files.set(e.path, e.text); return { value: undefined } })
  on('fs.read', ($, e) => {
    const text = files.get(e.path)
    if (race.has(e.path)) files.delete(e.path)
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.exists', ($, e) => ({ value: [...files.keys()].some(p => p === e.path || p.startsWith(`${e.path}/`)) }))
  on('fs.list', ($, e) => {
    const prefix = `${e.path}/`
    const names = new Set<string>()
    for (const p of files.keys()) if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split('/')[0] ?? '')
    if (names.size === 0) return { deny: `ENOENT ${e.path}` }
    return { value: [...names].map(name => ({ name, kind: files.has(prefix + name) ? ('file' as const) : ('dir' as const), size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', ($, e) => {
    const [cmd, src, dst] = e.argv
    if (cmd !== 'mv' || src === undefined || dst === undefined) return { deny: `unexpected command ${e.argv.join(' ')}` }
    const text = files.get(src)
    if (text === undefined) return { value: { ...ok, exitCode: 1, stderr: 'mv: no such file' } }
    files.delete(src)
    files.set(dst, text)
    return { value: ok }
  })
  return { clock, kv, sent, submitted, logs, toasts, commands, race }
}

const handoffs = (w: { kv: Map<string, unknown> }) => (w.kv.get('handoffs') ?? []) as RelayHandoff[]

/** `/command args` as the person types it at a fullscreen terminal. */
const typed = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } })

test('/role records this session in the shared roster and /role lists it', OPTIONS, async ($, on) => {
  const w = world(on, new Map())
  await $.session.start(START)
  expect(w.commands).toEqual(['role', 'handoff'])

  const took = await $.command.run(typed('role', 'builder'))
  expect(took.text).toBe('relay: this session is now the builder.')
  expect(w.kv.get('roster')).toEqual({ S1: { ...S1, role: 'builder', since: expect.any(String) } })

  const shown = await $.command.run(typed('role', ''))
  expect(shown.text).toBe('relay: this session is the builder.')
  expect((await $.command.run(typed('role', 'boss'))).text).toMatch(/roles are planner, builder, reviewer/)
})

test('/role takes a role over from the session that held it', OPTIONS, async ($, on) => {
  const w = world(on, new Map(), { store: { roster: { S2: { ...S2, role: 'builder' } } } })
  const took = await $.command.run(typed('role', 'builder'))
  expect(took.text).toBe('relay: this session is now the builder (took it from other).')
  expect(Object.keys(w.kv.get('roster') as object)).toEqual(['S1'])
  const shown = await $.command.run(typed('role', ''))
  expect(shown.text).toBe('relay: this session is the builder.')
})

test('/handoff <role> writes the file, records it and messages the holder', OPTIONS, async ($, on) => {
  const files: Files = new Map()
  const w = world(on, files, { store: { roster: { S1: { ...S1, role: 'planner' }, S2: { ...S2, role: 'builder' } } } })
  const ran = await $.command.run(typed('handoff', 'builder wire the API client'))
  const path = '/vault/_relay/handoffs/2026-10-07T12-00-00Z_planner-to-builder.md'
  expect(ran.text).toBe(`relay: handoff sent to builder (other).\n${path}`)

  const written = files.get(path) ?? ''
  expect(written).toContain('to: builder')
  expect(written).toContain('note: "wire the API client"')
  expect(written).toContain('## Goal')
  expect(written).toContain('## Files touched\n- /work/app/src/a.ts')

  expect(handoffs(w)).toHaveLength(1)
  expect(handoffs(w)[0]).toMatchObject({ to: 'builder', status: 'pending', path, from: { sessionId: 'S1', role: 'planner' } })

  expect(w.sent).toHaveLength(1)
  expect(w.sent[0]?.text).toContain('[relay handoff 2026-10-07T12-00-00Z_planner-to-builder]')
  expect(w.sent[0]?.text).toContain(path)
})

test('/handoff to an unheld role writes the file and leaves it pending; /handoff out writes to the outbox', OPTIONS, async ($, on) => {
  const files: Files = new Map()
  const w = world(on, files)
  const ran = await $.command.run(typed('handoff', 'reviewer'))
  expect(ran.text).toMatch(/No session holds reviewer right now/)
  expect(files.has('/vault/_relay/handoffs/2026-10-07T12-00-00Z_unassigned-to-reviewer.md')).toBe(true)
  expect(w.sent).toHaveLength(0)

  const out = await $.command.run(typed('handoff', 'out for the chat planner'))
  expect(out.text).toBe('relay: wrote /vault/_relay/outbox/2026-10-07T12-00-00Z_unassigned-to-chat.md for chat or Cowork to read.')
  expect(files.get('/vault/_relay/outbox/2026-10-07T12-00-00Z_unassigned-to-chat.md')).toContain('to: chat')
  expect(handoffs(w).map(h => h.status)).toEqual(['pending', 'out'])
})

test('/handoff refuses to write into a folder that is not an Obsidian vault', OPTIONS, async ($, on) => {
  const files: Files = new Map()
  const w = world(on, files, { vault: false })
  const ran = await $.command.run(typed('handoff', 'builder'))
  expect(ran.text).toBe('relay: /vault is not an Obsidian vault (no .obsidian folder); fix vaultPath in /config.')
  expect(files.size).toBe(0)
  await $.session.start(START)
  await w.clock.advance(30_000)
  expect(w.logs.filter(l => l.includes('not an Obsidian vault'))).toHaveLength(1)
})

test('a handoff message is held for /handoff accept, shown in the band, and never answered', OPTIONS, async ($, on) => {
  const files: Files = new Map()
  const path = '/vault/_relay/handoffs/h1.md'
  files.set(path, '# Handoff\n## Goal\n- go')
  const record: RelayHandoff = { id: 'h1', from: { sessionId: 'S2', role: 'planner', name: 'other' }, to: 'builder', note: 'take over', path, at: 'x', status: 'pending' }
  const w = world(on, files, { store: { roster: { S1: { ...S1, role: 'builder' } }, handoffs: [record] } })
  await $.session.start(START)

  const received = await $.session.receive({ origin: { kind: 'peer', plugin: 'relay' }, text: `[relay handoff h1] planner (other) → builder: take over\n${path}` })
  expect(received).toEqual({ consumed: 'relay: handoff held in the band until /handoff accept' })
  expect(w.toasts).toEqual(['Handoff from planner: /handoff accept'])
  expect(w.logs).toContain(`relay: handoff from planner (other): ${path}`)
  expect(w.sent).toHaveLength(0)
  expect(w.submitted).toHaveLength(0)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /1 pending handoff/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'planner (other): take over' })).toBeDefined()
    await ui.unmount()
  }

  const listed = await $.command.run(typed('handoff', ''))
  expect(listed.text).toContain('1 pending for builder')

  const accepted = await $.command.run(typed('handoff', 'accept'))
  expect(accepted.text).toContain(`relay: accepted 1 handoff:\n- ${path}`)
  expect(accepted.context).toEqual([`Handoff h1 accepted by the person (${path}):\n\n# Handoff\n## Goal\n- go`])
  expect(handoffs(w)[0]?.status).toBe('accepted')

  const quiet = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await quiet.find({ type: 'Text', text: /pending handoff/ })).toBeUndefined()
  await quiet.unmount()
  expect((await $.command.run(typed('handoff', 'accept'))).text).toBe('relay: nothing to accept.')
})

test('a message that is not a relay handoff passes through untouched', OPTIONS, async ($, on) => {
  const w = world(on, new Map())
  const peer = await $.session.receive({ origin: { kind: 'peer' }, text: 'hello from a model' })
  expect(peer).toEqual({ text: 'hello from a model' })
  const inbox = await $.session.receive({ origin: { kind: 'peer', plugin: 'relay' }, text: '[relay inbox] note.md for builder\n\nto: builder\nhi' })
  expect(inbox).toEqual({ text: '[relay inbox] note.md for builder\n\nto: builder\nhi' })
  expect(w.toasts).toEqual(['relay: inbox message delivered to this session'])
  expect(w.sent).toHaveLength(0)
})

test('the inbox watcher delivers a `to:` file to the role holder once and moves it to done/', OPTIONS, async ($, on) => {
  const files: Files = new Map([['/vault/_relay/inbox/task.md', 'to: builder\n\nPlease add retries.']])
  const w = world(on, files, { store: { roster: { S1: { ...S1, role: 'planner' }, S2: { ...S2, role: 'builder' } } } })
  await $.session.start(START)
  await w.clock.advance(10_000)

  expect(w.sent).toEqual([{ to: expect.any(String), text: '[relay inbox] task.md for builder\n\nto: builder\n\nPlease add retries.' }])
  expect(files.has('/vault/_relay/inbox/task.md')).toBe(false)
  expect(files.get('/vault/_relay/inbox/done/task.md')).toBe('to: builder\n\nPlease add retries.')
  expect(w.logs).toContain('relay: delivered inbox/task.md to builder (other)')

  await w.clock.advance(20_000)
  expect(w.sent).toHaveLength(1)
})

test('the inbox watcher delivers to this session as a relay prompt when it holds the role', OPTIONS, async ($, on) => {
  const files: Files = new Map([['/vault/_relay/inbox/task.md', '---\nto: builder\n---\nPlease add retries.']])
  const w = world(on, files, { store: { roster: { S1: { ...S1, role: 'builder' } } } })
  await $.session.start(START)
  await w.clock.advance(10_000)
  expect(w.submitted).toEqual(['[relay inbox] task.md for builder\n\n---\nto: builder\n---\nPlease add retries.'])
  expect(w.sent).toHaveLength(0)
  expect(files.has('/vault/_relay/inbox/done/task.md')).toBe(true)
})

test('an inbox file nobody can take stays and is reported once; a lost claim is not delivered', OPTIONS, async ($, on) => {
  const files: Files = new Map([['/vault/_relay/inbox/task.md', 'to: reviewer\nhi']])
  const w = world(on, files, { store: { roster: { S2: { ...S2, role: 'builder' } } } })
  await $.session.start(START)
  await w.clock.advance(30_000)
  expect(files.has('/vault/_relay/inbox/task.md')).toBe(true)
  expect(w.logs.filter(l => l.includes('inbox/task.md waits'))).toHaveLength(1)
  expect(w.sent).toHaveLength(0)

  files.set('/vault/_relay/inbox/race.md', 'to: builder\nhi')
  w.race.add('/vault/_relay/inbox/race.md')
  await w.clock.advance(10_000)
  expect(w.sent).toHaveLength(0)
  expect(files.has('/vault/_relay/inbox/done/race.md')).toBe(false)
})

test('a holder that is no longer running is dropped from the roster and the file put back', OPTIONS, async ($, on) => {
  const files: Files = new Map([['/vault/_relay/inbox/task.md', 'to: builder\nhi']])
  const w = world(on, files, { store: { roster: { S2: { ...S2, name: 'gone', role: 'builder' } } }, deliver: false })
  await $.session.start(START)
  await w.clock.advance(10_000)
  expect(files.has('/vault/_relay/inbox/task.md')).toBe(true)
  expect(w.kv.get('roster')).toEqual({})
  expect(w.logs).toContain('relay: gone (builder) is not running; dropped it from the roster, inbox/task.md stays')
})

test('session.end drops this session from the roster', OPTIONS, async ($, on) => {
  const w = world(on, new Map(), { store: { roster: { S1: { ...S1, role: 'builder' } } } })
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'S1', resume: { id: 'S1' } })
  expect(w.kv.get('roster')).toEqual({})
})
