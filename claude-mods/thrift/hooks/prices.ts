import type { ModelUsage } from 'claude-code'

/** API list prices in USD per million tokens, as of 2026-10; cache writes at the 5-minute rate (1.25x input). */
type Price = { input: number; output: number; cacheRead: number; cacheWrite: number }

/** Haiku 5.5 bills a request whose prompt is longer than this at HAIKU_5_LONG. */
const HAIKU_5_LONG_PROMPT = 100_000
const HAIKU_5_LONG: Price = { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 }

const ROWS: readonly [RegExp, Price][] = [
  [/fable|mythos/, { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }],
  [/opus-5-5/, { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }],
  [/opus/, { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  [/sonnet-4/, { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  [/sonnet/, { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  [/haiku-5/, { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }],
  [/haiku/, { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
]
const UNKNOWN: Price = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }

export const priceOf = (model: string, promptTokens = 0): Price => {
  const m = model.toLowerCase()
  if (promptTokens > HAIKU_5_LONG_PROMPT && /haiku-5/.test(m)) return HAIKU_5_LONG
  return ROWS.find(([family]) => family.test(m))?.[1] ?? UNKNOWN
}

/** Estimated USD for one request's token counts on `model`. */
export function costOf(model: string, usage: ModelUsage): number {
  const p = priceOf(model, usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens)
  return (
    (usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      usage.cache_read_input_tokens * p.cacheRead +
      usage.cache_creation_input_tokens * p.cacheWrite) /
    1_000_000
  )
}

/**
 * What the request would have cost on `asked` with a cache that never switched models:
 * on a request right after a switch, the tokens written to the new model's cache would
 * have been read from the old one's, so they are priced as cache reads.
 */
export function baselineOf(asked: string, usage: ModelUsage, isSwitch: boolean): number {
  if (!isSwitch) return costOf(asked, usage)
  return costOf(asked, {
    ...usage,
    cache_read_input_tokens: usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
    cache_creation_input_tokens: 0,
  })
}

export const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(Math.abs(n) < 0.1 ? 4 : 2)}`
export const count = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
