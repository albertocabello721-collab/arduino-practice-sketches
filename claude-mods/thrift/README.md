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

**Which model values.** The two events take different things. `agent.spawn` takes the
Agent tool's own alias, `haiku`, and the engine resolves it for your account. `turn.step`
sends its `model` to the API exactly as written, with no alias resolved, so thrift names
full ids there: `claude-haiku-5-5` and `claude-sonnet-5-5`, what `haiku` and `sonnet`
resolve to today (options `haikuModel`, `sonnetModel`). A bare `haiku` on `turn.step` is a
404 from the API.

A prompt starting with `!!` always uses your chosen model; the `!!` is stripped before the
model reads it. (Note: in the terminal composer a leading `!` may switch the input to bash
mode before the prompt is submitted. If `!!` does not reach thrift on your setup, say so and
the prefix can change.)

**The dim line.** When requests of a turn ran on a cheaper model, one line under the answer
names the model that answered them, as the API reported it, says why, and how to keep your
model next time. A turn whose reroute failed partway says how many of its requests did.

**The ledger.** Every main-conversation request and every request of a rerouted subagent
is one row: model asked for, model that answered, input, output, cache-read and cache-write
tokens, and two estimates at API list prices: what it cost, and what it would have cost on
the model asked for with a cache that never switched. On the first request after a switch
(in either direction) the tokens written to the new model's cache are priced as cache reads
in that baseline, because a never-switched chain would have read them. So the switch into
the cheaper model and the switch back are both counted against thrift. A turn or a subagent
counts as rerouted only once a cheaper model has answered a request of it, so the report's
turns and requests always agree.

## When a reroute fails

Thrift never sets the session's model. A reroute is the `model` of one request, and a
rerouted request fails open:

- Its response is held until it is whole, so a rerouted reply appears at once instead of
  streaming. Requests on your own model stream as before.
- If the request errors, ends without an answer (no response, a refusal, a conversation the
  model cannot hold) or was answered by a model other than the one thrift named, the
  response is dropped and the request runs again, once, on the model asked for. Nothing of
  the dropped response is shown. An answer the engine gave on your own model (it keeps it
  when a model policy bars the cheaper one) is kept as it is, with no second request.
- The error stays inside thrift, so Claude Code's own fallback, which moves the session to
  another model, never sees a failure of a model you did not choose.
- From then on the session reroutes nothing: no turn, no new subagent, and a subagent
  already running on haiku goes back to the model its spawn asked for. One line in the
  transcript says what happened; `/thrift status` repeats it. `/thrift on` turns rerouting
  back on.
- A dropped response that was billed is in the ledger as `discarded`, under the model that
  sent it and against a baseline of zero, so a failed reroute shows as the loss it was.

An interrupted request (Esc) is not retried.

## Commands

| Command | What it does |
| --- | --- |
| `/thrift on` / `/thrift off` | Turns routing on or off (kept across sessions). A running turn keeps its model either way. `on` also turns rerouting back on in a session where a failed reroute stopped it. |
| `/thrift status` (or `/thrift`) | Standing, options, the last turn's decision, savings so far, and why rerouting stopped if it did. |
| `/thrift report` | Totals for the main conversation and for subagents, saved or lost, and the last 20 rerouted requests. If main-conversation routing lost, the report says so in plain words. |

