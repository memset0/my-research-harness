// Token-bucket rate limiter for auth attempts.
//
// Shared between the middleware basic-auth check and the /api/auth/check
// endpoint so brute-force across either path is counted in one bucket per IP.
// In-memory only; state resets on process restart, which is acceptable for a
// single-user system.
//
// Default policy: capacity 60, refill 60 tokens / 60s (= 1 sustained req/s/IP
// with a 60-burst buffer). scrypt's ~70ms intrinsic cost is the primary
// brute-force defense; this limiter is the secondary one. The dev-friendly
// limit lets a single page load (~10–20 XHRs) and ad-hoc curl testing sail
// through without 429s, while still bounding an external attacker to
// O(1 password/s) → years to crack a 144-bit random password.
//
// We pin the limiter on globalThis so Next.js dev HMR doesn't reset it on
// every code edit (which would defeat its purpose).

const CAPACITY = 60
const REFILL_TOKENS = 60
const REFILL_WINDOW_MS = 60_000

interface Bucket {
  tokens: number
  lastRefillMs: number
}

const GLOBAL_KEY = '__memonAuthRateLimiter' as const

interface GlobalSlot {
  [GLOBAL_KEY]?: Map<string, Bucket>
}

function buckets(): Map<string, Bucket> {
  const slot = globalThis as unknown as GlobalSlot
  if (!slot[GLOBAL_KEY]) slot[GLOBAL_KEY] = new Map<string, Bucket>()
  return slot[GLOBAL_KEY]!
}

function refill(b: Bucket, now: number): void {
  const elapsed = now - b.lastRefillMs
  if (elapsed <= 0) return
  const add = (elapsed / REFILL_WINDOW_MS) * REFILL_TOKENS
  if (add > 0) {
    b.tokens = Math.min(CAPACITY, b.tokens + add)
    b.lastRefillMs = now
  }
}

export interface ConsumeResult {
  ok: boolean
  /** Seconds (rounded up, ≥ 1) until at least one token is available. Only set when ok=false. */
  retryAfter?: number
}

/**
 * Consume one token for `key` (typically the client IP). Lazy-refills first.
 * On bucket-empty, returns `{ ok: false, retryAfter: <s> }` where retryAfter
 * is the integer ceiling of the seconds until 1 token would refill.
 */
export function consume(key: string, now: number = Date.now()): ConsumeResult {
  const map = buckets()
  let b = map.get(key)
  if (!b) {
    b = { tokens: CAPACITY, lastRefillMs: now }
    map.set(key, b)
  } else {
    refill(b, now)
  }

  if (b.tokens >= 1) {
    b.tokens -= 1
    return { ok: true }
  }

  // Empty: compute time-to-1-token.
  const tokensNeeded = 1 - b.tokens
  const msUntilToken = (tokensNeeded * REFILL_WINDOW_MS) / REFILL_TOKENS
  const retryAfter = Math.max(1, Math.ceil(msUntilToken / 1000))
  return { ok: false, retryAfter }
}

/**
 * Extract the client IP from request headers, preferring the last entry of
 * `X-Forwarded-For` (Caddy is the only trusted upstream hop), falling back to
 * `socketAddr` when provided.
 */
export function clientIpFromHeaders(headers: Headers, socketAddr?: string | null): string {
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]!
  }
  return socketAddr ?? 'unknown'
}

/** Test-only: clear all buckets. */
export function __resetForTests(): void {
  buckets().clear()
}

/** Test-only: expose params. */
export const __limits = { CAPACITY, REFILL_TOKENS, REFILL_WINDOW_MS }
