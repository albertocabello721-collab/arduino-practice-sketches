import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { ThriftAgent, ThriftDecision, ThriftLedgerRow, ThriftPending, ThriftSummary, ThriftTotals } from '../types'
import { ALIAS, classify, tierOf } from './classify'
import { baselineOf, costOf, count, usd } from './prices'

// thrift: cheap work to cheaper models.
//   agent.spawn  read-only subagent types (option haikuAgents) run on haiku unless the call names a model.
//   turn.start   decides the main conversation's model for the whole turn from free heuristics,
//                plan mode, a `!!` prefix and the context size; turn.step applies it to every request.
//   turn.step    also keeps the ledger: one row per main-conversation request and per rerouted-agent request.
// Persistent: $.store  enabled, ledger (last LEDGER_KEEP rows), totals.
// Session:    $.state  enabled, pending, decision, agents, summary, lastMainModel (see types/).

const LEDGER_KEEP = 400
const REPORT_ROWS = 20

const ENABLED = { plugin: 'thrift', key: 'enabled' } as const
const PENDING = { plugin: 'thrift', key: 'pending' } as const
const DECISION = { plugin: 'thrift', key: 'decision' } as const
const AGENTS = { plugin: 'thrift', key: 'agents' } as const
const SUMMARY = { plugin: 'thrift', key: 'summary' } as const
const LAST_MAIN = { plugin: 'thrift', key: 'lastMainModel' } as const

const EMPTY_TOTALS: ThriftTotals = {
  requests: 0, routedRequests: 0, routedTurns: 0, routedAgents: 0,
  mainActualUsd: 0, mainBaselineUsd: 0, agentActualUsd: 0, agentBaselineUsd: 0,
}

async function isEnabled($: EngineInterface): Promise<boolean> {
  const raw = await $.store.get('enabled')
  return raw !== false
}

async function getTotals($: EngineInterface): Promise<ThriftTotals> {
  const raw = await $.store.get('totals')
  return raw !== null && typeof raw === 'object' ? { ...EMPTY_TOTALS, ...(raw as Partial<ThriftTotals>) } : { ...EMPTY_TOTALS }
}

async function getLedger($: EngineInterface): Promise<ThriftLedgerRow[]> {
  const raw = await $.store.get('ledger')
  return Array.isArray(raw) ? (raw as ThriftLedgerRow[]) : []
}

