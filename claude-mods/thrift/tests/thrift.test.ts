import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelUsage, On, TurnStepInput } from 'claude-code'
import type { ThriftLedgerRow, ThriftTotals } from '../types'

const OPUS = 'claude-opus-5-5'
const HAIKU = 'claude-haiku-5-5'
const SONNET = 'claude-sonnet-5-5'
const START = { cwd: '/work/app', surface: 'terminal' as const, isInteractive: true }
const typed = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } })
const prompt = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })
const noUsage: ModelUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/** What the model beneath does with a request instead of answering it on the model it names. */
type Fault = 'throw' | 'silent' | 'refusal' | { answeredBy: string }
type World = {
  store?: Record<string, unknown>
  contextTokens?: number
  usage?: (model: string, e: TurnStepInput) => ModelUsage
  fault?: (model: string, e: TurnStepInput) => Fault | undefined
}

/** The world beneath thrift: a store, a clock, a session on opus, and a model that answers every step on the model it was asked for unless `fault` says otherwise. */
function world(on: On, { store = {}, contextTokens = 12_000, usage, fault }: World = {}) {
  const kv = new Map<string, unknown>(Object.entries(store))
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 7, 12, 0, 0) })
  const w = {
    clock,
    kv,
    steps: [] as { index: number; model: string; agentId?: string }[],
    spawned: [] as { model?: string; subagentType: string }[],
    submitted: [] as string[],
    logs: [] as string[],
    configSets: [] as string[],
    fault,
  }

  on('store.get', ($, e) => ({ value: kv.get(e.key) }))
  on('store.set', ($, e) => { kv.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined } })
  on('store.delete', ($, e) => { kv.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...kv.keys()] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, tokens: contextTokens, percent: Math.round((contextTokens / 200_000) * 100) }, rateLimits: [] } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', ($, e) => { w.logs.push(e.text); return { value: undefined } })
  on('config.set', ($, e) => { w.configSets.push(e.key); return { value: e.value } })
  on('prompt.submit', ($, e) => { w.submitted.push(e.text); return { text: e.text } })
  on('classic.UserPromptSubmit', () => ({}))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))
  on('agent.spawn', ($, e) => { w.spawned.push({ model: e.model, subagentType: e.subagentType }); return { model: e.model ?? e.parentModel, agentId: `A${w.spawned.length}` } })
  on('turn.step', async function* ($, e) {
    w.steps.push({ index: e.index, model: e.model, ...(e.agentId === undefined ? {} : { agentId: e.agentId }) })
    const f = w.fault?.(e.model, e)
    // the kit skips a hook that throws and its bottom throws in its place: what a request that errors does to `next`
    if (f === 'throw') throw new Error(`404 not_found_error: model: ${e.model}`)
    if (f === 'silent') return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
    const model = typeof f === 'object' ? f.answeredBy : e.model
    const stopReason = f === 'refusal' ? ('refusal' as const) : ('end_turn' as const)
    const u = usage === undefined ? { ...noUsage, input_tokens: 100, output_tokens: 50 } : usage(e.model, e)
    yield { kind: 'text' as const, index: 0, text: `from ${model}` }
    yield { kind: 'stop' as const, stopReason, usage: { ...u, model } }
    return { turnId: e.turnId, index: e.index, answer: `from ${model}`, toolUses: [], stopReason, usage: { ...u, model } }
  })
  return w
}

/** Sends one model request and returns the text that came out of the chain for it. */
async function step($: Engine, input: TurnStepInput) {
  const stream = $.turn.step(input)
  const texts: string[] = []
  for await (const chunk of stream) if (chunk.kind === 'text') texts.push(chunk.text)
  await stream.result
  return texts.join('')
}

