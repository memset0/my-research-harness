import 'server-only'

import { invalidateProjectFile, type MutationFs, projectFs, readDocumentLock } from '@memon/core'
import { join } from '@memon/file-protocol/paths'
import type { Runtime } from './runtime'

function invalidate(runtime: Runtime, projectName: string): void {
  const project = runtime.config.projects.find((entry) => entry.name === projectName)
  if (project) invalidateProjectFile(project.root)
}

export async function refreshStandaloneRun(
  runtime: Runtime,
  projectName: string,
  _id: string,
): Promise<void> {
  invalidate(runtime, projectName)
}
export async function refreshStandaloneExperiment(
  runtime: Runtime,
  projectName: string,
  _id: string,
): Promise<void> {
  invalidate(runtime, projectName)
}
export async function refreshStandaloneJournal(
  runtime: Runtime,
  projectName: string,
): Promise<void> {
  invalidate(runtime, projectName)
}
export async function refreshStandaloneLifecycle(
  runtime: Runtime,
  projectName: string,
  _experimentId: string,
  _runIds: readonly string[],
  _operation: 'set' | 'delete',
): Promise<void> {
  invalidate(runtime, projectName)
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
