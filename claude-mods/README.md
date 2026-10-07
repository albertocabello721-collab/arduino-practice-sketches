# claude-mods

Three Claude Code mods (plugins of function hooks), each standalone, sharing data only
through documented `$.state` keys:

| Mod | What it does | README |
| --- | --- | --- |
| `relay` | `/role`, `/handoff`: planner/builder/reviewer handoffs between sessions, plus an Obsidian `_relay/` inbox/outbox bridge for Claude chat and Cowork. | [relay/README.md](relay/README.md) |
| `thrift` | Read-only subagents to haiku, trivial and routine turns to haiku or sonnet, one decision per turn, with a ledger that counts cache misses (`/thrift report`). | [thrift/README.md](thrift/README.md) |
| `deck` | `/deck`: a dashboard pane with Agents, Usage, Brain (vault) and Handoffs tabs; falls back to a band, then to text. | [deck/README.md](deck/README.md) |

This folder is a plugin marketplace (`.claude-plugin/marketplace.json`, name `albertoc-mods`)
whose entries point at the folders beside it, so an install runs the mods from this checkout:
edit a file here and `/reload-plugins` picks it up, no reinstall.

## Install (every session, user scope)

From the repository root, after pulling this branch:

```
claude plugin marketplace add ./claude-mods
claude plugin install relay@albertoc-mods
claude plugin install thrift@albertoc-mods
claude plugin install deck@albertoc-mods
```

Then start a new session (or run `/reload-plugins` in an open one). Each mod's `vaultPath`
option defaults to `/Users/albertoc/Documents/GitHub/second-brain`; change it with
`/config` → the mod → Obsidian vault path, or at install time with
`--config vaultPath=/path/to/vault`.

## Checks

```
claude plugin validate --strict claude-mods            # the marketplace
claude plugin validate --strict claude-mods/<mod>      # one mod
claude plugin test claude-mods/<mod>
```
