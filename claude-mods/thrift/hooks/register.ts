import type { EngineInterface, ModelUsage, Register, TurnStepChunk, TurnStepResult } from 'claude-code'

import type { ThriftAgent, ThriftDecision, ThriftHalt, ThriftLedgerRow, ThriftPending, ThriftSummary, ThriftTotals } from '../types'
import { SPAWN_MODEL, STEP_MODEL, classify, isSameModel, tierOf } from './classify'
import { baselineOf, costOf, count, usd } from './prices'

// thrift: cheap work to cheaper models.
//   agent.spawn  read-only subagent types (option haikuAgents) run on haiku unless the call names a model.
//   turn.start   decides the main conversation's model for the whole turn from free heuristics,
//                plan mode, a `!!` prefix and the context size; turn.step applies it to every request.
//   turn.step    also keeps the ledger: one row per main-conversation request and per rerouted-agent request.
//                A rerouted request fails open: its response is held until it is whole, and one that errors,
//                ends without an answer or came from another model is dropped while the request runs again,
//                once, on the model asked for. The session then reroutes nothing more (halted).
// Persistent: $.store  enabled, ledger (last LEDGER_KEEP rows), totals.
// Session:    $.state  enabled, pending, decision, agents, summary, lastMainModel, halted (see types/).
// thrift never sets the session's model: a reroute is the `model` of one request, and a failed one is
// retried here so the engine's own fallback, which moves the session's model, never sees it.

const LEDGER_KEEP = 400
const REPORT_ROWS = 20

const ENABLED = { plugin: 'thrift', key: 'enabled' } as const
const PENDING = { plugin: 'thrift', key: 'pending' } as const
const DECISION = { plugin: 'thrift', key: 'decision' } as const
const AGENTS = { plugin: 'thrift', key: 'agents' } as const
const SUMMARY = { plugin: 'thrift', key: 'summary' } as const
const LAST_MAIN = { plugin: 'thrift', key: 'lastMainModel' } as const
const HALTED = { plugin: 'thrift', key: 'halted' } as const

const EMPTY_TOTALS: ThriftTotals = {
  requests: 0, routedRequests: 0, routedTurns: 0, routedAgents: 0,
  mainActualUsd: 0, mainBaselineUsd: 0, agentActualUsd: 0, agentBaselineUsd: 0,
}

/** A request a cheaper model than the one asked for answered, its answer kept. */
const isRouted = (row: ThriftLedgerRow) => row.discarded !== true && tierOf(row.used) < tierOf(row.asked)

async function isEnabled($: EngineInterface): Promise<boolean> {
  const raw = await $.store.get('enabled')
  return raw !== false
}

async function getTotals($: EngineInterface): Promise<ThriftTotals> {
  const raw = await $.store.get('totals')
  const totals = raw !== null && typeof raw === 'object' ? { ...EMPTY_TOTALS, ...(raw as Partial<ThriftTotals>) } : { ...EMPTY_TOTALS }
  // Every rerouted turn and agent has a rerouted request. 0.1.0 counted them when decided, answered or not.
  totals.routedAgents = Math.min(totals.routedAgents, totals.routedRequests)
  totals.routedTurns = Math.min(totals.routedTurns, totals.routedRequests - totals.routedAgents)
  return totals
}

async function getLedger($: EngineInterface): Promise<ThriftLedgerRow[]> {
  const raw = await $.store.get('ledger')
  return Array.isArray(raw) ? (raw as ThriftLedgerRow[]) : []
}

async function getPending($: EngineInterface): Promise<ThriftPending> {
  return (await $.state.get(PENDING)).value ?? { force: false, mode: null }
}

async function getHalt($: EngineInterface): Promise<ThriftHalt | null> {
  return (await $.state.get(HALTED)).value ?? null
}

/** Mirrors the totals into $.state for other mods. */
async function publish($: EngineInterface, totals: ThriftTotals, lastRoute: string | null | undefined) {
  const enabled = await isEnabled($)
  const previous = (await $.state.get(SUMMARY)).value
  const summary: ThriftSummary = {
    ...totals,
    enabled,
    mainSavedUsd: totals.mainBaselineUsd - totals.mainActualUsd,
    agentSavedUsd: totals.agentBaselineUsd - totals.agentActualUsd,
    lastRoute: lastRoute === undefined ? (previous?.lastRoute ?? null) : lastRoute,
  }
  if (JSON.stringify(previous) !== JSON.stringify(summary)) await $.state.set(SUMMARY, summary)
  if ((await $.state.get(ENABLED)).value !== enabled) await $.state.set(ENABLED, enabled)
}

