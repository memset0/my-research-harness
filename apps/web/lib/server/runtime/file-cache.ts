// Generic in-memory cache for "read a file, parse its content, keep it around
// until mtime advances". Powered by the existing Poller — paths registered
// here are watched alongside experiment directories under the same backoff
// rules (1s → 5min, factor 2 by default).
//
// Used for docs/hypotheses.md and docs/journal.md per project (see ../runtime.ts), but
// the class is generic so other file-shaped sources of truth can plug in
// later without churn.
//
// Lifecycle:
//   1. ctor: register the paths
//   2. await warmup(): initial read+parse of every registered path
//   3. caller adds each path to the shared Poller
//   4. Poller's onChange callback delegates to handlePollChange(path) → if
//      the cache claims that path, it triggers an internal refresh()
//   5. callers read via get(path)

import { promises as fs } from 'node:fs'
import type { Poller } from '@memon/core'

export interface FileCacheEntry<T> {
  /** Parsed value, or null when the file doesn't exist (ENOENT) */
  value: T | null
  /** Last observed mtime in epoch ms (0 when ENOENT) */
  mtime: number
  /** Most recent error message during refresh, or null */
  lastError: string | null
}

export interface FileCacheOptions<T> {
  /** Human-readable name (logging only) */
  name: string
  /** Absolute paths to watch */
  paths: string[]
  /** Parser invoked on the file's UTF-8 content */
  parse: (content: string) => T
  /** Optional callback fired after every successful refresh */
  onUpdate?: (path: string, value: T | null) => void
}

export class FileCache<T> {
  private readonly store = new Map<string, FileCacheEntry<T>>()
  private readonly pathSet: Set<string>

  constructor(private readonly opts: FileCacheOptions<T>) {
    this.pathSet = new Set(opts.paths)
    // Pre-populate placeholder entries so `get` always returns an entry for a
    // registered path (rather than `undefined` until first refresh).
    for (const p of opts.paths) {
      this.store.set(p, { value: null, mtime: 0, lastError: null })
    }
  }

  /** Initial read + parse of every registered path, in parallel. */
  async warmup(): Promise<void> {
    await Promise.all(this.opts.paths.map((p) => this.refresh(p)))
  }

  /** Re-stat, re-read, re-parse a single path. ENOENT is not an error. */
  async refresh(path: string): Promise<void> {
    try {
      const stat = await fs.stat(path)
      const mtime = stat.mtimeMs
      const content = await fs.readFile(path, 'utf8')
      const value = this.opts.parse(content)
      this.store.set(path, { value, mtime, lastError: null })
      this.opts.onUpdate?.(path, value)
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') {
        this.store.set(path, { value: null, mtime: 0, lastError: null })
        this.opts.onUpdate?.(path, null)
      } else {
        // Keep the last good value but record the error
        const cur = this.store.get(path)
        this.store.set(path, {
          value: cur?.value ?? null,
          mtime: cur?.mtime ?? 0,
          lastError: e.message,
        })
      }
    }
  }

  /** Read the current cached entry for a path. */
  get(path: string): FileCacheEntry<T> | undefined {
    return this.store.get(path)
  }

  /**
   * Optimistic write-through: caller has just successfully written `path` on
   * disk and parsed the new content; populate the cache directly without
   * waiting for the next poll tick.
   */
  set(path: string, value: T, mtime: number): void {
    if (!this.pathSet.has(path)) return
    this.store.set(path, { value, mtime, lastError: null })
    this.opts.onUpdate?.(path, value)
  }

  /**
   * Tell the shared Poller that this path is interesting NOW — schedules an
   * immediate re-stat without waiting for the current backoff to expire.
   * Used after a known external write (e.g. appendJournalEvent succeeded).
   */
  markStale(path: string, poller: Poller): void {
    if (!this.pathSet.has(path)) return
    poller.resetBackoff(path)
  }

  /**
   * Called from the Poller's single onChange callback. Returns true iff this
   * cache owns the path — caller can short-circuit further dispatch.
   */
  handlePollChange(path: string): boolean {
    if (!this.pathSet.has(path)) return false
    void this.refresh(path)
    return true
  }

  /** All registered paths (read-only snapshot). */
  paths(): string[] {
    return Array.from(this.pathSet)
  }

  /** How many entries currently hold a non-null parsed value. */
  populated(): number {
    let n = 0
    for (const entry of this.store.values()) if (entry.value !== null) n += 1
    return n
  }

  /** Snapshot (mostly for /api/runtime/health). */
  inspect(): { populated: number; total: number; paths: string[] } {
    return {
      populated: this.populated(),
      total: this.pathSet.size,
      paths: Array.from(this.pathSet),
    }
  }
}
