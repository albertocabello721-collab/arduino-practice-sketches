import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelUsage, On, TurnStepInput } from 'claude-code'
import type { ThriftLedgerRow, ThriftTotals } from '../types'

const OPUS = 'claude-opus-5-5'
const START = { cwd: '/work/app', surface: 'terminal' as const, isInteractive: true }
const typed = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } })
const prompt = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })
const noUsage: ModelUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

type World = { store?: Record<string, unknown>; contextTokens?: number; usage?: (model: string, e: TurnStepInput) => ModelUsage }

/** The world beneath thrift: a store, a clock, a session on opus, and a model that answers every step on the model it was asked for. */
function world(on: On, { store = {}, contextTokens = 12_000, usage }: World = {}) {
  const kv = new Map<string, unknown>(Object.entries(store))
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 7, 12, 0, 0) })
  const steps: { index: number; model: string; agentId?: string }[] = []
  const spawned: { model?: string; subagentType: string }[] = []
  const submitted: string[] = []

  on('store.get', ($, e) => ({ value: kv.get(e.key) }))
  on('store.set', ($, e) => { kv.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined } })
  on('store.delete', ($, e) => { kv.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...kv.keys()] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, tokens: contextTokens, percent: Math.round((contextTokens / 200_000) * 100) }, rateLimits: [] } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.submit', ($, e) => { submitted.push(e.text); return { text: e.text } })
  on('classic.UserPromptSubmit', () => ({}))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))
  on('agent.spawn', ($, e) => { spawned.push({ model: e.model, subagentType: e.subagentType }); return { model: e.model ?? e.parentModel, agentId: `A${spawned.length}` } })
  on('turn.step', async function* ($, e) {
    steps.push({ index: e.index, model: e.model, ...(e.agentId === undefined ? {} : { agentId: e.agentId }) })
    yield { kind: 'text' as const, index: 0, text: 'ok' }
    const u = usage === undefined ? { ...noUsage, input_tokens: 100, output_tokens: 50 } : usage(e.model, e)
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage: { ...u, model: e.model } }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn' as const, usage: { ...u, model: e.model } }
  })
  return { clock, kv, steps, spawned, submitted }
}

/** Runs one main-conversation turn of `requests` model requests and returns the models they went to. */
async function turn($: Engine, w: ReturnType<typeof world>, text: string, requests = 2, turnId = 't1') {
  await $.prompt.submit(prompt(text))
  await $.classic.UserPromptSubmit({ prompt: text, permission_mode: 'default' })
  await $.turn.start({ text: w.submitted.at(-1) ?? text, turnId })
  const before = w.steps.length
  for (let index = 0; index < requests; index += 1) {
    const stream = $.turn.step({ turnId, index, model: OPUS, messageCount: 2 + index })
    for await (const chunk of stream) void chunk
    await stream.result
  }
  const done = await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId, reason: 'answer', usage: { ...noUsage, model: OPUS } })
  return { models: w.steps.slice(before).map(s => s.model), done }
}

test('a trivial prompt runs the whole turn on haiku and says so under the answer', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const { models, done } = await turn($, w, 'commit this')
  expect(models).toEqual(['haiku', 'haiku'])
  expect(done.text).toBe('thrift: this turn ran on haiku (git housekeeping); start a prompt with !! to keep claude-opus-5-5')
  const totals = w.kv.get('totals') as ThriftTotals
  expect(totals.routedTurns).toBe(1)
  expect(totals.requests).toBe(2)
})

test('a routine edit goes to sonnet, judgment stays on the chosen model, and a mid-turn request never switches', async ($, on) => {
  const w = world(on)
  expect((await turn($, w, 'add a log line when the cache misses', 1, 't1')).models).toEqual(['sonnet'])
  const kept = await turn($, w, 'why is the auth flow flaky across services? investigate the root cause', 2, 't2')
  expect(kept.models).toEqual([OPUS, OPUS])
  expect(kept.done.text).toBe('ok')
  // a decision belongs to its turn: a step of another turn id is left alone
  const stream = $.turn.step({ turnId: 'other', index: 0, model: OPUS, messageCount: 1 })
  for await (const chunk of stream) void chunk
  expect(w.steps.at(-1)?.model).toBe(OPUS)
})

test('!! keeps the chosen model and is stripped from the prompt', async ($, on) => {
  const w = world(on)
  const { models } = await turn($, w, '!! commit this')
  expect(w.submitted.at(-1)).toBe('commit this')
  expect(models).toEqual([OPUS, OPUS])
  // the next plain turn is routed again: the force applied once
  expect((await turn($, w, 'commit this', 1, 't2')).models).toEqual(['haiku'])
})

test('plan mode and a large context keep the chosen model; the ceiling is an option', { options: { maxContextTokens: 60000 } }, async ($, on) => {
  const w = world(on, { contextTokens: 45_000 })
  expect((await turn($, w, 'commit this', 1)).models).toEqual(['haiku'])
  await $.classic.UserPromptSubmit({ prompt: 'commit this', permission_mode: 'plan' })
  await $.turn.start({ text: 'commit this', turnId: 'plan' })
  const stream = $.turn.step({ turnId: 'plan', index: 0, model: OPUS, messageCount: 1 })
  for await (const chunk of stream) void chunk
  expect(w.steps.at(-1)?.model).toBe(OPUS)
})

