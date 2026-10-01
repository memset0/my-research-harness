import 'server-only'

import { join } from 'node:path'
import {
  type MutationFs,
  projectFs,
  readDocumentLock,
  readExperimentDoc,
  readRunDir,
} from '@memon/core'
import type { Runtime } from './runtime'

export async function refreshStandaloneRun(
  runtime: Runtime,
  projectName: string,
  id: string,
): Promise<void> {
  const current = runtime.index.get(id)
  if (!current) return
  try {
    const updated = await readRunDir(current.path, projectName)
    const parentExperimentId = runtime.withDeclaredParent(updated)
    runtime.index.set(updated)
    runtime.events.emit('run-change', {
      type: 'set',
      id: updated.id,
      experiment: updated,
      parentExperimentId,
    })
  } catch {
    // The shared service already committed. Runtime refresh is best-effort.
  }
}

export async function refreshStandaloneExperiment(
  runtime: Runtime,
  projectName: string,
  id: string,
): Promise<void> {
  const project = runtime.config.projects.find((candidate) => candidate.name === projectName)
  if (!project) return
  try {
    const updated = await readExperimentDoc(project.root, projectName, id)
    if (!updated) return
    runtime.experiments.set(id, updated)
    runtime.recomputeAnomalies(projectName)
    runtime.events.emit('experiment-change', { type: 'set', id, experiment: updated })
  } catch {
    // The shared service already committed. Runtime refresh is best-effort.
  }
}

export async function refreshStandaloneJournal(
  runtime: Runtime,
  projectName: string,
): Promise<void> {
  const journalPath = runtime.journalPath as ((project: string) => string | null) | undefined
  const project = runtime.config.projects.find((candidate) => candidate.name === projectName)
  const path =
    journalPath?.call(runtime, projectName) ??
    (project ? join(project.root, 'docs', 'journal.md') : null)
  if (!path) return
  const journalCache = runtime.journalCache as typeof runtime.journalCache | undefined
  const poller = runtime.poller as typeof runtime.poller | undefined
  await journalCache?.refresh(path).catch(() => undefined)
  if (journalCache && poller) journalCache.markStale(path, poller)
  runtime.events.emit('journal-change', { project: projectName })
}

export async function refreshStandaloneLifecycle(
  runtime: Runtime,
  projectName: string,
  experimentId: string,
  runIds: readonly string[],
  operation: 'set' | 'delete',
): Promise<void> {
  if (operation === 'delete') {
    runtime.experiments.delete(experimentId)
    runtime.recomputeAnomalies(projectName)
    runtime.events.emit('experiment-change', { type: 'delete', id: experimentId })
  } else {
    await refreshStandaloneExperiment(runtime, projectName, experimentId)
  }
  await Promise.all(runIds.map((id) => refreshStandaloneRun(runtime, projectName, id)))
  await refreshStandaloneJournal(runtime, projectName)
}

export function projectDocumentPath(
  runtime: Runtime,
  projectName: string,
  resource: string,
): string {
  const project = runtime.config.projects.find((candidate) => candidate.name === projectName)
  if (!project) throw new Error('Project is not configured')
  return join(project.root, ...resource.split('/'))
}

/**
 * The optimistic lock a standalone caller would have sent for `path`, for Web
 * requests that omit one. Read through the shared core lock reader over
 * `projectFs`, the same port the Backend service writes through.
 */
export function standaloneDocumentLock(
  path: string,
): Promise<{ expectedMtime: number; expectedHash: string }> {
  return readDocumentLock(projectFs as unknown as MutationFs, path)
}