/** Runs one main-conversation turn of `requests` model requests: the models they went to, and the text each one showed. */
async function turn($: Engine, w: ReturnType<typeof world>, text: string, requests = 2, turnId = 't1') {
  await $.prompt.submit(prompt(text))
  await $.classic.UserPromptSubmit({ prompt: text, permission_mode: 'default' })
  await $.turn.start({ text: w.submitted.at(-1) ?? text, turnId })
  const before = w.steps.length
  const texts: string[] = []
  for (let index = 0; index < requests; index += 1) texts.push(await step($, { turnId, index, model: OPUS, messageCount: 2 + index }))
  const done = await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId, reason: 'answer', usage: { ...noUsage, model: OPUS } })
  return { models: w.steps.slice(before).map(s => s.model), texts, done }
}

const spawn = ($: Engine, subagentType: string, model?: string) =>
  $.agent.spawn({ prompt: 'look around', description: 'look', subagentType, ...(model === undefined ? {} : { model }), parentModel: OPUS, tool_use_id: 'u', provider: { plugin: 'engine', tier: 'core' }, background: false, fork: false } as never)

const totalsOf = (w: ReturnType<typeof world>) => w.kv.get('totals') as ThriftTotals
const ledgerOf = (w: ReturnType<typeof world>) => w.kv.get('ledger') as ThriftLedgerRow[]
const STOPPED = 'Rerouting is off for the rest of this session (/thrift on turns it back on).'
/** The one notice of a rerouted request that threw, whatever the error said. */
const THREW = /^thrift: claude-haiku-5-5 failed \(.+\); the request runs again on claude-opus-5-5\. Rerouting is off for the rest of this session \(\/thrift on turns it back on\)\.$/

test('a trivial prompt runs the whole turn on haiku, by its full id, and says so under the answer', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const { models, texts, done } = await turn($, w, 'commit this')
  expect(models).toEqual([HAIKU, HAIKU])
  // a rerouted response is held until it is whole, then goes up as it was
  expect(texts).toEqual([`from ${HAIKU}`, `from ${HAIKU}`])
  expect(done.text).toBe('thrift: this turn ran on claude-haiku-5-5 (git housekeeping); start a prompt with !! to keep claude-opus-5-5')
  expect(totalsOf(w)).toMatchObject({ routedTurns: 1, routedRequests: 2, requests: 2 })
  expect(w.logs).toEqual([])
})

test('the line and the ledger name the model that answered, as the API reported it', async ($, on) => {
  // the API reports a dated id for the model the request named: still that model
  const w = world(on, { fault: model => (model === HAIKU ? { answeredBy: 'claude-haiku-5-5-20260915' } : undefined) })
  const { models, done } = await turn($, w, 'commit this', 1)
  expect(models).toEqual([HAIKU])
  expect(done.text).toBe('thrift: this turn ran on claude-haiku-5-5-20260915 (git housekeeping); start a prompt with !! to keep claude-opus-5-5')
  expect(ledgerOf(w).map(r => [r.asked, r.used])).toEqual([[OPUS, 'claude-haiku-5-5-20260915']])
  expect((await $.command.run(typed('thrift', 'status'))).text).toContain('last turn ran on claude-haiku-5-5-20260915 (git housekeeping)')
  expect(w.logs).toEqual([])
})

test('a routine edit goes to sonnet, judgment stays on the chosen model, and a mid-turn request never switches', async ($, on) => {
  const w = world(on)
  expect((await turn($, w, 'add a log line when the cache misses', 1, 't1')).models).toEqual([SONNET])
  const kept = await turn($, w, 'why is the auth flow flaky across services? investigate the root cause', 2, 't2')
  expect(kept.models).toEqual([OPUS, OPUS])
  expect(kept.done.text).toBe('ok')
  // a decision belongs to its turn: a step of another turn id is left alone
  await step($, { turnId: 'other', index: 0, model: OPUS, messageCount: 1 })
  expect(w.steps.at(-1)?.model).toBe(OPUS)
})

