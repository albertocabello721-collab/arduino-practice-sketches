# relay

Planner / builder / reviewer handoffs between Claude Code sessions, on top of the
engine's own cross-session messaging, plus an inbox/outbox bridge in your Obsidian
vault so Claude chat and Cowork (which cannot run mods) can take part.

## Commands

| Command | What it does |
| --- | --- |
| `/role` | Shows this session's role and the other sessions holding one. |
| `/role planner\|builder\|reviewer` | Tags this session with the role. One session per role: taking a role removes it from the session that had it. |
| `/handoff` | Lists the handoffs pending for this session's role. |
| `/handoff <role> [note]` | Writes a handoff file to `<vault>/_relay/handoffs/` and sends the session holding `<role>` a short message with the path. If nobody holds the role, the file is written and shows as pending to whoever takes the role later. |
| `/handoff out <note>` | Writes the same kind of file to `<vault>/_relay/outbox/` (with `to: chat`) for Claude chat or Cowork to read. Nothing is sent. |
| `/handoff accept` | Marks the pending handoffs for your role accepted, clears the band, and puts each file's content into the model's context for your next prompt. |

A handoff file has frontmatter (`type`, `id`, `from`, `to`, `at`, `note`) and the sections
Goal, Plan, Done when, Open questions (written by `$.model.fork`, one tool-less request over
this session's own cached transcript) and Files touched (the files this session edited,
read from the transcript's tool calls, no model involved).

## What happens when a handoff arrives

The sender's message is a peer message whose origin names relay. Relay's
`session.receive` hook logs it, shows a toast, and holds it: the message is consumed, so
the model never reads it and cannot answer it. The handoff stays listed in the band above
the prompt until you run `/handoff accept`.

Relay never sends anything in reaction to a received message, so two sessions cannot loop.

## Bridge for Claude chat and Cowork

Every session running relay watches `<vault>/_relay/inbox/` every 10 seconds. A `.md` file
there with a line `to: <role>` is delivered to the session holding that role, then lands
in `<vault>/_relay/inbox/done/`. Delivery happens exactly once even when several sessions
watch: the watcher claims the file by moving it to `done/` first (`mv` is atomic; the
loser's `mv` fails and it does nothing), then delivers.

It is delivered as a message from relay, never as your own words: to another session as a
peer message (`$.session.send`), to the watching session itself as a plugin prompt
(`$.prompt.submit`, framed "The relay plugin sent a message"). If the holder is not
running any more, the file is moved back and the stale roster entry is dropped. A file
whose role nobody holds stays in the inbox and is reported once in the transcript.

To write back out, use `/handoff out <note>`, or let chat/Cowork read `_relay/outbox/`.

## Vault check

Before writing or watching anything, relay checks that `vaultPath` holds a `.obsidian`
folder. If it does not, `/handoff` refuses with a message, the inbox watcher stays idle,
and one transcript line says so. Fix the path with `/config` → relay → Obsidian vault path.

## Options (`userConfig`)

| Option | Default | Meaning |
| --- | --- | --- |
| `vaultPath` | `/Users/albertoc/Documents/GitHub/second-brain` | Absolute path of the Obsidian vault. Relay uses `<vault>/_relay/{handoffs,inbox,inbox/done,outbox}`. |

## Events hooked

| Event | Why |
| --- | --- |
| `session.start` | Registers `/role` and `/handoff`, mirrors the store into `$.state`, starts the 10 s inbox timer. |
| `session.end` | Drops this session from the roster (a `/clear` counts: the new session id has no role). |
| `command.run` `{ command: 'role' }` | Answers `/role`. |
| `command.run` `{ command: 'handoff' }` | Answers `/handoff`. |
| `session.receive` | Holds a relay handoff for `/handoff accept`; logs and toasts an inbox delivery and passes it on. Any other delivery passes through untouched. |
| `ui.render` `{ component: 'AbovePrompt' }` | Draws the pending-handoff band; passes when there is nothing pending. |

## API calls made

`$.command.register`, `$.clock.every`, `$.clock.now`, `$.session.id`, `$.session.cwd`,
`$.session.messages`, `$.session.send`, `$.prompt.submit`, `$.model.fork`, `$.fs.list`,
`$.fs.read`, `$.fs.write`, `$.fs.exists`, `$.process.run` (`mv` only, for the atomic
inbox claim; `$.fs` has no move or delete), `$.store.get`, `$.store.set`, `$.state.get`,
`$.state.set`, `$.ui.log`, `$.ui.toast`, `$.ui.resolve`.

Not used, by design: `tool.check`, `$.http`, `$.env`, `$.settings`, `$.model.complete`,
`$.model.classify`. Nothing is auto-approved.

## Data other mods can read

`$.store` is scoped to the plugin that owns it (one JSON file per plugin), so other mods
cannot read relay's store. Relay mirrors what they need into `$.state`, which any plugin in
the same session can read (`$.state.get({ plugin: 'relay', key })`). The contract is
`types/index.d.ts`:

| `$.state` key | Type | Meaning |
| --- | --- | --- |
| `relay.role` | `RelayRole \| null` | This session's role. |
| `relay.pending` | `RelayHandoff[]` | Handoffs for this session's role not yet accepted. |
| `relay.recent` | `RelayHandoff[]` | The newest 20 handoffs relay knows of, any role or status. |
| `relay.roster` | `RelayRosterEntry[]` | Every session holding a role (`sessionId`, `role`, `name`, `cwd`, `since`). |
| `relay.noticed` | `string[]` | Inbox file names already reported as undeliverable (internal). |

Relay's own `$.store` keys (shared by every session running relay, not by other mods):
`roster` (`Record<sessionId, RelayRosterEntry>`) and `handoffs` (the newest 100 `RelayHandoff`).

## Failure behaviour

Every hook fails open. A hook that throws or outruns its budget is skipped by the engine,
so a delivery queues as usual, the band draws nothing, and the model's turn is unchanged.
`/role` and `/handoff` report their own errors as the command's output.

## Tests

`claude plugin test <this folder>` runs `tests/relay.test.ts`: roles and take-over,
writing and sending a handoff, the outbox, the vault check, receiving a handoff (held,
toasted, drawn in the band on terminal and desktop, accepted with its content in
context), pass-through of other deliveries, the inbox watcher (delivery to another
session and to itself, exactly-once under a lost claim, undeliverable files, a holder
that is gone), and `session.end`.