/** Appends one request to the ledger and the totals; `isFirst` when no earlier request of its turn or agent was rerouted. */
async function record($: EngineInterface, row: ThriftLedgerRow, isAgent: boolean, isFirst: boolean) {
  const totals = await getTotals($)
  totals.requests += 1
  if (isRouted(row)) {
    totals.routedRequests += 1
    if (isFirst) totals[isAgent ? 'routedAgents' : 'routedTurns'] += 1
  }
  if (isAgent) {
    totals.agentActualUsd += row.actualUsd
    totals.agentBaselineUsd += row.baselineUsd
  } else {
    totals.mainActualUsd += row.actualUsd
    totals.mainBaselineUsd += row.baselineUsd
  }
  await $.store.set('ledger', [...(await getLedger($)), row].slice(-LEDGER_KEEP))
  await $.store.set('totals', totals)
  await publish($, totals, undefined)
}

/** Stops rerouting for the rest of the session and says so, once. */
async function halt($: EngineInterface, model: string, cause: string, outcome: string) {
  const at = new Date(await $.clock.now()).toISOString()
  if ((await getHalt($)) !== null) return
  await $.state.set(HALTED, { at, model, cause })
  $.ui.log(`thrift: ${model} ${cause}; ${outcome}. Rerouting is off for the rest of this session (/thrift on turns it back on).`)
}

/** What became of a rerouted request that `routed` did not answer; `answeredBy` when another model answered it whole. */
type Failure = { cause: string; answeredBy?: string }

/** Null when `routed` answered the request: another model did not, a response arrived, and it is not a refusal or an overflow. */
function failureOf(result: TurnStepResult, routed: string): Failure | null {
  const answeredBy = result.usage?.model
  if (answeredBy !== undefined && !isSameModel(answeredBy, routed)) return { cause: `was answered by ${answeredBy} instead`, answeredBy }
  if (result.stopReason === null) return { cause: 'did not answer' }
  if (result.stopReason === 'refusal') return { cause: 'refused the request' }
  if (result.stopReason === 'model_context_window_exceeded') return { cause: 'could not hold the conversation' }
  return null
}

const brief = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, 160)

const line = (row: ThriftLedgerRow) =>
  [
    row.at.slice(11, 19),
    (row.agentId === undefined ? 'main' : 'agent').padEnd(5),
    `${row.asked} → ${row.used}`.padEnd(44),
    count(row.input).padStart(6),
    count(row.output).padStart(6),
    count(row.cacheRead).padStart(7),
    count(row.cacheWrite).padStart(7),
    usd(row.baselineUsd - row.actualUsd).padStart(9),
  ].join(' ')

const haltLine = (halted: ThriftHalt) =>
  `Rerouting stopped for this session at ${halted.at.slice(11, 19)}: ${halted.model} ${halted.cause}. /thrift on turns it back on.`