test('!! keeps the chosen model and is stripped from the prompt', async ($, on) => {
  const w = world(on)
  const { models } = await turn($, w, '!! commit this')
  expect(w.submitted.at(-1)).toBe('commit this')
  expect(models).toEqual([OPUS, OPUS])
  // the next plain turn is routed again: the force applied once
  expect((await turn($, w, 'commit this', 1, 't2')).models).toEqual([HAIKU])
})

test('plan mode and a large context keep the chosen model; the ceiling is an option', { options: { maxContextTokens: 60000 } }, async ($, on) => {
  const w = world(on, { contextTokens: 45_000 })
  expect((await turn($, w, 'commit this', 1)).models).toEqual([HAIKU])
  await $.classic.UserPromptSubmit({ prompt: 'commit this', permission_mode: 'plan' })
  await $.turn.start({ text: 'commit this', turnId: 'plan' })
  await step($, { turnId: 'plan', index: 0, model: OPUS, messageCount: 1 })
  expect(w.steps.at(-1)?.model).toBe(OPUS)
})

test('a context over the default ceiling keeps the chosen model', async ($, on) => {
  const w = world(on, { contextTokens: 31_000 })
  expect((await turn($, w, 'commit this', 1)).models).toEqual([OPUS])
})

test('a session already on a cheaper model is never upgraded, and /thrift off stops routing', async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'add a log line', turnId: 't1' })
  await step($, { turnId: 't1', index: 0, model: SONNET, messageCount: 1 })
  expect(w.steps.at(-1)?.model).toBe(SONNET)

  expect((await $.command.run(typed('thrift', 'off'))).text).toMatch(/^thrift: off\./)
  expect((await turn($, w, 'commit this', 1, 't2')).models).toEqual([OPUS])
  expect((await $.command.run(typed('thrift', 'on'))).text).toMatch(/^thrift: on\./)
  expect((await turn($, w, 'commit this', 1, 't3')).models).toEqual([HAIKU])
})

test('the models turns go to are options', { options: { haikuModel: 'claude-haiku-4-5', sonnetModel: 'claude-sonnet-5' } }, async ($, on) => {
  const w = world(on)
  expect((await turn($, w, 'commit this', 1, 't1')).models).toEqual(['claude-haiku-4-5'])
  expect((await turn($, w, 'add a log line when the cache misses', 1, 't2')).models).toEqual(['claude-sonnet-5'])
  expect((await $.command.run(typed('thrift', 'status'))).text).toContain('Trivial turns go to claude-haiku-4-5, routine ones to claude-sonnet-5.')
})

test('read-only subagents go to haiku unless the call named a model; others are untouched', async ($, on) => {
  const w = world(on)
  // agent.spawn takes the Agent tool's alias, which the engine resolves
  expect(await spawn($, 'Explore')).toMatchObject({ model: 'haiku', agentId: 'A1' })
  expect((await spawn($, 'general-purpose')).model).toBe(OPUS)
  expect((await spawn($, 'Explore', 'opus')).model).toBe('opus')
  expect(w.spawned.map(s => s.model)).toEqual(['haiku', undefined, 'opus'])
  // a subagent counts as rerouted once a cheaper model has answered a request of it
  expect(w.kv.get('totals')).toBeUndefined()

  // the subagent's own requests are in the ledger against the parent's model
  expect(await step($, { turnId: 'sub', index: 0, model: 'claude-haiku-4-5', messageCount: 1, agentId: 'A1' })).toBe('from claude-haiku-4-5')
  await step($, { turnId: 'sub', index: 1, model: 'claude-haiku-4-5', messageCount: 3, agentId: 'A1' })
  const ledger = ledgerOf(w)
  expect(ledger.at(-1)).toMatchObject({ agentId: 'A1', asked: OPUS, used: 'claude-haiku-4-5', reason: 'read-only subagent Explore' })
  expect((ledger.at(-1)?.baselineUsd ?? 0) > (ledger.at(-1)?.actualUsd ?? 0)).toBe(true)
  expect(totalsOf(w)).toMatchObject({ routedAgents: 1, routedRequests: 2, routedTurns: 0 })
})

