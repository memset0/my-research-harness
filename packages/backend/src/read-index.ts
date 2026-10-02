// Per-Project summary index: parsed file observations validated by stat
// fingerprints.
//
// Every entry is keyed by what it observes (a parsed file, a directory
// listing, a real path, the Run walk) and carries the fingerprint it was
// built from. An entry validated within the caller's window is returned with
// no I/O; otherwise its fingerprint is taken again and the entry is reloaded
// only when the fingerprint changed. The index is populated on demand or, for
// FS v8 Projects on central, seeded once from the project's derived index
// (`derived-index-mirror.ts`); it is never persisted by itself and can be
// dropped at any time: it is a cache of file observations, never a source of
// truth.

import { createHash } from 'node:crypto'
import type { Dirent, Stats } from 'node:fs'
import { resolve } from 'node:path'
import { projectFs as fs, type ProjectConfig } from '@memon/core'

/** How long an observation may be reused without touching the filesystem. */
export interface ReadPolicy {
  /** Documents, listings and non-terminal Runs read by list/inventory routes. */
  listMaxAgeMs: number
  /** Run summaries whose status is terminal (FINISHED, FAILED, INTERRUPTED). */
  terminalRunMaxAgeMs: number
  /** Run walk reuse for lists; 0 walks on every request. */
  walkRefreshMs: number
}

/** Validate every observation on every request (standalone, CLI-shaped, tests). */
export const STRICT_READ_POLICY: ReadPolicy = Object.freeze({
  listMaxAgeMs: 0,
  terminalRunMaxAgeMs: 0,
  walkRefreshMs: 0,
})

/** Central: an external edit reaches every list within five minutes. */
export const CENTRAL_READ_POLICY: ReadPolicy = Object.freeze({
  listMaxAgeMs: 60_000,
  terminalRunMaxAgeMs: 300_000,
  walkRefreshMs: 60_000,
})

/** A fingerprint plus whatever the fingerprinting step observed. */
export interface Observation<O> {
  /** `null`: the target does not exist. */
  fingerprint: string | null
  observed?: O
}

/** One recorded dependency of a computed response (see `conditional-read`). */
export interface ObservedDependency {
  key: string
  fingerprint: string | null
  /** Re-take the fingerprint, honouring the window it was observed with. */
  revalidate: () => Promise<string | null>
}

/** Sink for dependencies observed while a response is computed. */
export type DependencySink = (dependency: ObservedDependency) => void

let currentSink: () => DependencySink | undefined = () => undefined

/** Installed by the conditional-read module; the index only reports to it. */
export function setDependencySinkProvider(provider: () => DependencySink | undefined): void {
  currentSink = provider
}

interface Entry {
  fingerprint: string | null
  value: unknown
  validatedAt: number
  pending: Promise<void> | null
  /**
   * Seeded from the derived index: the fingerprint was persisted without the
   * device number (it differs between NFS client mounts), so it is compared
   * with the device stripped until this process has taken it itself.
   */
  devless?: boolean
  /**
   * Seeded and not yet re-validated by this process: once its window has
   * passed the entry is still served (stale-while-revalidate) while one
   * background validation runs. Any invalidation clears it.
   */
  serveStale?: boolean
}

/** A seeded observation (see `ProjectReadIndex.seed`). */
export interface SeededObservation {
  /** Fingerprint in the device-less form of `devlessFingerprint`, or null (absent). */
  fingerprint: string | null
  value: unknown
  /** Epoch ms of the derived-index verification. */
  validatedAt: number
}

/** What `peek` reports about one entry. */
export interface PeekedEntry {
  fingerprint: string | null
  value: unknown
  validatedAt: number
  devless: boolean
}

/**
 * A `statFingerprint` (possibly prefixed, e.g. `readme:`) with its device
 * number replaced by `*`: the form persisted fingerprints are compared in.
 */
export function devlessFingerprint(fingerprint: string): string {
  return fingerprint.replace(/(^|:)([fdo]):[^:]*:/, '$1$2:*:')
}

function sameObservation(entry: Entry, next: string | null): boolean {
  if (entry.fingerprint === next) return true
  return (
    entry.devless === true &&
    next !== null &&
    entry.fingerprint !== null &&
    devlessFingerprint(next) === entry.fingerprint
  )
}

type MaxAge<T> = number | ((value: T | null) => number)

export class ProjectReadIndex {
  private readonly entries = new Map<string, Entry>()
  private walkState: {
    paths: readonly string[] | null
    builtAt: number
    pending: Promise<readonly string[]> | null
  } = { paths: null, builtAt: Number.NEGATIVE_INFINITY, pending: null }

