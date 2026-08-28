import type { ProjectTarget } from './api'

export type ResultsViewSortDirection = 'asc' | 'desc'
export type ResultsViewRowFilterOperator = 'eq' | 'neq' | 'gt' | 'lt'
export type ResultsViewRowOverride = 'include' | 'exclude'
export type ResultsViewPinSide = 'left' | 'right'
export type ResultsViewSotaMode = 'off' | 'higher-is-better' | 'lower-is-better'

export interface ResultsViewRowFilter {
  id: string
  columnId: string
  operator: ResultsViewRowFilterOperator
  value: string
}

export interface ResultsViewSortRule {
  id: string
  columnId: string
  direction: ResultsViewSortDirection
}

export interface ExperimentResultsViewDefinition {
  hiddenColumnIds: string[]
  columnOrderIds: string[]
  maxLines: number
  defaultSortRules: ResultsViewSortRule[]
  pinnedColumnIds: Record<ResultsViewPinSide, string[]>
  rowFilters: ResultsViewRowFilter[]
  rowOverrides: Record<string, ResultsViewRowOverride>
  sotaModes: Record<string, ResultsViewSotaMode>
  decimalPlaces: Record<string, number>
}

export interface ExperimentResultsViewScope {
  host: string | null
  project: string
  experimentId: string
}

export interface ExperimentResultsView {
  id: string
  scope: ExperimentResultsViewScope
  name: string
  definition: ExperimentResultsViewDefinition
  revision: number
  createdAt: number
  updatedAt: number
}

export interface ExperimentResultsViewsResponse {
  views: ExperimentResultsView[]
  canMutate: boolean
}

export const RESULTS_VIEW_NAME_MAX_LENGTH = 96
export const RESULTS_VIEW_DEFINITION_MAX_BYTES = 256 * 1024

export function resultsViewScope(
  project: ProjectTarget,
  experimentId: string,
): ExperimentResultsViewScope {
  return {
    host: typeof project === 'string' ? null : project.host,
    project: typeof project === 'string' ? project : project.project,
    experimentId,
  }
}

export function resultsViewScopeSearch(scope: ExperimentResultsViewScope): string {
  const search = new URLSearchParams()
  if (scope.host) search.set('host', scope.host)
  search.set('project', scope.project)
  search.set('experiment', scope.experimentId)
  return search.toString()
}

export function resultsViewLegacyPreferenceKey(scope: ExperimentResultsViewScope): string {
  const projectKey = scope.host ? `${scope.host}:${scope.project}` : scope.project
  return `memon:results-table:${projectKey}:${scope.experimentId}:preferences`
}

export function resultsViewLocalScopeKey(scope: ExperimentResultsViewScope): string {
  const projectKey = scope.host ? `${scope.host}:${scope.project}` : scope.project
  return `memon:results-views:${projectKey}:${scope.experimentId}`
}

export function isExperimentResultsViewDefinition(
  value: unknown,
): value is ExperimentResultsViewDefinition {
  if (!isRecord(value)) return false
  if (!stringArray(value.hiddenColumnIds) || !stringArray(value.columnOrderIds)) return false
  if (!positiveFiniteInteger(value.maxLines)) return false
  if (!Array.isArray(value.defaultSortRules) || !value.defaultSortRules.every(validSortRule)) {
    return false
  }
  if (!isRecord(value.pinnedColumnIds)) return false
  if (!stringArray(value.pinnedColumnIds.left) || !stringArray(value.pinnedColumnIds.right)) {
    return false
  }
  if (!Array.isArray(value.rowFilters) || !value.rowFilters.every(validRowFilter)) return false
  if (
    !recordValues(value.rowOverrides, (entry) => entry === 'include' || entry === 'exclude') ||
    !recordValues(
      value.sotaModes,
      (entry) => entry === 'off' || entry === 'higher-is-better' || entry === 'lower-is-better',
    ) ||
    !recordValues(
      value.decimalPlaces,
      (entry) => typeof entry === 'number' && Number.isFinite(entry),
    )
  ) {
    return false
  }
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function positiveFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function validSortRule(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.columnId === 'string' &&
    (value.direction === 'asc' || value.direction === 'desc')
  )
}

function validRowFilter(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.columnId === 'string' &&
    typeof value.value === 'string' &&
    (value.operator === 'eq' ||
      value.operator === 'neq' ||
      value.operator === 'gt' ||
      value.operator === 'lt')
  )
}

function recordValues(
  value: unknown,
  predicate: (entry: unknown) => boolean,
): value is Record<string, unknown> {
  return isRecord(value) && Object.values(value).every(predicate)
}
