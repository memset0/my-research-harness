// Card-footer liveness state derived from the foreground program's PTY title.
//
// State precedence each tick (first match wins):
//   1. attention — title matches the attention rule (currently: contains
//      'action required', case-insensitive).
//   2. running   — title starts with a code point inside any range in
//      RUNNING_PREFIX_RANGES (currently: U+2800..U+28FF, the Braille
//      Patterns block) OR is a member of the extras set
//      RUNNING_PREFIX_CHARS (currently empty).
//   3. done      — the per-sessionName memo flag is true (cleared only
//      when the user opens a ttyd via manager.startSession /
//      attachExistingSession).
//   4. idle      — fall-through.
//
// `running` and `attention` are purely reactive (recomputed every tick).
// `done` is sticky via the memo until the user opens the ttyd.
//
// Storage: a Map<sessionName, { hadUnacknowledgedRunning: boolean }> pinned
// on globalThis so Next.js HMR doesn't drop the state. Same pattern as the
// terminal manager and pane-info cache.

import type { TmuxPaneInfo } from './tmux-discover'

export type PaneSessionState = 'idle' | 'running' | 'attention' | 'done'

/** Code-point ranges (inclusive) whose first-character membership signals
 *  "active work" by the foreground program. Initial range covers the entire
 *  Unicode Braille Patterns block (256 code points) — every spinner glyph
 *  Claude Code and codex emit at the head of their PTY title sits in here.
 *  Additional ranges may be appended in future changes. */
export const RUNNING_PREFIX_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x2800, 0x28ff], // Braille Patterns
]

/** Explicit single-character additions outside the ranges above. Empty by
 *  default; reserve for future non-Braille spinner glyphs (e.g. codex's
 *  `[ . ]` pattern starts with `[` if we ever decide to track it). */
export const RUNNING_PREFIX_CHARS: ReadonlySet<string> = new Set<string>()

/** Substrings (lowercased) that, when present anywhere in the title, signal
 *  the user needs to act. Initial entry covers codex's "Action Required"
 *  prompt; additional substrings may be appended in future changes. */
export const ATTENTION_PATTERNS: readonly string[] = ['action required']

// ---------- Predicates ----------

export function matchesRunning(title: string | null): boolean {
  if (!title || title.length === 0) return false
  const cp = title.codePointAt(0)
  if (cp === undefined) return false
  for (const [lo, hi] of RUNNING_PREFIX_RANGES) {
    if (cp >= lo && cp <= hi) return true
  }
  if (RUNNING_PREFIX_CHARS.has(String.fromCodePoint(cp))) return true
  return false
}

export function matchesAttention(title: string | null): boolean {
  if (!title || title.length === 0) return false
  const lower = title.toLowerCase()
  for (const p of ATTENTION_PATTERNS) {
    if (lower.includes(p)) return true
  }
  return false
}

// ---------- Memo storage ----------

const GLOBAL_KEY = '__memonPaneStateMemo' as const
interface MemoEntry {
  /** Whether a prior tick observed `state === 'running'` and the user has
   *  not yet opened the ttyd to acknowledge it. Drives the `done` state. */
  hadUnacknowledgedRunning: boolean
  /** Last state we computed for this sessionName. Used to detect state
   *  transitions so we can stamp `lastStateChangeAt`. Set to the computed
   *  state on every tick. */
  lastState: PaneSessionState
  /** ISO8601 timestamp of the most recent state transition for this
   *  sessionName. `null` when the entry is fresh — we treat "first
   *  observation" as a non-event so the card can fall back to
   *  `tmuxLastActivity` until an actual transition happens. */
  lastStateChangeAt: string | null
}
function getMemo(): Map<string, MemoEntry> {
  const slot = globalThis as unknown as { [GLOBAL_KEY]?: Map<string, MemoEntry> }
  if (!slot[GLOBAL_KEY]) slot[GLOBAL_KEY] = new Map()
  return slot[GLOBAL_KEY]!
}

// ---------- State computation ----------

export function computePaneState(
  sessionName: string,
  pane: TmuxPaneInfo | null,
): PaneSessionState {
  const title = pane?.title ?? null
  const memo = getMemo()
  const existing = memo.get(sessionName)

  // Decide the new state per precedence: attention > running > done > idle.
  // Compute newState first as a pure function of inputs + existing memo
  // flag, then commit the transition update once at the end.
  let newState: PaneSessionState
  let nextHadUnacknowledgedRunning = existing?.hadUnacknowledgedRunning ?? false

  if (matchesAttention(title)) {
    // Attention is reactive AND does not toggle the running memo —
    // attention's transition out is independent of "user acknowledgement".
    newState = 'attention'
  } else if (matchesRunning(title)) {
    nextHadUnacknowledgedRunning = true
    newState = 'running'
  } else if (nextHadUnacknowledgedRunning) {
    newState = 'done'
  } else {
    newState = 'idle'
  }

  if (!existing) {
    // First observation: record state but don't stamp a transition time.
    // The card falls back to tmuxLastActivity until a real transition.
    memo.set(sessionName, {
      hadUnacknowledgedRunning: nextHadUnacknowledgedRunning,
      lastState: newState,
      lastStateChangeAt: null,
    })
  } else {
    const changed = existing.lastState !== newState
    existing.hadUnacknowledgedRunning = nextHadUnacknowledgedRunning
    existing.lastState = newState
    if (changed) existing.lastStateChangeAt = new Date().toISOString()
  }

  return newState
}

/** ISO8601 of the most recent state transition for `sessionName`, or `null`
 *  when no transition has been observed (fresh memo entry, or no memo
 *  entry at all). */
export function getLastStateChangeAt(sessionName: string): string | null {
  return getMemo().get(sessionName)?.lastStateChangeAt ?? null
}

/** Called by manager.startSession / attachExistingSession when the user
 *  registers a ttyd entry for `sessionName` (fresh OR idempotent reattach).
 *  This is the only signal that clears 'done' back to 'idle'. Also drops
 *  the state-transition timestamp so the card falls back to tmuxLastActivity
 *  after the user opens the ttyd. */
export function clearPaneStateMemo(sessionName: string): void {
  getMemo().delete(sessionName)
}

/** Drop memo entries for sessionNames no longer present on the host. Called
 *  at the end of each enrichment pass in tmux-discover.ts. */
export function prunePaneStateMemoToActiveSet(activeSessionNames: Set<string>): void {
  const memo = getMemo()
  for (const name of memo.keys()) {
    if (!activeSessionNames.has(name)) memo.delete(name)
  }
}

/** Test-only: reset the memo between unit tests so assertions are deterministic. */
export function __resetPaneStateMemoForTests(): void {
  getMemo().clear()
}