  constructor(
    readonly root: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Number of entries (diagnostics and tests). */
  get size(): number {
    return this.entries.size
  }

  /** Force the next read of every entry (and the walk) to re-validate. */
  invalidate(): void {
    for (const entry of this.entries.values()) {
      entry.validatedAt = Number.NEGATIVE_INFINITY
      entry.serveStale = false
    }
    this.walkState.builtAt = Number.NEGATIVE_INFINITY
  }

  /** Force the next read of `key` to re-validate (no stale serving). */
  expire(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    entry.validatedAt = Number.NEGATIVE_INFINITY
    entry.serveStale = false
  }

  /**
   * Seed `key` from the derived index unless this process already observed
   * it. The entry keeps its recorded verification time, so the caller's
   * windows apply unchanged; past its window it is served stale while one
   * background validation re-takes the fingerprint.
   */
  seed(key: string, observation: SeededObservation): boolean {
    if (this.entries.has(key)) return false
    this.entries.set(key, {
      fingerprint: observation.fingerprint,
      value: observation.value,
      validatedAt: observation.validatedAt,
      pending: null,
      devless: true,
      serveStale: true,
    })
    return true
  }

  /** Seed the Run walk unless one was already taken by this process. */
  seedWalk(paths: readonly string[], builtAt: number): boolean {
    if (this.walkState.paths !== null || this.walkState.pending !== null) return false
    this.walkState.paths = paths
    this.walkState.builtAt = builtAt
    return true
  }

  /** The current state of `key` without any I/O (validator and tests). */
  peek(key: string): PeekedEntry | undefined {
    const entry = this.entries.get(key)
    if (!entry || entry.pending) return undefined
    return {
      fingerprint: entry.fingerprint,
      value: entry.value,
      validatedAt: entry.validatedAt,
      devless: entry.devless === true,
    }
  }

  /**
   * Record that `key` was verified at `at` against a device-less fingerprint
   * the caller checked on disk. Applied only when the entry still matches
   * that fingerprint (so a newer in-process observation is never masked).
   */
  confirm(key: string, devless: string | null, at: number): boolean {
    const entry = this.entries.get(key)
    if (!entry || entry.pending) return false
    const current =
      entry.fingerprint === null
        ? null
        : entry.devless
          ? entry.fingerprint
          : devlessFingerprint(entry.fingerprint)
    if (current !== devless) return false
    if (at > entry.validatedAt) entry.validatedAt = at
    return true
  }

  /**
   * The value for `key`: reused within `maxAgeMs` of its last validation,
   * otherwise re-fingerprinted and reloaded only when the fingerprint
   * changed. A missing target yields `null` (and is remembered as missing).
   * A load that throws is not cached.
   */
  async observe<T, O = undefined>(
    key: string,
    maxAgeMs: MaxAge<T>,
    fingerprint: () => Promise<Observation<O>>,
    load: (observed: O | undefined) => Promise<T>,
  ): Promise<T | null> {
    const window = (value: T | null) =>
      typeof maxAgeMs === 'function' ? maxAgeMs(value) : maxAgeMs
    const validate = async (): Promise<Entry> => {
      for (;;) {
        const entry = this.entries.get(key)
        if (entry?.serveStale && window(entry.value as T | null) > 0) {
          // Seeded and past its window: serve it, re-validate in the background.
          if (!entry.pending && this.now() - entry.validatedAt > window(entry.value as T | null)) {
            revalidate(entry).catch(() => undefined)
          }
          return entry
        }
        if (entry?.pending) {
          // Share the validation already in flight for this key.
          const settled = await entry.pending.then(
            () => this.entries.get(key),
            () => undefined,
          )
          if (settled && !settled.pending) return settled
          continue
        }
        const startedAt = this.now()
        const maxAge = entry ? window(entry.value as T | null) : 0
        if (entry && maxAge > 0 && startedAt - entry.validatedAt <= maxAge) return entry
        return revalidate(entry)
      }
    }
    const revalidate = async (entry: Entry | undefined): Promise<Entry> => {
      const startedAt = this.now()
      const holder: Entry = entry ?? {
        fingerprint: null,
        value: null,
        validatedAt: Number.NEGATIVE_INFINITY,
        pending: null,
      }
      const pending = (async () => {
        const next = await fingerprint()
        if (entry && sameObservation(entry, next.fingerprint)) {
          entry.fingerprint = next.fingerprint
          entry.devless = false
          entry.serveStale = false
          entry.validatedAt = startedAt
          return
        }
        const value = next.fingerprint === null ? null : await load(next.observed)
        holder.fingerprint = next.fingerprint
        holder.value = value
        holder.validatedAt = startedAt
        holder.devless = false
        holder.serveStale = false
      })()
      holder.pending = pending
      if (!entry) this.entries.set(key, holder)
      try {
        await pending
      } catch (error) {
        holder.pending = null
        // A failed load caches nothing: the next read starts over.
        if (this.entries.get(key) === holder) this.entries.delete(key)
        throw error
      }
      holder.pending = null
      return holder
    }
    const entry = await validate()
    const sink = currentSink()
    if (sink) {
      sink({
        key,
        fingerprint: entry.fingerprint,
        revalidate: async () => (await validate()).fingerprint,
      })
    }
    return entry.value as T | null
  }

  /** A file parsed by `parse`, fingerprinted by `stat`. */
  file<T>(
    path: string,
    parser: string,
    maxAgeMs: MaxAge<T>,
    parse: (content: string, stat: Stats) => T,
  ): Promise<T | null> {
    return this.observe<T, Stats>(
      `file:${path}#${parser}`,
      maxAgeMs,
      () => statObservation(path),
      async (stat) => parse(await fs.readFile(path, 'utf8'), stat!),
    )
  }

  /**
   * A directory listing (`null` when the directory is absent or not a
   * directory). The listing is its own fingerprint, so a reload costs the
   * same single `readdir`.
   */
  async listing(path: string, maxAgeMs: number): Promise<readonly ListedEntry[] | null> {
    return this.observe<readonly ListedEntry[], readonly ListedEntry[]>(
      `dir:${path}`,
      maxAgeMs,
      async () => {
        let entries: Dirent[]
        try {
          entries = await fs.readdir(path, { withFileTypes: true })
        } catch (error) {
          if (isAbsence(error)) return { fingerprint: null }
          throw error
        }
        const listed = entries
          .map((entry) => ({
            name: entry.name,
            type: entry.isDirectory()
              ? ('dir' as const)
              : entry.isFile()
                ? ('file' as const)
                : entry.isSymbolicLink()
                  ? ('link' as const)
                  : ('other' as const),
          }))
          .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
        return {
          fingerprint: digest(listed.map((entry) => `${entry.type}:${entry.name}`)),
          observed: listed,
        }
      },
      async (listed) => listed!,
    )
  }

  /** The real path of `path` (`null` when absent). */
  realpath(path: string, maxAgeMs: number): Promise<string | null> {
    return this.observe<string, string>(
      `real:${path}`,
      maxAgeMs,
      async () => {
        try {
          const real = await fs.realpath(path)
          return { fingerprint: real, observed: real }
        } catch (error) {
          if (isAbsence(error)) return { fingerprint: null }
          throw error
        }
      },
      async (real) => real!,
    )
  }

  /**
   * Every Run directory of `project`. With `refreshMs > 0` an existing walk
   * is served immediately and refreshed in the background once older than
   * that; with `0` the walk runs for this request.
   */
  async walk(
    project: ProjectConfig,
    refreshMs: number,
    run: (project: ProjectConfig) => Promise<readonly string[]>,
  ): Promise<readonly string[]> {
    const state = this.walkState
    const start = () => {
      const pending = run(project).then(
        (paths) => {
          state.paths = paths
          state.builtAt = this.now()
          state.pending = null
          return paths
        },
        (error: unknown) => {
          state.pending = null
          throw error
        },
      )
      state.pending = pending
      return pending
    }
    let paths: readonly string[]
    if (refreshMs <= 0 || state.paths === null) {
      paths = await (state.pending ?? start())
    } else {
      if (state.pending === null && this.now() - state.builtAt >= refreshMs) {
        start().catch(() => undefined)
      }
      paths = state.paths
    }
    const sink = currentSink()
    if (sink) {
      sink({
        key: 'walk',
        fingerprint: digest(paths),
        revalidate: async () => digest(await this.walk(project, refreshMs, run)),
      })
    }
    return paths
  }
}

export interface ListedEntry {
  name: string
  type: 'dir' | 'file' | 'link' | 'other'
}

/** Stat fingerprint: same inode, same size, same modification and change time. */
export async function statObservation(path: string): Promise<Observation<Stats>> {
  try {
    const stat = await fs.stat(path)
    return { fingerprint: statFingerprint(stat), observed: stat }
  } catch (error) {
    if (isAbsence(error)) return { fingerprint: null }
    throw error
  }
}

export function statFingerprint(stat: Stats): string {
  const kind = stat.isFile() ? 'f' : stat.isDirectory() ? 'd' : 'o'
  return `${kind}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
}

export function digest(parts: readonly string[]): string {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part).update('\0')
  return hash.digest('base64url').slice(0, 27)
}

function isAbsence(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

// --------------------------------------------------------------- registry

const indexes = new Map<string, ProjectReadIndex>()
const rootsByName = new Map<string, Set<string>>()

/** The process-wide index for a Project root. */
export function projectReadIndex(root: string): ProjectReadIndex {
  const key = resolve(root)
  let index = indexes.get(key)
  if (!index) {
    index = new ProjectReadIndex(key)
    indexes.set(key, index)
  }
  return index
}

/** Remember which roots a Project name maps to, for write invalidation. */
export function registerProjectRoots(projects: readonly ProjectConfig[]): void {
  for (const project of projects) {
    const roots = rootsByName.get(project.name) ?? new Set<string>()
    roots.add(resolve(project.root))
    rootsByName.set(project.name, roots)
  }
}

/** Re-validate everything for a Project after a write through central. */
export function invalidateProjectReadIndex(projectName: string): void {
  for (const root of rootsByName.get(projectName) ?? []) indexes.get(root)?.invalidate()
}

/** Drop every index (tests; also a valid operation at any time). */
export function dropProjectReadIndexes(): void {
  indexes.clear()
}
