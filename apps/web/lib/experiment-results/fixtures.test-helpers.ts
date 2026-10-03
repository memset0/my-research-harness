// Shared fixtures for the experiment-results unit tests: Results summaries as
// the Backend serves them.

import type {
  ResultsCellPayload,
  ResultsColumnPayload,
  ResultsSummaryPayload,
  ResultsVariantPayload,
} from '../dto/experiments'

type Scalar = string | number | boolean | null
type StatsValues = Record<string, number | null>

export interface VariantFixture {
  status?: ResultsVariantPayload['status']
  declaredStatus?: ResultsVariantPayload['declaredStatus']
  name?: string
  /** `params.<key>` values. */
  parameters?: Record<string, Scalar>
  /** `metrics.<key>` values; an object is a stats cell aggregated over Runs. */
  metrics?: Record<string, Scalar | StatsValues>
  /** Extra cells keyed by result path. */
  cells?: Record<string, ResultsCellPayload>
  evidence?: string[]
  others?: ResultsVariantPayload['others']
  provenance?: ResultsVariantPayload['provenance']
}

export const valueCell = (value: Scalar, extra: Partial<ResultsCellPayload> = {}) =>
  ({ kind: 'value', source: 'run', value, ...extra }) as ResultsCellPayload

export const statsCell = (
  values: StatsValues,
  extra: Partial<Extract<ResultsCellPayload, { kind: 'stats' }>> = {},
) =>
  ({
    kind: 'stats',
    source: 'runs',
    runs: ['logs/a-261001-000000', 'logs/b-261001-000000', 'logs/c-261001-000000'],
    across: null,
    over: 'run',
    values,
    ...extra,
  }) as ResultsCellPayload

export function variant(id: string, fixture: VariantFixture = {}): ResultsVariantPayload {
  const cells: Record<string, ResultsCellPayload> = {}
  for (const [key, value] of Object.entries(fixture.parameters ?? {}))
    cells[`params.${key}`] = valueCell(value)
  for (const [key, value] of Object.entries(fixture.metrics ?? {})) {
    cells[`metrics.${key}`] =
      value !== null && typeof value === 'object' ? statsCell(value) : valueCell(value)
  }
  Object.assign(cells, fixture.cells ?? {})
  return {
    id,
    name: fixture.name ?? `Variant ${id}`,
    status: fixture.status ?? 'COMPLETED',
    declaredStatus: fixture.declaredStatus ?? null,
    evidence: fixture.evidence ?? [],
    others: fixture.others ?? [],
    ...(fixture.provenance ? { provenance: fixture.provenance } : {}),
    cells,
  }
}

export function column(
  key: string,
  label: string,
  type: ResultsColumnPayload['type'] = 'number',
  extra: Partial<ResultsColumnPayload> = {},
): ResultsColumnPayload {
  const partition = key.split('.')[0] as ResultsColumnPayload['partition']
  return {
    key,
    label,
    type,
    declared: true,
    partition,
    group: key.slice(0, key.lastIndexOf('.')),
    hidden: partition === 'env',
    ...extra,
  }
}

export const DEFAULT_COLUMNS: ResultsColumnPayload[] = [
  column('params.lr', 'Learning rate', 'number'),
  column('params.opt', 'Optimizer', 'string'),
  column('params.flag', 'Flag', 'boolean'),
  column('metrics.loss', 'Final loss', 'number'),
  column('metrics.notes', 'Notes', 'string'),
]

export function resultsDocument(
  variants: ResultsVariantPayload[],
  columns: ResultsColumnPayload[] = DEFAULT_COLUMNS,
  groups: ResultsSummaryPayload['groups'] = {},
): ResultsSummaryPayload {
  return {
    experimentSchemaVersion: 1,
    outcome: 'ok',
    error: null,
    groups,
    columns,
    variants,
    diagnostics: [],
  }
}

/** The single value of a variant's cell (undefined for anything else). */
export function cellScalar(row: ResultsVariantPayload, key: string): unknown {
  const cell = row.cells[key]
  return cell?.kind === 'value' ? cell.value : undefined
}
