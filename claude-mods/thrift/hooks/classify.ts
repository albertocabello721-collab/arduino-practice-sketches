import type { ThriftTier } from '../types'

export type Verdict = { tier: ThriftTier; reason: string }

/** 0 haiku, 1 sonnet, 2 anything bigger or unknown. */
export const tierOf = (model: string | undefined): ThriftTier => {
  const m = (model ?? '').toLowerCase()
  if (m.includes('haiku')) return 0
  if (m.includes('sonnet')) return 1
  return 2
}

export const ALIAS: Record<0 | 1, string> = { 0: 'haiku', 1: 'sonnet' }

const JUDGMENT =
  /\b(architect\w*|design|redesign|migrat\w*|rewrite|across|all (the )?(files|modules|services|tests|call ?sites)|every|entire|whole|debug\w*|investigat\w*|root cause|why\b|flaky|race|concurren\w*|deadlock|performance|optimi[sz]\w*|security|vulnerab\w*|audit|review|plan|strategy|trade-?offs?|think|carefully|complex|subtle|should|would|best|approach|recommend|suggest|opinion|structure)\b/i
const GIT = /^(git\s+\w+|commit|push|pull|rebase|stash|amend|cherry-pick|squash|merge|checkout|switch)\b|\b(commit (this|these|that|it|everything|the changes|my changes)|push (it|this|that|the branch|to origin)|open a pr|create a (new )?branch|git (status|log|diff|stash|pull|push|commit|add|checkout|branch|fetch|tag))\b/i
const RUN = /^(run|re-?run|execute|start|launch)\b|^(npm|pnpm|yarn|bun|npx|make|cargo|pytest|python3?|node|ls|cat|pwd|tsc|eslint|prettier|go (test|build|run|vet)|\.\/)\b/i
const FORMAT = /\b(format\w*|reformat|prettier|lint\w*|eslint|gofmt|rustfmt|black|indent\w*|whitespace|trailing (spaces|whitespace)|sort (the )?imports|semicolons?|line endings)\b/i
const QUESTION = /^(what|where|which|who|how (does|do|is|are|many|much|long|often)|does|do|is|are|can|could|did|explain|describe|show me|tell me|list|summari[sz]e|find|locate|point me)\b|\?\s*$/i
const EDIT = /^(add|fix|update|change|remove|delete|drop|write|create|implement|move|extract|replace|bump|set|make|wire|hook up|convert|document|comment|tweak|adjust|edit|insert|append|include|export|import|log|handle|guard|check|validate|parse|split|inline|wrap|clean up|tidy|dedupe|simplify|shorten|enable|disable|toggle|swap|reorder|sort|filter|hide|show|style|align|trim|cap|limit|retry|cache|type|annotate|test|cover|mock|stub|assert|patch|copy|save|load|read|fetch|send|register|mount|open|close|stop|pause|reset|restart|install|uninstall|upgrade|pin|unpin|turn (on|off)|use|switch to|default to|rename)\b/i
const CLAUSES = /\b(and then|then|after that|and also|as well as|plus)\b/i

/**
 * Free heuristics over the prompt alone: trivial (0), routine (1), or keep the chosen model (2).
 * Conservative: anything long, multi-part, or asking for judgment is 2.
 */
export function classify(text: string): Verdict {
  const t = text.trim()
  if (t === '') return { tier: 2, reason: 'no prompt text' }
  if (t.length > 500 || /\n\s*\n/.test(t)) return { tier: 2, reason: 'long or multi-part prompt' }
  if (JUDGMENT.test(t)) return { tier: 2, reason: 'asks for judgment' }
  const isShort = t.length <= 200
  if (GIT.test(t) && isShort) return { tier: 0, reason: 'git housekeeping' }
  if (RUN.test(t) && isShort && !CLAUSES.test(t)) return { tier: 0, reason: 'runs a command' }
  if (/\brename\b/i.test(t) && isShort && !CLAUSES.test(t)) return { tier: 0, reason: 'rename' }
  if (FORMAT.test(t) && isShort) return { tier: 0, reason: 'formatting' }
  if (QUESTION.test(t) && t.length <= 300 && !EDIT.test(t)) return { tier: 0, reason: 'question about the repo' }
  if (EDIT.test(t) && t.length <= 300 && !CLAUSES.test(t)) return { tier: 1, reason: 'routine edit' }
  return { tier: 2, reason: 'not clearly routine' }
}