test('the ledger counts the cache miss of a switch, and the report says when main-conversation routing lost', { options: { haikuModel: 'claude-haiku-4-5' } }, async ($, on) => {
  // the first request after a switch rewrites the whole context into the new model's cache
  const usage = (model: string, e: TurnStepInput): ModelUsage =>
    e.index === 0 && (model === 'claude-haiku-4-5' || e.turnId === 't3')
      ? { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 28_000 }
      : { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 28_000, cache_creation_input_tokens: 0 }
  const w = world(on, { usage })
  await turn($, w, 'tell me about the structure of this repo in depth, consider the design', 1, 't1') // kept: opus, warm
  await turn($, w, 'commit this', 2, 't2')                                                      // haiku: cold write, then warm
  await turn($, w, 'review the architecture', 1, 't3')                                          // back on opus: cold again
  const rows = ledgerOf(w)
  expect(rows.map(r => r.used)).toEqual([OPUS, 'claude-haiku-4-5', 'claude-haiku-4-5', OPUS])
  expect(rows[1]?.baselineUsd).toBeLessThan(rows[1]?.actualUsd ?? 0)
  expect(rows[3]?.baselineUsd).toBeLessThan(rows[3]?.actualUsd ?? 0)
  const text = (await $.command.run(typed('thrift', 'report'))).text ?? ''
  expect(text).toContain('Main conversation: 1 turn rerouted.')
  expect(text).toContain('Requests recorded: 4, rerouted: 2.')
  expect(text).toContain('LOST')
  expect(text).toContain('Main-conversation routing is losing.')
  expect(text).toContain('claude-opus-5-5 → claude-haiku-4-5')
  const status = (await $.command.run(typed('thrift', 'status'))).text ?? ''
  expect(status).toContain('thrift: on. Context ceiling 30k tokens; haiku agents: Explore, claude-code-guide.')
  expect(status).toContain('last turn kept its model (asks for judgment)')
})

test('a small context routed to haiku saves, and the report says so', async ($, on) => {
  const usage = (model: string, e: TurnStepInput): ModelUsage =>
    e.index === 0 && model === HAIKU
      ? { input_tokens: 2000, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 1000 }
      : { input_tokens: 500, output_tokens: 400, cache_read_input_tokens: 2500, cache_creation_input_tokens: 0 }
  const w = world(on, { usage, contextTokens: 3000 })
  await turn($, w, 'commit this', 3, 't1')
  const text = (await $.command.run(typed('thrift', 'report'))).text ?? ''
  expect(text).toMatch(/Main conversation: 1 turn rerouted\. Actual \$[\d.]+ vs \$[\d.]+ on your model with a warm cache: saved \$/)
  expect(text).not.toContain('LOST')
})

// The failed-reroute path.

