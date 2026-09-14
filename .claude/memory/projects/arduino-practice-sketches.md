# arduino-practice-sketches

## Skills ported into .claude/skills/ [2026-09-13]
- `ponytail` (DietrichGebert/ponytail, MIT) — minimal/YAGNI coding mode.
- `brainstorming` (obra/superpowers, MIT) — idea-to-design gate before implementation.
- `create-plan` (ComposioHQ/awesome-codex-skills, Apache-2.0) — short checklist-style plans.
- `agent-designer` (alirezarezvani/claude-skills, MIT) — multi-agent architecture/tool-schema/eval scripts (Python, no network calls).

Deliberately left out after inspection: `superpowers` as a single skill
doesn't exist (closest match `using-superpowers` force-activates every
response and expects the whole framework installed); gstack's `autoplan`
depends on ~40 external `gstack` CLI files not present here; `skill-adapter`
(jeremylongshore) is a demo that only works inside its own marketplace repo.

## Memory setup [2026-09-14]
User wanted both persistent memory across sessions and a place to save
files. This session's environment is an ephemeral remote container, so
memory lives in `.claude/memory/` inside this git repo (committed, travels
with the code) rather than the default `~/.claude/memory/` (would be wiped
between sessions). Following the `memory-files` skill's layout: `core.md`,
`me.md`, `topics/`, `projects/`.
