// Per-path polling with exponential backoff.
//
// Design goals:
//   - One timer per watched path (not a global tick) — this lets each path
//     have its own backoff state without other paths influencing it
//   - On no-change: interval *= backoffFactor, capped at maxIntervalMs
//   - On change: callback invoked, interval reset to minIntervalMs
//   - resetBackoff(path): immediate stat + reset to min (used for user-attention
//     events like opening an experiment in the UI)
//
// We poll based on `mtime` of a single target path (the directory or a file).
// Higher-level callers track per-experiment `mtime = max(dir, README)` and
// translate changes into ExperimentIndex updates.

import { promises as fs } from 'node:fs'

export interface PollerOptions {
  minIntervalMs: number
  maxIntervalMs: number
  backoffFactor: number
}

export type PollerCallback = (path: string, mtime: number) => void | Promise<void>

interface PathState {
  interval: number
  lastMtime: number
  timer: NodeJS.Timeout | null
  /** Prevents overlapping ticks (slow callbacks vs. timer firing) */
  inFlight: boolean
}

export class Poller {
  private states = new Map<string, PathState>()
  private stopped = false

  constructor(
    private readonly opts: PollerOptions,
    private readonly onChange: PollerCallback,
  ) {}

  watch(path: string, initialMtime = 0): void {
    if (this.stopped) throw new Error('poller is stopped')
    if (this.states.has(path)) return
    const state: PathState = {
      interval: this.opts.minIntervalMs,
      lastMtime: initialMtime,
      timer: null,
      inFlight: false,
    }
    this.states.set(path, state)
    this.scheduleNext(path, state, this.opts.minIntervalMs)
  }

  unwatch(path: string): void {
    const s = this.states.get(path)
    if (!s) return
    if (s.timer) clearTimeout(s.timer)
    this.states.delete(path)
  }

  /**
   * Reset a path's backoff to the minimum interval and trigger an immediate tick.
   * Used by the web layer when the user opens / interacts with an experiment.
   */
  resetBackoff(path: string): void {
    const s = this.states.get(path)
    if (!s) return
    s.interval = this.opts.minIntervalMs
    if (s.timer) clearTimeout(s.timer)
    this.scheduleNext(path, s, 0)
  }

  /** Stop all timers. After stop(), the poller cannot be reused. */
  stop(): void {
    this.stopped = true
    for (const s of this.states.values()) {
      if (s.timer) clearTimeout(s.timer)
    }
    this.states.clear()
  }

  /** Number of paths currently being polled. */
  watchedCount(): number {
    return this.states.size
  }

  /** Test-only: inspect a path's current interval. */
  intervalFor(path: string): number | undefined {
    return this.states.get(path)?.interval
  }

  // ---------- internals ----------

  private scheduleNext(path: string, state: PathState, delay: number): void {
    if (this.stopped) return
    state.timer = setTimeout(() => {
      void this.tick(path, state)
    }, delay)
    // Allow the process to exit even if pollers are still scheduled
    // (unref() is the typical way to mark timers as non-blocking)
    state.timer.unref?.()
  }

  private async tick(path: string, state: PathState): Promise<void> {
    if (this.stopped || !this.states.has(path)) return
    if (state.inFlight) {
      // Another tick is in flight; reschedule for later
      this.scheduleNext(path, state, state.interval)
      return
    }
    state.inFlight = true
    try {
      let mtime = 0
      try {
        const s = await fs.stat(path)
        mtime = s.mtimeMs
      } catch {
        // Path gone or unreadable — back off but don't throw
        mtime = state.lastMtime
      }
      if (mtime !== state.lastMtime) {
        state.lastMtime = mtime
        state.interval = this.opts.minIntervalMs
        try {
          await this.onChange(path, mtime)
        } catch {
          // Swallow callback errors — poller must keep going
        }
      } else {
        state.interval = Math.min(
          state.interval * this.opts.backoffFactor,
          this.opts.maxIntervalMs,
        )
      }
    } finally {
      state.inFlight = false
      if (this.states.has(path) && !this.stopped) {
        this.scheduleNext(path, state, state.interval)
      }
    }
  }
}