function report(totals: ThriftTotals, ledger: ThriftLedgerRow[], enabled: boolean, halted: ThriftHalt | null): string {
  const mainSaved = totals.mainBaselineUsd - totals.mainActualUsd
  const agentSaved = totals.agentBaselineUsd - totals.agentActualUsd
  const routed = ledger.filter(isRouted).slice(-REPORT_ROWS)
  const verdict = (saved: number, baseline: number) =>
    baseline === 0 ? 'nothing recorded yet' : saved >= 0 ? `saved ${usd(saved)}` : `LOST ${usd(-saved)}: the cache misses cost more than the cheaper model saved`
  return [
    `thrift report (${enabled ? 'on' : 'off'}; USD estimated at API list prices, cache writes at the 5-minute rate; your plan weighs models about the same way)`,
    ...(halted === null ? [] : [haltLine(halted)]),
    `Main conversation: ${totals.routedTurns} turn${totals.routedTurns === 1 ? '' : 's'} rerouted. Actual ${usd(totals.mainActualUsd)} vs ${usd(totals.mainBaselineUsd)} on your model with a warm cache: ${verdict(mainSaved, totals.mainBaselineUsd)}.`,
    ...(mainSaved < 0 ? ['Main-conversation routing is losing. Raise the context ceiling only if you accept that, or run /thrift off and keep the subagent savings alone.'] : []),
    `Subagents: ${totals.routedAgents} rerouted to haiku. Actual ${usd(totals.agentActualUsd)} vs ${usd(totals.agentBaselineUsd)} on the parent model: ${verdict(agentSaved, totals.agentBaselineUsd)}.`,
    `Requests recorded: ${totals.requests}, rerouted: ${totals.routedRequests}.`,
    '',
    routed.length === 0
      ? 'No rerouted requests in the ledger.'
      : [
          `Last ${routed.length} rerouted requests:`,
          `${'time'.padEnd(8)} ${'who'.padEnd(5)} ${'asked → used'.padEnd(44)} ${'input'.padStart(6)} ${'output'.padStart(6)} ${'c-read'.padStart(7)} ${'c-write'.padStart(7)} ${'saved'.padStart(9)}`,
          ...routed.map(line),
        ].join('\n'),
  ].join('\n')
}

/** `this turn ran on <model>`, or how many of its requests did when a reroute failed partway. */
const ranOn = (decision: ThriftDecision) =>
  decision.routed === decision.requests
    ? `ran on ${decision.used}`
    : `had ${decision.routed} of its ${decision.requests} requests run on ${decision.used}`