test('a rerouted request that errors runs again once on the chosen model, and the session stops rerouting with one notice', async ($, on) => {
  const w = world(on, { fault: model => (model === HAIKU ? 'throw' : undefined) })
  await $.session.start(START)
  const first = await turn($, w, 'commit this', 2)
  // the failed attempt, its one retry, then the turn's next request, which is not rerouted any more
  expect(first.models).toEqual([HAIKU, OPUS, OPUS])
  expect(first.texts).toEqual([`from ${OPUS}`, `from ${OPUS}`])
  // nothing ran on haiku, so no line claims it did
  expect(first.done.text).toBe('ok')
  expect(w.logs).toHaveLength(1)
  expect(w.logs[0]).toMatch(THREW)
  expect(totalsOf(w)).toMatchObject({ requests: 2, routedRequests: 0, routedTurns: 0, routedAgents: 0 })
  expect(ledgerOf(w).map(r => [r.asked, r.used])).toEqual([[OPUS, OPUS], [OPUS, OPUS]])
  expect(ledgerOf(w)[0]?.reason).toMatch(/^git housekeeping; ran again after claude-haiku-5-5 failed \(.+\)$/)

  // the rest of the session: no turn and no subagent is rerouted, and nothing more is said
  const second = await turn($, w, 'commit this', 1, 't2')
  expect(second.models).toEqual([OPUS])
  expect(second.done.text).toBe('ok')
  expect((await spawn($, 'Explore')).model).toBe(OPUS)
  expect(w.spawned.at(-1)?.model).toBeUndefined()
  expect(w.logs).toHaveLength(1)
  // thrift never set the session's model
  expect(w.configSets).toEqual([])

  const status = (await $.command.run(typed('thrift', 'status'))).text ?? ''
  expect(status).toMatch(/Rerouting stopped for this session at 12:00:00: claude-haiku-5-5 failed \(.+\)\. \/thrift on turns it back on\./)
  expect(status).toContain('last turn kept its model (rerouting stopped for this session)')
  const report = (await $.command.run(typed('thrift', 'report'))).text ?? ''
  expect(report).toContain('Rerouting stopped for this session')
  expect(report).toContain('Main conversation: 0 turns rerouted.')
  expect(report).toContain('Requests recorded: 3, rerouted: 0.')
  expect(report).toContain('No rerouted requests in the ledger.')

  // /thrift on turns rerouting back on
  w.fault = undefined
  await $.command.run(typed('thrift', 'on'))
  const third = await turn($, w, 'commit this', 1, 't3')
  expect(third.models).toEqual([HAIKU])
  expect(third.done.text).toContain('this turn ran on claude-haiku-5-5')
})

const faults: [name: string, fault: Fault, cause: string, discarded: string | null][] = [
  ['sends no response', 'silent', 'did not answer', null],
  ['refuses', 'refusal', 'refused the request', HAIKU],
  ['is answered by another model', { answeredBy: 'claude-opus-5' }, 'was answered by claude-opus-5 instead', 'claude-opus-5'],
]
for (const [name, fault, cause, discarded] of faults) {
  test(`a rerouted request that ${name} is dropped whole and runs again on the chosen model`, async ($, on) => {
    const w = world(on, { fault: model => (model === HAIKU ? fault : undefined) })
    const { models, texts, done } = await turn($, w, 'commit this', 1)
    expect(models).toEqual([HAIKU, OPUS])
    // nothing of the dropped response came out of the chain
    expect(texts).toEqual([`from ${OPUS}`])
    expect(done.text).toBe('ok')
    expect(w.logs).toEqual([`thrift: claude-haiku-5-5 ${cause}; the request runs again on claude-opus-5-5. ${STOPPED}`])
    const rows = ledgerOf(w)
    expect(rows.at(-1)).toMatchObject({ asked: OPUS, used: OPUS, reason: `git housekeeping; ran again after claude-haiku-5-5 ${cause}` })
    expect(rows.at(-1)?.discarded).toBeUndefined()
    if (discarded === null) expect(rows).toHaveLength(1)
    else {
      // the dropped response was paid for: it is in the ledger under the model that sent it, against a baseline of nothing
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({ asked: OPUS, used: discarded, discarded: true, baselineUsd: 0 })
      expect(rows[0]?.actualUsd).toBeGreaterThan(0)
    }
    expect(totalsOf(w)).toMatchObject({ routedRequests: 0, routedTurns: 0 })
    expect((await turn($, w, 'commit this', 1, 't2')).models).toEqual([OPUS])
    expect(w.logs).toHaveLength(1)
  })
}

