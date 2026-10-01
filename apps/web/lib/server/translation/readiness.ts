import 'server-only'

// Translation readiness, probed at most once per outcome window.
//
// The probe starts the translation provider, which takes seconds and fails
// slowly when the provider is unusable. Every page that offers body
// translation asks for readiness, so the outcome is remembered process-wide:
// success for 10 minutes, failure for 60 seconds. Concurrent callers share
// one probe, and a caller that goes away never cancels it for the others.

export const READY_TTL_MS = 10 * 60_000
export const FAILURE_TTL_MS = 60_000

type Outcome = { ok: true } | { ok: false; error: unknown }

interface ReadinessState {
  outcome: Outcome | null
  settledAt: number
  pending: Promise<Outcome> | null
}

const STATE_KEY = '__memonTranslationReadinessV1' as const

function state(): ReadinessState {
  const scope = globalThis as typeof globalThis & { [STATE_KEY]?: ReadinessState }
  scope[STATE_KEY] ??= { outcome: null, settledAt: 0, pending: null }
  return scope[STATE_KEY]
}

/**
 * Resolve when the provider is ready, reject with the probe's error when it
 * is not; `probe` runs only when no fresh outcome is remembered.
 */
export async function translationReadiness(
  probe: () => Promise<void>,
  now: () => number = Date.now,
): Promise<void> {
  const current = state()
  const ttl = current.outcome?.ok ? READY_TTL_MS : FAILURE_TTL_MS
  let outcome: Outcome
  if (current.outcome && now() - current.settledAt < ttl) {
    outcome = current.outcome
  } else {
    current.pending ??= probe().then(
      (): Outcome => ({ ok: true }),
      (error: unknown): Outcome => ({ ok: false, error }),
    )
    const pending = current.pending
    outcome = await pending
    if (current.pending === pending) {
      current.pending = null
      current.outcome = outcome
      current.settledAt = now()
    }
  }
  if (!outcome.ok) throw outcome.error
}

/** Test seam. */
export function __resetTranslationReadinessForTests(): void {
  const current = state()
  current.outcome = null
  current.settledAt = 0
  current.pending = null
}