test('a context over the default ceiling keeps the chosen model', async ($, on) => {
  const w = world(on, { contextTokens: 31_000 })
  expect((await turn($, w, 'commit this', 1)).models).toEqual([OPUS])
})

test('a session already on a cheaper model is never upgraded, and /thrift off stops routing', async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'add a log line', turnId: 't1' })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1 })
  for await (const chunk of stream) void chunk
  expect(w.steps.at(-1)?.model).toBe('claude-sonnet-5-5')

  expect((await $.command.run(typed('thrift', 'off'))).text).toMatch(/^thrift: off\./)
  expect((await turn($, w, 'commit this', 1, 't2')).models).toEqual([OPUS])
  expect((await $.command.run(typed('thrift', 'on'))).text).toMatch(/^thrift: on\./)
  expect((await turn($, w, 'commit this', 1, 't3')).models).toEqual(['haiku'])
})

test('read-only subagents go to haiku unless the call named a model; others are untouched', async ($, on) => {
  const w = world(on)
  const spawn = (subagentType: string, model?: string) =>
    $.agent.spawn({ prompt: 'look around', description: 'look', subagentType, ...(model === undefined ? {} : { model }), parentModel: OPUS, tool_use_id: 'u', provider: { plugin: 'engine', tier: 'core' }, background: false, fork: false } as never)
  const explore = await spawn('Explore')
  expect(explore).toMatchObject({ model: 'haiku', agentId: 'A1' })
  expect((await spawn('general-purpose')).model).toBe(OPUS)
  expect((await spawn('Explore', 'opus')).model).toBe('opus')
  expect(w.spawned.map(s => s.model)).toEqual(['haiku', undefined, 'opus'])
  expect((w.kv.get('totals') as ThriftTotals).routedAgents).toBe(1)

  // the subagent's own requests are in the ledger against the parent's model
  const stream = $.turn.step({ turnId: 'sub', index: 0, model: 'claude-haiku-4-5', messageCount: 1, agentId: 'A1' })
  for await (const chunk of stream) void chunk
  const ledger = w.kv.get('ledger') as ThriftLedgerRow[]
  expect(ledger.at(-1)).toMatchObject({ agentId: 'A1', asked: OPUS, used: 'claude-haiku-4-5', reason: 'read-only subagent Explore' })
  expect((ledger.at(-1)?.baselineUsd ?? 0) > (ledger.at(-1)?.actualUsd ?? 0)).toBe(true)
})

test('the ledger counts the cache miss of a switch, and the report says when main-conversation routing lost', async ($, on) => {
  // the first request after a switch rewrites the whole context into the new model's cache
  const usage = (model: string, e: TurnStepInput): ModelUsage =>
    e.index === 0 && (model === 'haiku' || e.turnId === 't3')
      ? { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 28_000 }
      : { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 28_000, cache_creation_input_tokens: 0 }
  const w = world(on, { usage })
  await turn($, w, 'tell me about the structure of this repo in depth, consider the design', 1, 't1') // kept: opus, warm
  await turn($, w, 'commit this', 2, 't2')                                                      // haiku: cold write, then warm
  await turn($, w, 'review the architecture', 1, 't3')                                          // back on opus: cold again
  const rows = w.kv.get('ledger') as ThriftLedgerRow[]
  expect(rows.map(r => r.used)).toEqual([OPUS, 'haiku', 'haiku', OPUS])
  expect(rows[1]?.baselineUsd).toBeLessThan(rows[1]?.actualUsd ?? 0)
  expect(rows[3]?.baselineUsd).toBeLessThan(rows[3]?.actualUsd ?? 0)
  const text = (await $.command.run(typed('thrift', 'report'))).text ?? ''
  expect(text).toContain('Main conversation: 1 turn rerouted.')
  expect(text).toContain('LOST')
  expect(text).toContain('Main-conversation routing is losing.')
  expect(text).toContain('claude-opus-5-5 → haiku')
  const status = (await $.command.run(typed('thrift', 'status'))).text ?? ''
  expect(status).toContain('thrift: on. Context ceiling 30k tokens; haiku agents: Explore, claude-code-guide.')
  expect(status).toContain('last turn kept its model (asks for judgment)')
})

test('a small context routed to haiku saves, and the report says so', async ($, on) => {
  const usage = (model: string, e: TurnStepInput): ModelUsage =>
    e.index === 0 && model === 'haiku'
      ? { input_tokens: 2000, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 1000 }
      : { input_tokens: 500, output_tokens: 400, cache_read_input_tokens: 2500, cache_creation_input_tokens: 0 }
  const w = world(on, { usage, contextTokens: 3000 })
  await turn($, w, 'commit this', 3, 't1')
  const text = (await $.command.run(typed('thrift', 'report'))).text ?? ''
  expect(text).toMatch(/Main conversation: 1 turn rerouted\. Actual \$[\d.]+ vs \$[\d.]+ on your model with a warm cache: saved \$/)
  expect(text).not.toContain('LOST')
})
