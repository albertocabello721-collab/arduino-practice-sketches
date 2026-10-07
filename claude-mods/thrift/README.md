# thrift

Sends cheap work to cheaper models so your plan goes further, and keeps a ledger that
shows whether it paid off once prompt-cache misses are counted. Prompt caching is per
model, so a careless switch rewrites the whole context into the new model's cache; thrift
is built around that: subagents first, one decision per turn, never a switch mid-turn, and
an honest report.

## What it does

**Subagents first (`agent.spawn`).** A spawn of a read-only type (option `haikuAgents`,
default `Explore, claude-code-guide`) runs on haiku, unless the call named a model itself,
the parent already runs on haiku, it is a fork, a teammate or a workflow agent, or thrift
is off. A subagent starts with an empty cache on any model, so this saving has no cache
penalty. The built-in `Plan` agent is read-only too but is left on your model by default:
planning is judgment. Add it to the option if you want it cheaper.

**Main conversation (`turn.start`, `turn.step`).** At the start of each turn thrift
classifies the prompt with free heuristics (no model call) and picks the lowest tier it
warrants: trivial work (questions about the repo, renames, formatting, git housekeeping,
running a command) goes to haiku, routine edits go to sonnet, everything else stays on
your chosen model. Anything that asks for judgment (why, debug, design, review, plan,
across, every, should, best...), anything long or multi-part, anything in plan mode, and
any turn whose context already exceeds `maxContextTokens` (default 30k) keeps your model.
The decision is held for every request of the turn. Thrift only ever moves down a tier:
a session already on sonnet is never sent to opus.

A prompt starting with `!!` always uses your chosen model; the `!!` is stripped before the
model reads it. (Note: in the terminal composer a leading `!` may switch the input to bash
mode before the prompt is submitted. If `!!` does not reach thrift on your setup, say so and
the prefix can change.)

**The dim line.** When a turn ran on a cheaper model, one line under the answer says which
model and why, and how to keep your model next time.

**The ledger.** Every main-conversation request and every request of a rerouted subagent
is one row: model asked for, model used, input, output, cache-read and cache-write tokens,
and two estimates at API list prices: what it cost, and what it would have cost on the
model asked for with a cache that never switched. On the first request after a switch (in
either direction) the tokens written to the new model's cache are priced as cache reads in
that baseline, because a never-switched chain would have read them. So the switch into the
cheaper model and the switch back are both counted against thrift.

## Commands

| Command | What it does |
| --- | --- |
| `/thrift on` / `/thrift off` | Turns routing on or off (kept across sessions). A running turn keeps its model either way. |
| `/thrift status` (or `/thrift`) | Standing, options, the last turn's decision, savings so far. |
| `/thrift report` | Totals for the main conversation and for subagents, saved or lost, and the last 20 rerouted requests. If main-conversation routing lost, the report says so in plain words. |

Prices are list prices as of 2026-09 (Fable 5.1 $10/$50, Opus 5.5 $4/$20, Opus 5 and
4.x $5/$25, Sonnet 5.x $2/$10, Sonnet 4.6 $3/$15, Haiku 4.5 $1/$5 per million input/output
tokens; cache reads at each model's rate; cache writes at the 5-minute rate, 1.25x input).
Plan usage weighs models the same way, so the sign of the verdict is what matters, not the
cents. A model switch you made yourself with `/model` is also read as a switch.

## Options (`userConfig`)

| Option | Default | Meaning |
| --- | --- | --- |
| `maxContextTokens` | `30000` | Turns whose context holds more tokens than this stay on your model. |
| `haikuAgents` | `Explore, claude-code-guide` | Comma-separated subagent types that run on haiku. |

## Events hooked

| Event | Why |
| --- | --- |
| `session.start` | Registers `/thrift`; mirrors the totals into `$.state`. |
| `agent.spawn` | Rewrites `model` to `haiku` for read-only subagent types; records the agent so its requests are ledgered against the parent model. |
| `prompt.submit` | Strips a leading `!!` and marks the next turn as forced onto your model. |
| `classic.UserPromptSubmit` | Reads `permission_mode` so a plan-mode turn is never rerouted. |
| `turn.start` | Decides the turn's tier (heuristics, force, plan mode, context size). |
| `turn.step` | Applies the decision to every request of the turn (never switching mid-turn) and writes the ledger row from the response's usage. |
| `turn.complete` | Adds the dim line under a rerouted turn's answer and counts the turn. |
| `command.run` `{ command: 'thrift' }` | Answers `/thrift`. |

No `tool.check` hook, nothing auto-approved, no `$.http`, `$.env` or `$.settings`, and no
model call of any kind: classification is regex over the prompt text and a `$.session.usage()`
read for the context size.

## API calls made

`$.command.register`, `$.session.usage`, `$.clock.now`, `$.store.get`, `$.store.set`,
`$.state.get`, `$.state.set`.

## Data other mods can read

`$.store` is scoped to thrift (one JSON file, shared by every session running thrift):
`enabled`, `ledger` (the newest 400 `ThriftLedgerRow`), `totals` (`ThriftTotals`, all time).
Other mods read the mirror in `$.state`; the contract is `types/index.d.ts`:

| `$.state` key | Type | Meaning |
| --- | --- | --- |
| `thrift.summary` | `ThriftSummary` | `enabled`, the totals, `mainSavedUsd`, `agentSavedUsd` (negative is a loss), `lastRoute`. This is what a dashboard reads. |
| `thrift.enabled` | `boolean` | On or off. |
| `thrift.decision` | `ThriftDecision \| null` | The current or last turn's decision: tier, reason, model asked and used. |
| `thrift.agents` | `Record<agentId, ThriftAgent>` | Subagents sent to haiku this session. |
| `thrift.pending` | `ThriftPending` | A `!!` seen, the permission mode (internal). |
| `thrift.lastMainModel` | `string \| null` | Model of the last main-conversation request, for switch detection (internal). |

## Failure behaviour

Every hook fails open: a hook that throws or outruns its budget is skipped, so the spawn,
the prompt, the request and the turn go on exactly as without thrift. The one visible
effect of a failure is a missing ledger row or a `!!` that did not take.

## Tests

`claude plugin test <this folder>` runs `tests/thrift.test.ts`: trivial to haiku with the
dim line, routine to sonnet, judgment kept, no mid-turn switch, `!!`, plan mode, the
context ceiling (default and option), never upgrading, `/thrift on|off`, subagent routing
with an explicit model respected, the ledger's switch accounting, a losing report that says
so, and a winning one.