export const register: Register = (on, options) => {
  const maxContextTokens = Number(options.maxContextTokens ?? 30_000)
  const haikuAgents = new Set(String(options.haikuAgents ?? 'Explore, claude-code-guide').split(',').map(s => s.trim()).filter(Boolean))
  const stepModel: Record<0 | 1, string> = {
    0: String(options.haikuModel ?? '').trim() || STEP_MODEL[0],
    1: String(options.sonnetModel ?? '').trim() || STEP_MODEL[1],
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'thrift',
      description: 'Send cheap work to cheaper models: on, off, status, or a savings report',
      argumentHint: 'on|off|status|report',
    })
    await publish($, await getTotals($), undefined)
    return next(e)
  })

  // Subagents first: a read-only type runs on haiku unless the call named a model itself.
  on('agent.spawn', async ($, e, next) => {
    const isCandidate =
      !e.fork && e.isTeammate !== true && e.workflow === undefined && e.model === undefined &&
      haikuAgents.has(e.subagentType) && tierOf(e.parentModel) > 0 && (await isEnabled($)) && (await getHalt($)) === null
    if (!isCandidate) return next(e)
    const started = await next({ ...e, model: SPAWN_MODEL })
    if (started.agentId !== undefined) {
      const agents = (await $.state.get(AGENTS)).value ?? {}
      const entry: ThriftAgent = { asked: e.parentModel, used: null, type: e.subagentType }
      const kept = Object.entries({ ...agents, [started.agentId]: entry }).slice(-50)
      await $.state.set(AGENTS, Object.fromEntries(kept))
    }
    return started
  })

  // `!!` keeps the chosen model for the turn the prompt starts.
  on('prompt.submit', async ($, e, next) => {
    if (!e.text.startsWith('!!')) return next(e)
    await $.state.set(PENDING, { ...(await getPending($)), force: true })
    return next({ ...e, text: e.text.slice(2).trimStart() })
  })

  // The permission mode rides the classic UserPromptSubmit event, which runs before turn.start.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await $.state.set(PENDING, { ...(await getPending($)), mode: e.permission_mode ?? null })
    return next(e)
  })

  // Decide once per main-conversation turn; turn.step holds the model for every request of it.
  on('turn.start', async ($, e, next) => {
    try {
      const pending = await getPending($)
      if (pending.force) await $.state.set(PENDING, { ...pending, force: false })
      let verdict = classify(e.text)
      if (!(await isEnabled($))) verdict = { tier: 2, reason: 'thrift is off' }
      else if ((await getHalt($)) !== null) verdict = { tier: 2, reason: 'rerouting stopped for this session' }
      else if (pending.force) verdict = { tier: 2, reason: 'forced with !!' }
      else if (pending.mode === 'plan') verdict = { tier: 2, reason: 'plan mode' }
      else if (verdict.tier < 2) {
        const tokens = (await $.session.usage()).context.tokens ?? 0
        if (tokens > maxContextTokens) verdict = { tier: 2, reason: `context ${count(tokens)} tokens, over ${count(maxContextTokens)}` }
      }
      const decision: ThriftDecision = { turnId: e.turnId, tier: verdict.tier, reason: verdict.reason, asked: null, model: null, used: null, requests: 0, routed: 0 }
      await $.state.set(DECISION, decision)
    } catch {
      // fail open: the turn runs on the chosen model
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const { agentId } = e
    let asked = e.model
    let routed: string | null = null
    let request = e
    let reason = ''
    let decision: ThriftDecision | null = null
    let isTracked = agentId === undefined
    try {
      const isHalted = (await getHalt($)) !== null
      if (agentId === undefined) {
        const current = (await $.state.get(DECISION)).value
        if (current !== null && current !== undefined && current.turnId === e.turnId) {
          // a decision 0.1.0 wrote before a reload has no counters
          decision = { ...current, used: current.used ?? null, requests: current.requests ?? 0, routed: current.routed ?? 0 }
          if (e.index === 0 && !isHalted && decision.tier < 2 && decision.tier < tierOf(e.model)) {
            decision.asked = e.model
            decision.model = stepModel[decision.tier === 0 ? 0 : 1]
            await $.state.set(DECISION, decision)
          } else if (isHalted && decision.model !== null) {
            decision.model = null
            await $.state.set(DECISION, decision)
          }
          if (decision.model !== null) {
            routed = decision.model
            reason = decision.reason
          }
        }
      } else {
        const agent = ((await $.state.get(AGENTS)).value ?? {})[agentId]
        if (agent !== undefined) {
          isTracked = true
          asked = agent.asked
          reason = `read-only subagent ${agent.type}`
          if (!isSameModel(e.model, asked)) {
            if (isHalted) request = { ...e, model: asked }
            else routed = e.model
          }
        }
      }
    } catch {
      routed = null
      request = e
      decision = null
    }

    /** Ledgers one answered request and counts it for its turn or its agent. */
    const settle = async (result: TurnStepResult, why: string, isDiscarded = false) => {
      if (!isTracked || result.usage === null) return
      try {
        const usage: ModelUsage = result.usage
        const used = result.usage.model
        const isMain = agentId === undefined
        const previous = isMain ? (await $.state.get(LAST_MAIN)).value : undefined
        const isSwitch = isMain && previous !== null && previous !== undefined && previous !== used
        if (isMain) await $.state.set(LAST_MAIN, used)
        const row: ThriftLedgerRow = {
          at: new Date(await $.clock.now()).toISOString(),
          turnId: e.turnId,
          ...(agentId === undefined ? {} : { agentId }),
          asked,
          used,
          input: usage.input_tokens,
          output: usage.output_tokens,
          cacheRead: usage.cache_read_input_tokens,
          cacheWrite: usage.cache_creation_input_tokens,
          actualUsd: costOf(used, usage),
          baselineUsd: isDiscarded ? 0 : baselineOf(asked, usage, isSwitch),
          reason: why,
          ...(isDiscarded ? { discarded: true as const } : {}),
        }
        let isFirst = false
        if (decision !== null) {
          if (!isDiscarded) decision.requests += 1
          if (isRouted(row)) {
            isFirst = decision.routed === 0
            decision.routed += 1
            decision.used = used
          }
          await $.state.set(DECISION, decision)
        } else if (agentId !== undefined && isRouted(row)) {
          const agents = (await $.state.get(AGENTS)).value ?? {}
          const agent = agents[agentId]
          if (agent !== undefined && agent.used === null) {
            isFirst = true
            await $.state.set(AGENTS, { ...agents, [agentId]: { ...agent, used } })
          }
        }
        await record($, row, !isMain, isFirst)
      } catch {
        // fail open: the ledger misses a row
      }
    }

    // On the model asked for: the response streams through as it arrives. (`request` differs from `e`
    // for a subagent started on haiku in a session that has since halted: it goes back to `asked`.)
    if (routed === null) {
      const result = yield* next(request)
      await settle(result, reason)
      return result
    }

    // Rerouted: nothing of the response goes up until it is whole and `routed` is the model that
    // answered, so a failed attempt leaves nothing behind and the request can run again.
    const held: TurnStepChunk[] = []
    let attempt: TurnStepResult | null = null
    let failure: Failure | null = null
    try {
      const stream = next({ ...e, model: routed })
      for await (const chunk of stream) held.push(chunk)
      attempt = await stream.result
      if (!next.signal.aborted) failure = failureOf(attempt, routed)
    } catch (error) {
      if (next.signal.aborted) throw error
      failure = { cause: `failed (${brief(error)})` }
    }
    if (failure === null && attempt !== null) {
      for (const chunk of held) yield chunk
      await settle(attempt, reason)
      return attempt
    }

    // The model asked for answered after all (the engine keeps it when a policy bars `routed`): that is the answer.
    const isKept = failure?.answeredBy !== undefined && isSameModel(failure.answeredBy, asked)
    const cause = failure?.cause ?? 'did not answer'
    try {
      if (decision !== null) {
        decision.model = null
        decision.reason = `${decision.reason}, but ${routed} ${cause}`
        await $.state.set(DECISION, decision)
      }
      await halt($, routed, cause, isKept ? 'that answer stands' : `the request runs again on ${asked}`)
    } catch {
      // fail open: the request still runs again below
    }
    if (isKept && attempt !== null) {
      for (const chunk of held) yield chunk
      await settle(attempt, `${reason}; ${routed} ${cause}`)
      return attempt
    }
    if (attempt !== null) await settle(attempt, `${reason}; discarded, ${routed} ${cause}`, true)
    const result = yield* next({ ...e, model: asked })
    await settle(result, `${reason}; ran again after ${routed} ${cause}`)
    return result
  })

  // One dim line under the answer when requests of the turn ran on a cheaper model.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    try {
      const decision = (await $.state.get(DECISION)).value
      if (decision === null || decision === undefined || decision.turnId !== e.turnId || !decision.routed) return result
      const note = `thrift: this turn ${ranOn(decision)} (${decision.reason}); start a prompt with !! to keep ${decision.asked ?? 'your model'}`
      await publish($, await getTotals($), note)
      return { ...result, text: note }
    } catch {
      return result
    }
  })

  on('command.run', { command: 'thrift' }, async ($, e) => {
    try {
      const sub = e.args.trim().toLowerCase()
      if (sub === 'on' || sub === 'off') {
        await $.store.set('enabled', sub === 'on')
        if (sub === 'on' && (await getHalt($)) !== null) await $.state.set(HALTED, null)
        await publish($, await getTotals($), undefined)
        return { text: `thrift: ${sub}. ${sub === 'on' ? 'Read-only subagents go to haiku; trivial and routine turns to haiku or sonnet.' : 'Every request runs on your chosen model.'}` }
      }
      const totals = await getTotals($)
      const enabled = await isEnabled($)
      const halted = await getHalt($)
      if (sub === 'report') return { text: report(totals, await getLedger($), enabled, halted) }
      if (sub === '' || sub === 'status') {
        const decision = (await $.state.get(DECISION)).value
        const now = decision === null || decision === undefined
          ? 'no turn decided yet'
          : decision.routed
            ? `last turn ${ranOn(decision)} (${decision.reason})`
            : `last turn kept its model (${decision.reason})`
        return {
          text: [
            `thrift: ${enabled ? 'on' : 'off'}. Context ceiling ${count(maxContextTokens)} tokens; haiku agents: ${[...haikuAgents].join(', ') || 'none'}. Trivial turns go to ${stepModel[0]}, routine ones to ${stepModel[1]}.`,
            ...(halted === null ? [] : [haltLine(halted)]),
            `${now}. ${totals.routedTurns} turns and ${totals.routedAgents} subagents rerouted; main conversation ${usd(totals.mainBaselineUsd - totals.mainActualUsd)}, subagents ${usd(totals.agentBaselineUsd - totals.agentActualUsd)} saved (negative is a loss). /thrift report has the ledger.`,
          ].join('\n'),
        }
      }
      return { text: 'thrift: usage: /thrift on | off | status | report' }
    } catch (error) {
      return { text: `thrift: /thrift failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  })
}
