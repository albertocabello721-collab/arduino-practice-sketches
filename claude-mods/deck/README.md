# deck

A dashboard pane for Claude Code with four tabs, drawn from data gathered on a timer and
after each turn, never while drawing. Works in the terminal and in the Desktop app's Code
tab; when a pane cannot be placed it falls back to a compact band above the prompt, and
where nothing draws at all `/deck` answers with the dashboard as text.

## Commands

| Command | What it does |
| --- | --- |
| `/deck` | Gathers fresh data and opens the pane (tabs: 1 Agents, 2 Usage, 3 Brain, 4 Handoffs; the digits work while the pane has focus, ctrl+x tab). If the surface cannot place a pane, turns on the band instead and says so. With no surface attached, prints the dashboard as text. |
| `/deck close` | Closes the pane and hides the band. |

## Tabs

**Agents.** This session's subagents from `$.agent.list()` (status, type or name,
description), then the other sessions that hold a relay role (from relay's `$.state`
roster, when relay is installed), each with its role, project name, when it took the role,
and its last handoff with that handoff's status. There is no API that lists other sessions
or says whether they are busy, so a session appears only through relay's roster, and the
"state" shown is the handoff's, not the session's.

**Usage.** Context fill (percent of the window, tokens), each rate-limit window the API
reported (`five_hour`, `seven_day`, a gateway's spend limit) with the time until it resets,
the session's cost, and thrift's standing and savings (from `thrift.summary` in `$.state`,
when thrift is installed; a negative main-conversation figure is marked "losing").

**Brain.** Read-only view of the Obsidian vault at `vaultPath`: notes changed in the last
7 days (newest first, with the count), how many notes `Inbox/` holds (`Inbox/Tasks.md` not
counted), and the open `- [ ]` items of `Inbox/Tasks.md`. Nothing is read unless the folder
holds a `.obsidian` directory; otherwise the tab says so. Hidden folders and `_relay/` are
skipped.

**Handoffs.** Relay's pending handoffs for this session's role, then the recent ones with
their status (from relay's `$.state`).

## How data is gathered

`refresh` runs 1 s after the session starts, every 60 s, after every main-conversation
turn (`turn.complete`, through a zero-delay timer so the turn's end is not held up) and on
`/deck`. It writes one `deck.snapshot` to `$.state`; the pane and the band read it, plus
relay's and thrift's own `$.state` keys, and nothing else. Reading state while drawing
subscribes the drawing, so a new snapshot or a relay/thrift write redraws it. The Brain scan
is one `find` over the vault (`$.process.run`), a `$.fs.stat` per changed note (up to 100),
one `$.fs.list` of `Inbox/` and one `$.fs.read` of `Inbox/Tasks.md`.

## Options (`userConfig`)

| Option | Default | Meaning |
| --- | --- | --- |
| `vaultPath` | `/Users/albertoc/Documents/GitHub/second-brain` | Absolute path of the Obsidian vault the Brain tab reads. |

## Events hooked

| Event | Why |
| --- | --- |
| `session.start` | Registers `/deck`; starts the refresh timer. |
| `turn.complete` | Schedules a refresh after each main-conversation turn. |
| `command.run` `{ command: 'deck' }` | Answers `/deck` and `/deck close`. |
| `ui.render` `{ component: 'Pane', requestId: 'deck' }` | Draws the pane: tab buttons, "updated" line, the tab's rows, each truncated to `bodyColumns`. |
| `ui.render` `{ component: 'AbovePrompt' }` | Draws the one-line band while it stands in for an unplaced pane; passes otherwise. |

## API calls made

`$.command.register`, `$.clock.after`, `$.clock.every`, `$.clock.now`, `$.agent.list`,
`$.session.id`, `$.session.surfaces`, `$.session.usage`, `$.fs.exists`, `$.fs.list`,
`$.fs.read`, `$.fs.stat`, `$.process.run` (`find` only), `$.ui.open`, `$.ui.close`,
`$.ui.panes`, `$.ui.resolve`, `$.state.get`, `$.state.set`.

No `tool.check`, nothing auto-approved, no `$.http`, `$.env`, `$.settings`, no model call,
no `$.store` (deck keeps nothing across sessions).

## Data read from other mods

Deck reads these `$.state` keys when their owners are installed and shows "not installed"
otherwise; the shapes are repeated in `types/peers.d.ts` so deck loads and type-checks alone:

| Key | Owner | Used in |
| --- | --- | --- |
| `relay.role`, `relay.pending`, `relay.recent`, `relay.roster` | relay | Agents, Handoffs, band |
| `thrift.summary` | thrift | Usage, band |

Deck's own `$.state`: `deck.tab`, `deck.snapshot`, `deck.band` (`types/index.d.ts`).

## Failure behaviour

Every hook fails open. Each part of a refresh fails on its own (a vault that cannot be
read leaves the Agents and Usage tabs intact and the Brain tab says why); a failed refresh
keeps the last snapshot; a render hook that fails leaves the engine's own drawing.

## Tests

`claude plugin test <this folder>` runs `tests/deck.test.ts`, with inline relay and thrift
stand-ins publishing the state keys deck reads: the pane's four tabs on terminal and
desktop, the "not installed" wording without them, the vault check, the band fallback and
`/deck close`, the text fallback with no surface, and refresh after a turn and on the timer.
