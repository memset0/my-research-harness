import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import {
  BackendCodeReviewsResponseSchema,
  BackendReportsResponseSchema,
  discoverExperiments,
  discoverRuns,
  discoverWikiPages,
  type ProjectConfig,
  ProjectNameSchema,
  ResourceIdSchema,
} from '@memon/core'
import { FilesystemDocumentService } from './document-service.js'
import type { BackendEventStream } from './event-stream.js'

export const DEFAULT_BACKEND_MONITOR_MIN_INTERVAL_MS = 1_000
export const DEFAULT_BACKEND_MONITOR_MAX_INTERVAL_MS = 30_000
export const DEFAULT_BACKEND_MONITOR_BACKOFF_FACTOR = 2

export type BackendMonitoredResourceKind =
  | 'run'
  | 'experiment'
  | 'report'
  | 'code-review'
  | 'wiki'

export interface BackendMonitorSnapshotEntry {
  kind: BackendMonitoredResourceKind
  id: string
  signature: string
}

export type BackendMonitorSnapshot = ReadonlyMap<string, BackendMonitorSnapshotEntry>
export type BackendProjectScanner = (project: ProjectConfig) => Promise<BackendMonitorSnapshot>

export interface BackendMonitorTimer {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface BackendFilesystemMonitorOptions {
  projects: readonly ProjectConfig[]
  eventStream: BackendEventStream
  minIntervalMs?: number
  maxIntervalMs?: number
  backoffFactor?: number
  scanner?: BackendProjectScanner
  timer?: BackendMonitorTimer
  refreshProject?: (projectName: string) => Promise<unknown>
}

export interface BackendFilesystemMonitorControl {
  stop(): void
}

interface ProjectMonitorState {
  project: ProjectConfig
  snapshot: BackendMonitorSnapshot | null
  intervalMs: number
  timer: unknown | null
  inFlight: boolean
}

const DEFAULT_TIMER: BackendMonitorTimer = {
  setTimeout(callback, delayMs) {
    const handle = setTimeout(callback, delayMs)
    handle.unref?.()
    return handle
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

export class BackendFilesystemMonitor implements BackendFilesystemMonitorControl {
  private readonly eventStream: BackendEventStream
  private readonly minIntervalMs: number
  private readonly maxIntervalMs: number
  private readonly backoffFactor: number
  private readonly scanner: BackendProjectScanner
  private readonly timer: BackendMonitorTimer
  private readonly refreshProject: ((projectName: string) => Promise<unknown>) | undefined
  private readonly states = new Map<string, ProjectMonitorState>()
  private started = false
  private stopped = false

  constructor(options: BackendFilesystemMonitorOptions) {
    this.eventStream = options.eventStream
    this.minIntervalMs = positiveInteger(
      options.minIntervalMs ?? DEFAULT_BACKEND_MONITOR_MIN_INTERVAL_MS,
      'minIntervalMs',
    )
    this.maxIntervalMs = positiveInteger(
      options.maxIntervalMs ?? DEFAULT_BACKEND_MONITOR_MAX_INTERVAL_MS,
      'maxIntervalMs',
    )
    if (this.maxIntervalMs < this.minIntervalMs) {
      throw new Error('maxIntervalMs must be greater than or equal to minIntervalMs')
    }
    this.backoffFactor = options.backoffFactor ?? DEFAULT_BACKEND_MONITOR_BACKOFF_FACTOR
    if (!Number.isFinite(this.backoffFactor) || this.backoffFactor <= 1) {
      throw new Error('backoffFactor must be greater than 1')
    }
    this.scanner = options.scanner ?? scanBackendProject
    this.timer = options.timer ?? DEFAULT_TIMER
    this.refreshProject = options.refreshProject
    for (const project of options.projects) {
      const name = ProjectNameSchema.parse(project.name)
      if (this.states.has(name)) throw new Error(`duplicate Project ${name}`)
      this.states.set(name, {
        project,
        snapshot: null,
        intervalMs: this.minIntervalMs,
        timer: null,
        inFlight: false,
      })
    }
  }

  async start(): Promise<void> {
    if (this.stopped) throw new Error('filesystem monitor is stopped')
    if (this.started) return
    this.started = true
    await Promise.all([...this.states.values()].map((state) => this.poll(state, false)))
    if (this.stopped) return
    for (const state of this.states.values()) this.schedule(state)
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    for (const state of this.states.values()) {
      if (state.timer !== null) this.timer.clearTimeout(state.timer)
      state.timer = null
    }
  }

  async pollNow(projectName: string): Promise<void> {
    const state = this.states.get(projectName)
    if (!state) throw new Error(`unknown Project ${projectName}`)
    if (this.stopped) return
    if (state.timer !== null) this.timer.clearTimeout(state.timer)
    state.timer = null
    await this.poll(state, true)
  }

  intervalFor(projectName: string): number | undefined {
    return this.states.get(projectName)?.intervalMs
  }

  activeTimerCount(): number {
    return [...this.states.values()].filter((state) => state.timer !== null).length
  }

  private schedule(state: ProjectMonitorState): void {
    if (this.stopped || !this.started || state.timer !== null) return
    state.timer = this.timer.setTimeout(() => {
      state.timer = null
      void this.poll(state, true)
    }, state.intervalMs)
  }

  private async poll(state: ProjectMonitorState, scheduleAfter: boolean): Promise<void> {
    if (this.stopped || state.inFlight) return
    state.inFlight = true
    try {
      const next = await this.scanner(state.project)
      if (this.stopped) return
      if (state.snapshot === null) {
        await this.refreshProject?.(state.project.name)
        state.snapshot = next
        state.intervalMs = this.minIntervalMs
      } else {
        const changes = diffSnapshots(state.snapshot, next)
        if (changes.length > 0) await this.refreshProject?.(state.project.name)
        for (const change of changes) {
          this.eventStream.publish({
            project: state.project.name,
            topic: topicFor(change.kind),
            data: { type: change.type, id: change.id },
          })
        }
        if (changes.some((change) => change.kind === 'run' || change.kind === 'experiment')) {
          this.eventStream.publish({
            project: state.project.name,
            topic: 'anomaly',
            data: { type: 'recompute' },
          })
        }
        state.snapshot = next
        state.intervalMs =
          changes.length > 0
            ? this.minIntervalMs
            : Math.min(state.intervalMs * this.backoffFactor, this.maxIntervalMs)
      }
    } catch {
      if (!this.stopped) {
        state.intervalMs = Math.min(state.intervalMs * this.backoffFactor, this.maxIntervalMs)
      }
      // Keep the last successful snapshot. A transient NFS/SSH/filesystem
      // failure must not manufacture deletions or stop other Projects.
    } finally {
      state.inFlight = false
      if (scheduleAfter && !this.stopped) this.schedule(state)
    }
  }
}

export async function scanBackendProject(project: ProjectConfig): Promise<BackendMonitorSnapshot> {
  ProjectNameSchema.parse(project.name)
  const documents = new FilesystemDocumentService([project])
  const [runPaths, experimentResult, reports, codeReviews, wikiPages] = await Promise.all([
    discoverRuns(project, { includeArchived: true }),
    discoverExperiments(project.root, project.name),
    documents.listReports(project.name),
    documents.listCodeReviews(project.name),
    // Discovery only: the derived wiki projection (git review, source
    // resolution) is far too expensive for the poll loop.
    discoverWikiPages(project.root),
  ])
  const grouped = new Map<
    string,
    { kind: BackendMonitoredResourceKind; id: string; parts: string[] }
  >()
  const add = (kind: BackendMonitoredResourceKind, idInput: string, signature: string) => {
    const id = ResourceIdSchema.parse(idInput)
    const key = `${kind}\0${id}`
    const existing = grouped.get(key)
    if (existing) existing.parts.push(signature)
    else grouped.set(key, { kind, id, parts: [signature] })
  }

  await Promise.all(
    runPaths.map(async (runPath) => {
      const id = basename(runPath)
      const [directory, readme] = await Promise.all([
        fs.stat(runPath),
        fs.stat(join(runPath, 'README.md')).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null
          throw error
        }),
      ])
      add('run', id, `${directory.mtimeMs}:${readme?.mtimeMs ?? 0}:${readme?.size ?? 0}`)
    }),
  )
  for (const experiment of experimentResult.experiments) {
    add('experiment', experiment.id, `${experiment.mtime}:${experiment.readmeMtime}`)
  }
  for (const report of BackendReportsResponseSchema.parse(reports).reports) {
    add('report', report.id, `${report.resource}:${report.mtime}`)
  }
  for (const review of BackendCodeReviewsResponseSchema.parse(codeReviews).codeReviews) {
    add('code-review', review.id, `${review.resource}:${review.mtime}`)
  }
  for (const page of wikiPages) {
    add('wiki', page.id, `${page.path}:${page.mtime}`)
  }

  return new Map(
    [...grouped.entries()].map(([key, entry]) => [
      key,
      {
        kind: entry.kind,
        id: entry.id,
        signature: entry.parts.sort().join('|'),
      },
    ]),
  )
}

interface SnapshotChange {
  kind: BackendMonitoredResourceKind
  id: string
  type: 'set' | 'delete'
}

function diffSnapshots(
  previous: BackendMonitorSnapshot,
  next: BackendMonitorSnapshot,
): SnapshotChange[] {
  const changes: SnapshotChange[] = []
  for (const [key, entry] of next) {
    if (previous.get(key)?.signature !== entry.signature) {
      changes.push({ kind: entry.kind, id: entry.id, type: 'set' })
    }
  }
  for (const [key, entry] of previous) {
    if (!next.has(key)) changes.push({ kind: entry.kind, id: entry.id, type: 'delete' })
  }
  return changes.sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id) || a.type.localeCompare(b.type),
  )
}

function topicFor(kind: BackendMonitoredResourceKind) {
  switch (kind) {
    case 'run':
      return 'run-change' as const
    case 'experiment':
      return 'experiment-change' as const
    case 'report':
      return 'reports-change' as const
    case 'code-review':
      return 'code-reviews-change' as const
    case 'wiki':
      return 'wiki-change' as const
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be positive`)
  return value
}
