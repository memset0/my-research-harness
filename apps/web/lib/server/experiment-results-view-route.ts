import 'server-only'

import { HostIdSchema, ProjectNameSchema } from '@memon/core'
import type { NextRequest } from 'next/server'
import {
  type ExperimentResultsViewDefinition,
  type ExperimentResultsViewScope,
  isExperimentResultsViewDefinition,
  RESULTS_VIEW_DEFINITION_MAX_BYTES,
  RESULTS_VIEW_NAME_MAX_LENGTH,
} from '../experiment-results-views'
import type { RequestIdentity } from './auth/request-context'

const EXPERIMENT_PATTERN = /^E\d{4,}-[A-Za-z0-9][A-Za-z0-9._-]*$/
const VIEW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/

export interface ParsedViewMutation {
  name?: string
  definition?: ExperimentResultsViewDefinition
}

export function parseResultsViewScope(
  req: NextRequest,
  centralMode: boolean,
): ExperimentResultsViewScope | null {
  const hosts = req.nextUrl.searchParams.getAll('host')
  const projects = req.nextUrl.searchParams.getAll('project')
  const experiments = req.nextUrl.searchParams.getAll('experiment')
  if (projects.length !== 1 || experiments.length !== 1 || hosts.length > 1) return null
  const project = ProjectNameSchema.safeParse(projects[0])
  const experimentId = experiments[0]
  if (!project.success || !experimentId || !EXPERIMENT_PATTERN.test(experimentId)) return null
  if (centralMode) {
    if (hosts.length !== 1) return null
    const host = HostIdSchema.safeParse(hosts[0])
    if (!host.success) return null
    return { host: host.data, project: project.data, experimentId }
  }
  if (hosts.length !== 0) return null
  return { host: null, project: project.data, experimentId }
}

export function canReadResultsViewScope(
  identity: RequestIdentity,
  scope: ExperimentResultsViewScope,
): boolean {
  if (identity.role === 'owner') return true
  if (identity.role !== 'viewer') return false
  if (scope.host) {
    return identity.scopeProjectRefs.some(
      (candidate) => candidate.host === scope.host && candidate.project === scope.project,
    )
  }
  return identity.scopeProjects.has(scope.project)
}

export function validResultsViewId(id: string): boolean {
  return VIEW_ID_PATTERN.test(id)
}

export function parseViewName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length === 0 || normalized.length > RESULTS_VIEW_NAME_MAX_LENGTH) return null
  for (const character of normalized) {
    const code = character.charCodeAt(0)
    if (code <= 31 || code === 127) return null
  }
  return normalized
}

export function parseViewDefinition(value: unknown): ExperimentResultsViewDefinition | null {
  if (!isExperimentResultsViewDefinition(value)) return null
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    return null
  }
  return Buffer.byteLength(serialized, 'utf8') <= RESULTS_VIEW_DEFINITION_MAX_BYTES ? value : null
}

export function parseViewMutation(value: unknown): ParsedViewMutation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length === 0 || keys.some((key) => key !== 'name' && key !== 'definition')) return null
  const mutation: ParsedViewMutation = {}
  if (Object.hasOwn(record, 'name')) {
    const name = parseViewName(record.name)
    if (name === null) return null
    mutation.name = name
  }
  if (Object.hasOwn(record, 'definition')) {
    const definition = parseViewDefinition(record.definition)
    if (definition === null) return null
    mutation.definition = definition
  }
  return mutation
}
