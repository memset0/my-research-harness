// The writer obligation: turn a successful write's file changes into one
// index event.
//
// Every Experiment/Run write primitive already returns `FileChange[]` with
// the post-write content. Each changed path is classified (Experiment bundle
// file, legacy Experiment file, Run README) and the matching entry derived
// from the content the primitive holds plus one stat per file. Nothing here
// reads the index or decides what a primitive writes.

import { dirname, join } from 'node:path'
import { RUN_DIR_REGEX, RUN_ROOT_DIRECTORIES } from '../ids.js'
import { deriveExperimentEntry, deriveRunEntry, experimentLocation, indexKey } from './entries.js'
import {
  type AppendIndexEventResult,
  appendIndexEvent,
  INDEX_EVENT_FAILED,
  type IndexEventWarning,
  type IndexSink,
} from './events.js'
import type { ExperimentIndexEntry, RunIndexEntry } from './schema.js'

/** The changed file of a write, as the primitives report it. */
export interface IndexedFileChange {
  path: string
  after: string | null
}

export interface MutationIndexExtras {
  /** Absolute Run directories to (re)derive even without a README change. */
  upsertRuns?: string[]
  /** Absolute Run directories whose entries must be removed. */
  removeRuns?: string[]
  /** Absolute Experiment README paths whose entries must be removed. */
  removeExperiments?: string[]
}

const EXPERIMENT_BUNDLE_FILES = new Set([
  'README.md',
  'implementation.yaml',
  'investigation.yaml',
  'results.yaml',
])

type Classified =
  | { kind: 'experiment'; readmePath: string; content?: string }
  | { kind: 'run'; dir: string; content?: string | null }

/** Which index entry a changed absolute path belongs to, if any. */
export function classifyIndexedPath(
  projectRoot: string,
  path: string,
): { kind: 'experiment'; readmePath: string } | { kind: 'run'; dir: string } | null {
  const key = indexKey(projectRoot, path)
  if (key.startsWith('..') || key.startsWith('/')) return null
  const segments = key.split('/')
  if (segments[0] === 'docs' && segments[1] === 'experiments') {
    if (segments.length === 4 && EXPERIMENT_BUNDLE_FILES.has(segments[3]!)) {
      const readmePath = join(dirname(path), 'README.md')
      return experimentLocation(projectRoot, readmePath) ? { kind: 'experiment', readmePath } : null
    }
    if (segments.length === 3 && experimentLocation(projectRoot, path)) {
      return { kind: 'experiment', readmePath: path }
    }
    return null
  }
  if (
    segments.length >= 3 &&
    segments.at(-1) === 'README.md' &&
    (RUN_ROOT_DIRECTORIES as readonly string[]).includes(segments[0]!) &&
    RUN_DIR_REGEX.test(segments.at(-2)!)
  ) {
    return { kind: 'run', dir: dirname(path) }
  }
  return null
}

/**
 * Publish the event for a write that changed `changes` (plus `extras`). No
 * sink, or a write that changed nothing, publishes nothing. Never throws:
 * derivation and publishing failures come back as warnings.
 */
export async function publishMutationEvent(
  sink: IndexSink | undefined,
  op: string,
  changes: readonly IndexedFileChange[],
  extras: MutationIndexExtras = {},
): Promise<IndexEventWarning[]> {
  if (!sink) return []
  try {
    const root = sink.projectRoot
    const targets = new Map<string, Classified>()
    for (const change of changes) {
      const classified = classifyIndexedPath(root, change.path)
      if (!classified) continue
      if (classified.kind === 'experiment') {
        const key = `e:${classified.readmePath}`
        const current = targets.get(key)
        const isReadme = classified.readmePath === change.path
        if (isReadme && change.after === null) {
          targets.set(key, { ...classified })
        } else if (!current || isReadme) {
          targets.set(key, {
            ...classified,
            ...(isReadme && change.after !== null ? { content: change.after } : {}),
          })
        }
      } else {
        targets.set(`r:${classified.dir}`, {
          ...classified,
          ...(change.after === null ? {} : { content: change.after }),
        })
      }
    }
    for (const dir of extras.upsertRuns ?? []) {
      if (!targets.has(`r:${dir}`)) targets.set(`r:${dir}`, { kind: 'run', dir })
    }
    const runs: Record<string, RunIndexEntry> = {}
    const experiments: Record<string, ExperimentIndexEntry> = {}
    const removedRuns = new Set<string>()
    const removedExperiments = new Set<string>()
    const now = sink.now
    await Promise.all(
      [...targets.values()].map(async (target) => {
        if (target.kind === 'run') {
          const entry = await deriveRunEntry({
            projectRoot: root,
            runDir: target.dir,
            ...(target.content === undefined ? {} : { content: target.content }),
            ...(sink.fs ? { fs: sink.fs } : {}),
            ...(now ? { now } : {}),
          })
          const key = indexKey(root, target.dir)
          if (entry) runs[key] = entry
          else removedRuns.add(key)
          return
        }
        const derived = await deriveExperimentEntry({
          projectRoot: root,
          readmePath: target.readmePath,
          ...(target.content === undefined ? {} : { content: target.content }),
          ...(sink.fs ? { fs: sink.fs } : {}),
          ...(now ? { now } : {}),
        })
        if (derived) experiments[derived.key] = derived.entry
        else {
          const location = experimentLocation(root, target.readmePath)
          if (location) removedExperiments.add(location.key)
        }
      }),
    )
    for (const dir of extras.removeRuns ?? []) {
      const key = indexKey(root, dir)
      if (!(key in runs)) removedRuns.add(key)
    }
    for (const readmePath of extras.removeExperiments ?? []) {
      const location = experimentLocation(root, readmePath)
      if (location && !(location.key in experiments)) removedExperiments.add(location.key)
    }
    const hasRuns = Object.keys(runs).length > 0
    const hasExperiments = Object.keys(experiments).length > 0
    if (!hasRuns && !hasExperiments && removedRuns.size === 0 && removedExperiments.size === 0) {
      return []
    }
    const result: AppendIndexEventResult = await appendIndexEvent(sink, op, {
      upserts: {
        ...(hasRuns ? { runs } : {}),
        ...(hasExperiments ? { experiments } : {}),
      },
      removals: {
        ...(removedRuns.size > 0 ? { runs: [...removedRuns].sort() } : {}),
        ...(removedExperiments.size > 0 ? { experiments: [...removedExperiments].sort() } : {}),
      },
    })
    return result.warnings
  } catch (error) {
    return [
      {
        code: INDEX_EVENT_FAILED,
        message: `derived index event not written: ${(error as Error)?.message ?? String(error)}`,
      },
    ]
  }
}