test('when the engine keeps the chosen model for a rerouted request, that answer stands and rerouting stops', async ($, on) => {
  const w = world(on, { fault: model => (model === HAIKU ? { answeredBy: OPUS } : undefined) })
  const { models, texts, done } = await turn($, w, 'commit this', 2)
  // no second request for the first one: the chosen model had answered it
  expect(models).toEqual([HAIKU, OPUS])
  expect(texts).toEqual([`from ${OPUS}`, `from ${OPUS}`])
  expect(done.text).toBe('ok')
  expect(w.logs).toEqual([`thrift: claude-haiku-5-5 was answered by claude-opus-5-5 instead; that answer stands. ${STOPPED}`])
  expect(ledgerOf(w).map(r => [r.asked, r.used, r.discarded])).toEqual([[OPUS, OPUS, undefined], [OPUS, OPUS, undefined]])
  expect(totalsOf(w)).toMatchObject({ requests: 2, routedRequests: 0, routedTurns: 0 })
})

test('a turn whose reroute fails partway reports the requests that did run on the cheaper model', async ($, on) => {
  const w = world(on, { fault: (model, e) => (model === HAIKU && e.index === 1 ? 'throw' : undefined) })
  const { models, texts, done } = await turn($, w, 'commit this', 3)
  expect(models).toEqual([HAIKU, HAIKU, OPUS, OPUS])
  expect(texts).toEqual([`from ${HAIKU}`, `from ${OPUS}`, `from ${OPUS}`])
  expect(done.text).toMatch(/^thrift: this turn had 1 of its 3 requests run on claude-haiku-5-5 \(git housekeeping, but claude-haiku-5-5 failed \(.+\)\); start a prompt with !! to keep claude-opus-5-5$/)
  // one turn, one request: the two counts agree
  expect(totalsOf(w)).toMatchObject({ requests: 3, routedRequests: 1, routedTurns: 1 })
  const report = (await $.command.run(typed('thrift', 'report'))).text ?? ''
  expect(report).toContain('Main conversation: 1 turn rerouted.')
  expect(report).toContain('Requests recorded: 3, rerouted: 1.')
  expect(report).toContain('Last 1 rerouted requests:')
})

test('a rerouted subagent whose request fails goes on with the model its spawn asked for', async ($, on) => {
  const w = world(on, { fault: model => (model === HAIKU ? 'throw' : undefined) })
  expect(await spawn($, 'Explore')).toMatchObject({ model: 'haiku', agentId: 'A1' })
  // the engine resolved the alias: the subagent's requests name the full id
  expect(await step($, { turnId: 'sub', index: 0, model: HAIKU, messageCount: 1, agentId: 'A1' })).toBe(`from ${OPUS}`)
  expect(await step($, { turnId: 'sub', index: 1, model: HAIKU, messageCount: 3, agentId: 'A1' })).toBe(`from ${OPUS}`)
  expect(w.steps.map(s => [s.agentId, s.model])).toEqual([['A1', HAIKU], ['A1', OPUS], ['A1', OPUS]])
  expect(w.logs).toHaveLength(1)
  expect(w.logs[0]).toMatch(THREW)
  expect(ledgerOf(w).map(r => [r.agentId, r.asked, r.used])).toEqual([['A1', OPUS, OPUS], ['A1', OPUS, OPUS]])
  expect(totalsOf(w)).toMatchObject({ requests: 2, routedRequests: 0, routedAgents: 0 })
  // and the main conversation is not rerouted either
  expect((await turn($, w, 'commit this', 1)).models).toEqual([OPUS])
  expect(w.logs).toHaveLength(1)
})

test('totals that counted a rerouted turn without a rerouted request are put right', async ($, on) => {
  // what 0.1.0 stored after a turn it decided to reroute and no model answered
  const stale: ThriftTotals = { requests: 8, routedRequests: 0, routedTurns: 1, routedAgents: 0, mainActualUsd: 0.42, mainBaselineUsd: 0.42, agentActualUsd: 0, agentBaselineUsd: 0 }
  world(on, { store: { totals: stale } })
  const report = (await $.command.run(typed('thrift', 'report'))).text ?? ''
  expect(report).toContain('Main conversation: 0 turns rerouted.')
  expect(report).toContain('Requests recorded: 8, rerouted: 0.')
})