async function getPending($: EngineInterface): Promise<ThriftPending> {
  return (await $.state.get(PENDING)).value ?? { force: false, mode: null }
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

/** Appends one request to the ledger and the totals. */
async function record($: EngineInterface, row: ThriftLedgerRow, isAgent: boolean) {
  const totals = await getTotals($)
  totals.requests += 1
  if (row.asked !== row.used) totals.routedRequests += 1
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

function report(totals: ThriftTotals, ledger: ThriftLedgerRow[], enabled: boolean): string {
  const mainSaved = totals.mainBaselineUsd - totals.mainActualUsd
  const agentSaved = totals.agentBaselineUsd - totals.agentActualUsd
  const routed = ledger.filter(r => r.asked !== r.used).slice(-REPORT_ROWS)
  const verdict = (saved: number, baseline: number) =>
    baseline === 0 ? 'nothing recorded yet' : saved >= 0 ? `saved ${usd(saved)}` : `LOST ${usd(-saved)}: the cache misses cost more than the cheaper model saved`
  return [
    `thrift report (${enabled ? 'on' : 'off'}; USD estimated at API list prices, cache writes at the 5-minute rate; your plan weighs models about the same way)`,
    `Main conversation: ${totals.routedTurns} turn${totals.routedTurns === 1 ? '' : 's'} rerouted. Actual ${usd(totals.mainActualUsd)} vs ${usd(totals.mainBaselineUsd)} on your model with a warm cache: ${verdict(mainSaved, totals.mainBaselineUsd)}.`,
    ...(mainSaved < 0 ? ['Main-conversation routing is losing. Raise the context ceiling only if you accept that, or run /thrift off and keep the subagent savings alone.'] : []),
    `Subagents: ${totals.routedAgents} sent to haiku. Actual ${usd(totals.agentActualUsd)} vs ${usd(totals.agentBaselineUsd)} on the parent model: ${verdict(agentSaved, totals.agentBaselineUsd)}.`,
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

export const register: Register = (on, options) => {
  const maxContextTokens = Number(options.maxContextTokens ?? 30_000)
  const haikuAgents = new Set(String(options.haikuAgents ?? 'Explore, claude-code-guide').split(',').map(s => s.trim()).filter(Boolean))

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
      haikuAgents.has(e.subagentType) && tierOf(e.parentModel) > 0 && (await isEnabled($))
    if (!isCandidate) return next(e)
    const started = await next({ ...e, model: ALIAS[0] })
    if (started.agentId !== undefined) {
      const agents = (await $.state.get(AGENTS)).value ?? {}
      const entry: ThriftAgent = { asked: e.parentModel, used: started.model, type: e.subagentType }
      const kept = Object.entries({ ...agents, [started.agentId]: entry }).slice(-50)
      await $.state.set(AGENTS, Object.fromEntries(kept))
      const totals = await getTotals($)
      totals.routedAgents += 1
      await $.store.set('totals', totals)
      await publish($, totals, undefined)
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
      else if (pending.force) verdict = { tier: 2, reason: 'forced with !!' }
      else if (pending.mode === 'plan') verdict = { tier: 2, reason: 'plan mode' }
      else if (verdict.tier < 2) {
        const tokens = (await $.session.usage()).context.tokens ?? 0
        if (tokens > maxContextTokens) verdict = { tier: 2, reason: `context ${count(tokens)} tokens, over ${count(maxContextTokens)}` }
      }
      const decision: ThriftDecision = { turnId: e.turnId, tier: verdict.tier, reason: verdict.reason, asked: null, model: null }
      await $.state.set(DECISION, decision)
    } catch {
      // fail open: the turn runs on the chosen model
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    let request = e
    let asked = e.model
    let reason = ''
    let isTracked = e.agentId === undefined
    try {
      if (e.agentId === undefined) {
        const decision = (await $.state.get(DECISION)).value
        if (decision !== null && decision !== undefined && decision.turnId === e.turnId) {
          if (e.index === 0 && decision.tier < 2 && decision.tier < tierOf(e.model)) {
            decision.asked = e.model
            decision.model = decision.tier === 0 ? ALIAS[0] : ALIAS[1]
            await $.state.set(DECISION, decision)
          }
          if (decision.model !== null) {
            request = { ...e, model: decision.model }
            reason = decision.reason
          }
        }
      } else {
        const agent = ((await $.state.get(AGENTS)).value ?? {})[e.agentId]
        if (agent !== undefined) {
          isTracked = true
          asked = agent.asked
          reason = `read-only subagent ${agent.type}`
        }
      }
    } catch {
      request = e
    }

    const result = yield* next(request)

    if (isTracked && result.usage !== null) {
      try {
        const usage: ModelUsage = result.usage
        const used = result.usage.model
        const isMain = e.agentId === undefined
        const previous = isMain ? (await $.state.get(LAST_MAIN)).value : undefined
        const isSwitch = isMain && previous !== null && previous !== undefined && previous !== used
        if (isMain) await $.state.set(LAST_MAIN, used)
        const row: ThriftLedgerRow = {
          at: new Date(await $.clock.now()).toISOString(),
          turnId: e.turnId,
          ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
          asked,
          used,
          input: usage.input_tokens,
          output: usage.output_tokens,
          cacheRead: usage.cache_read_input_tokens,
          cacheWrite: usage.cache_creation_input_tokens,
          actualUsd: costOf(used, usage),
          baselineUsd: baselineOf(asked, usage, isSwitch),
          reason,
        }
        await record($, row, !isMain)
      } catch {
        // fail open: the ledger misses a row
      }
    }
    return result
  })

  // One dim line under the answer when the turn ran on a cheaper model.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    try {
      const decision = (await $.state.get(DECISION)).value
      if (decision === null || decision === undefined || decision.turnId !== e.turnId || decision.model === null) return result
      const totals = await getTotals($)
      totals.routedTurns += 1
      await $.store.set('totals', totals)
      const note = `thrift: this turn ran on ${decision.model} (${decision.reason}); start a prompt with !! to keep ${decision.asked ?? 'your model'}`
      await publish($, totals, note)
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
        await publish($, await getTotals($), undefined)
        return { text: `thrift: ${sub}. ${sub === 'on' ? 'Read-only subagents go to haiku; trivial and routine turns to haiku or sonnet.' : 'Every request runs on your chosen model.'}` }
      }
      const totals = await getTotals($)
      const enabled = await isEnabled($)
      if (sub === 'report') return { text: report(totals, await getLedger($), enabled) }
      if (sub === '' || sub === 'status') {
        const decision = (await $.state.get(DECISION)).value
        const now = decision === null || decision === undefined
          ? 'no turn decided yet'
          : decision.model === null
            ? `last turn kept its model (${decision.reason})`
            : `last turn ran on ${decision.model} (${decision.reason})`
        return {
          text: [
            `thrift: ${enabled ? 'on' : 'off'}. Context ceiling ${count(maxContextTokens)} tokens; haiku agents: ${[...haikuAgents].join(', ') || 'none'}.`,
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