Prices are list prices as of 2026-10 (Fable 5.1 $10/$50, Opus 5.5 $4/$20, Opus 5 and
4.x $5/$25, Sonnet 5.x $2/$10, Sonnet 4.6 $3/$15, Haiku 5.5 $0.10/$0.50 for prompts up to
100K tokens and $0.50/$2.50 beyond, Haiku 4.5 $1/$5 per million input/output tokens; cache
reads at each model's rate; cache writes at the 5-minute rate, 1.25x input).
Plan usage weighs models the same way, so the sign of the verdict is what matters, not the
cents. A model switch you made yourself with `/model` is also read as a switch.

## Options (`userConfig`)

| Option | Default | Meaning |
| --- | --- | --- |
| `maxContextTokens` | `30000` | Turns whose context holds more tokens than this stay on your model. |
| `haikuAgents` | `Explore, claude-code-guide` | Comma-separated subagent types that run on haiku. |
| `haikuModel` | `claude-haiku-5-5` | Full model id a trivial turn is sent to. Not an alias. |
| `sonnetModel` | `claude-sonnet-5-5` | Full model id a routine turn is sent to. Not an alias. |

## Events hooked

| Event | Why |
| --- | --- |
| `session.start` | Registers `/thrift`; mirrors the totals into `$.state`. |
| `agent.spawn` | Rewrites `model` to `haiku` for read-only subagent types; records the agent so its requests are ledgered against the parent model. |
| `prompt.submit` | Strips a leading `!!` and marks the next turn as forced onto your model. |
| `classic.UserPromptSubmit` | Reads `permission_mode` so a plan-mode turn is never rerouted. |
| `turn.start` | Decides the turn's tier (heuristics, force, plan mode, context size, a stopped session). |
| `turn.step` | Applies the decision to every request of the turn (never switching mid-turn), holds a rerouted response until it is whole, runs a failed one again on the model asked for, and writes the ledger row from the response's usage. |
| `turn.complete` | Adds the dim line under a turn that had requests answered by a cheaper model. |
| `command.run` `{ command: 'thrift' }` | Answers `/thrift`. |

No `tool.check` hook, nothing auto-approved, no `$.http`, `$.env`, `$.settings` or
`$.config`, and no model call of any kind: classification is regex over the prompt text and
a `$.session.usage()` read for the context size.

## API calls made

`$.command.register`, `$.session.usage`, `$.clock.now`, `$.store.get`, `$.store.set`,
`$.state.get`, `$.state.set`, `$.ui.log` (the one line when rerouting stops).

## Data other mods can read

`$.store` is scoped to thrift (one JSON file, shared by every session running thrift):
`enabled`, `ledger` (the newest 400 `ThriftLedgerRow`), `totals` (`ThriftTotals`, all time).
Other mods read the mirror in `$.state`; the contract is `types/index.d.ts`:

| `$.state` key | Type | Meaning |
| --- | --- | --- |
| `thrift.summary` | `ThriftSummary` | `enabled`, the totals, `mainSavedUsd`, `agentSavedUsd` (negative is a loss), `lastRoute`. This is what a dashboard reads. |
| `thrift.enabled` | `boolean` | On or off. |
| `thrift.decision` | `ThriftDecision \| null` | The current or last turn's decision: tier, reason, the model asked for, the id its requests are sent to (`model`), the model that answered (`used`), and how many requests it answered (`routed` of `requests`). |
| `thrift.halted` | `ThriftHalt \| null` | Set when a reroute failed this session: when, which model, what became of the request. Nothing is rerouted while it is set. |
| `thrift.agents` | `Record<agentId, ThriftAgent>` | Subagents sent to haiku this session, each with the model that answered it once one has. |
| `thrift.pending` | `ThriftPending` | A `!!` seen, the permission mode (internal). |
| `thrift.lastMainModel` | `string \| null` | Model of the last main-conversation request, for switch detection (internal). |

## Failure behaviour

Every hook fails open: a hook that throws or outruns its budget is skipped, so the spawn,
the prompt, the request and the turn go on exactly as without thrift. The one visible
effect of such a failure is a missing ledger row or a `!!` that did not take. A rerouted
request that fails is covered above: it runs again on your model and rerouting stops.

## Tests

`claude plugin test <this folder>` runs `tests/thrift.test.ts`: trivial to haiku by its
full id with the dim line, the line and the ledger naming the model that answered, routine
to sonnet, judgment kept, no mid-turn switch, `!!`, plan mode, the context ceiling (default
and option), the model options, never upgrading, `/thrift on|off`, subagent routing with an
explicit model respected, the ledger's switch accounting, a losing report that says so, and
a winning one. The failed-reroute path: a rerouted request that errors, sends no response,
refuses or is answered by another model runs again once on the chosen model with nothing of
the dropped response shown, the session stops rerouting with one notice and `/thrift on`
turns it back on, an answer the engine gave on the chosen model stands, a turn whose
reroute fails partway reports what did run on the cheaper model, a rerouted subagent goes
on with the model its spawn asked for, and totals stored by 0.1.0 are put right.
