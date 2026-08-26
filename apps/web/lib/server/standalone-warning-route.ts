import { BackendMutationError } from '@memon/backend'
import { NextResponse } from 'next/server'
import type { Runtime } from '../runtime'
import {
  refreshStandaloneExperiment,
  refreshStandaloneJournal,
  refreshStandaloneRun,
} from './standalone-mutation-refresh'
import { standaloneServices } from './standalone-services'

export type StandaloneWarningKind = 'run' | 'experiment'

function warningProject(runtime: Runtime, kind: StandaloneWarningKind, id: string): string | null {
  const target = kind === 'run' ? runtime.index.get(id) : runtime.experiments.get(id)
  if (!target) return null
  return runtime.projectFor(target.path)?.name ?? null
}

export async function listStandaloneWarnings(
  runtime: Runtime,
  kind: StandaloneWarningKind,
  id: string,
) {
  const project = warningProject(runtime, kind, id)
  if (!project) throw new BackendMutationError('RESOURCE_NOT_FOUND', 'Warning target not found')
  return standaloneServices(runtime.config).mutations.listWarnings(kind, project, id)
}

export async function mutateStandaloneWarning(
  runtime: Runtime,
  kind: StandaloneWarningKind,
  id: string,
  input: {
    op: 'add' | 'resolve' | 'reopen' | 'delete'
    rowId?: string
    category?: string
    message?: string
    note?: string
    run?: string | null
    expectedMtime?: number
    expectedHash?: string
  },
) {
  const project = warningProject(runtime, kind, id)
  if (!project) throw new BackendMutationError('RESOURCE_NOT_FOUND', 'Warning target not found')
  const service = standaloneServices(runtime.config).mutations
  const current = await service.listWarnings(kind, project, id)
  const result = await service.mutateWarning(kind, project, id, {
    ...input,
    expectedMtime: input.expectedMtime ?? current.mtime,
    expectedHash: input.expectedHash ?? current.hash,
  })
  await Promise.all([
    kind === 'run'
      ? refreshStandaloneRun(runtime, project, id)
      : refreshStandaloneExperiment(runtime, project, id),
    refreshStandaloneJournal(runtime, project),
  ])
  return result
}

export function standaloneWarningError(error: unknown): NextResponse | null {
  if (!(error instanceof BackendMutationError)) return null
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
  if (error.code === 'WARNINGS_SECTION_NOT_TABLE') {
    return NextResponse.json(
      {
        error: {
          code: 'WARNINGS_SECTION_NOT_TABLE',
          message: `Warnings section is non-conforming: ${error.message}. Format the section as a table or rename it.`,
        },
      },
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
