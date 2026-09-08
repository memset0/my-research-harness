import { join } from 'node:path'
import { BackendMutationError } from '@memon/backend'
import { JournalRecordingError } from '@memon/core'
import { NextResponse } from 'next/server'
import type { Runtime } from '../runtime'
import {
  projectDocumentPath,
  refreshStandaloneLifecycle,
  standaloneDocumentLock,
} from './standalone-mutation-refresh'
import { standaloneServices } from './standalone-services'

function experimentProject(runtime: Runtime, id: string) {
  const experiment = runtime.experiments.get(id)
  if (!experiment) throw new BackendMutationError('RESOURCE_NOT_FOUND', 'Experiment not found')
  const project = runtime.projectFor(experiment.path)
  if (!project) throw new BackendMutationError('PROJECT_NOT_FOUND', 'Project not found')
  return { experiment, project }
}

export async function createStandaloneExperiment(
  runtime: Runtime,
  projectName: string,
  input: {
    slug: string
    title?: string
    hypotheses?: string[]
    tags?: string[]
    fromRun?: string | null
  },
) {
  const project = runtime.config.projects.find((candidate) => candidate.name === projectName)
  if (!project) throw new BackendMutationError('PROJECT_NOT_FOUND', 'Project not found')
  const fromRun = input.fromRun ? runtime.index.get(input.fromRun) : null
  if (input.fromRun && !fromRun) {
    throw new BackendMutationError('RESOURCE_NOT_FOUND', 'Run not found')
  }
  const fromRunLock = fromRun ? await standaloneDocumentLock(join(fromRun.path, 'README.md')) : null
  const result = await standaloneServices(runtime.config).mutations.createExperiment(projectName, {
    ...input,
    ...(fromRunLock
      ? {
          fromRunExpectedMtime: fromRunLock.expectedMtime,
          fromRunExpectedHash: fromRunLock.expectedHash,
        }
      : {}),
  })
  await refreshStandaloneLifecycle(
    runtime,
    projectName,
    result.id,
    input.fromRun ? [input.fromRun] : [],
    'set',
  )
  return {
    id: result.id,
    path: projectDocumentPath(runtime, projectName, result.resource),
    mtime: result.mtime,
  }
}

export async function bindStandaloneExperiment(
  runtime: Runtime,
  operation: 'link' | 'unlink',
  id: string,
  runId: string,
) {
  const { experiment, project } = experimentProject(runtime, id)
  const run = runtime.index.get(runId)
  if (!run) throw new BackendMutationError('RESOURCE_NOT_FOUND', 'Run not found')
  const [experimentLock, runLock] = await Promise.all([
    standaloneDocumentLock(experiment.path),
    standaloneDocumentLock(join(run.path, 'README.md')),
  ])
  const result = await standaloneServices(runtime.config).mutations.bindExperiment(
    operation,
    project.name,
    id,
    {
      run: runId,
      ...experimentLock,
      expectedRunMtime: runLock.expectedMtime,
      expectedRunHash: runLock.expectedHash,
    },
  )
  await refreshStandaloneLifecycle(runtime, project.name, id, [runId], 'set')
  return { experimentId: result.experimentId, runId: result.runId }
}

export async function deleteStandaloneExperiment(runtime: Runtime, id: string, force: boolean) {
  const { experiment, project } = experimentProject(runtime, id)
  const experimentLock = await standaloneDocumentLock(experiment.path)
  const runLocks = await Promise.all(
    experiment.frontMatter.runs.map(async (runId) => {
      const run = runtime.index.get(runId)
      if (!run) throw new BackendMutationError('RESOURCE_NOT_FOUND', 'Run not found')
      return { run: runId, ...(await standaloneDocumentLock(join(run.path, 'README.md'))) }
    }),
  )
  const result = await standaloneServices(runtime.config).mutations.deleteExperiment(
    project.name,
    id,
    { force, ...experimentLock, runLocks },
  )
  await refreshStandaloneLifecycle(runtime, project.name, id, result.cascadedRuns, 'delete')
  return result
}

export function standaloneExperimentMutationError(error: unknown): NextResponse | null {
  if (error instanceof JournalRecordingError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: 'Journal recording failed; inspect current documents before retrying.',
        },
      },
      { status: 500 },
    )
  }
  if (!(error instanceof BackendMutationError)) return null
  if (error.code === 'PARTIAL') {
    return NextResponse.json(
      {
        error: {
          code: 'PARTIAL',
          message: 'Mutation partially applied; inspect current documents before retrying.',
        },
      },
      { status: 500 },
    )
  }
  if (error.code === 'CONFLICT') {
    return NextResponse.json(
      {
        error: { code: 'CONFLICT', message: error.message },
        mtime: error.current?.mtime,
        hash: error.current?.hash,
        content: error.current?.content,
      },
      { status: 409 },
    )
  }
  if (error.code === 'BAD_STATE') {
    return NextResponse.json(
      { error: { code: 'BAD_STATE', message: error.message } },
      { status: 409 },
    )
  }
  if (error.code === 'BAD_REQUEST') {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: error.message } },
      { status: 400 },
    )
  }
  if (error.code === 'RESOURCE_NOT_FOUND' || error.code === 'PROJECT_NOT_FOUND') {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: error.message } },
      { status: 404 },
    )
  }
  return null
}
