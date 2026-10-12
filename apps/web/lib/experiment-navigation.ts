import type { ExperimentListRow } from './api'

export const EXPERIMENT_GROUPS = [
  {
    key: 'ACTIVE',
    label: 'Active',
    description: 'Current research · running and completed plans',
    collapsed: false,
  },
  {
    key: 'PAUSED',
    label: 'Paused',
    description: 'Intended work, temporarily on hold',
    collapsed: false,
  },
  {
    key: 'ARCHIVED',
    label: 'Archived',
    description: 'Phase concluded · still relevant',
    collapsed: true,
  },
  { key: 'RETIRED', label: 'Retired', description: 'Direction no longer pursued', collapsed: true },
  { key: 'OPEN', label: 'Open (legacy)', description: 'Legacy OPEN status', collapsed: false },
  {
    key: 'RESOLVED',
    label: 'Resolved (legacy)',
    description: 'Legacy RESOLVED status',
    collapsed: false,
  },
  {
    key: 'ABANDONED',
    label: 'Abandoned (legacy)',
    description: 'Legacy ABANDONED status',
    collapsed: false,
  },
  {
    key: 'LEGACY_ARCHIVED',
    label: 'Archived (legacy)',
    description: 'Legacy archive flag · original status retained',
    collapsed: true,
  },
  {
    key: 'UNKNOWN',
    label: 'Status unavailable',
    description: 'Document metadata is not available',
    collapsed: false,
  },
] as const

export type ExperimentGroupKey = (typeof EXPERIMENT_GROUPS)[number]['key']
export type ExperimentGroup = (typeof EXPERIMENT_GROUPS)[number]

export function experimentGroup(row?: ExperimentListRow): ExperimentGroupKey {
  if (!row || row.parseErrors.length > 0) return 'UNKNOWN'
  const status = row.frontMatter.status
  if (['OPEN', 'RESOLVED', 'ABANDONED'].includes(status) && row.frontMatter.archived)
    return 'LEGACY_ARCHIVED'
  return status
}

export function compareExperimentNavigation(a: ExperimentListRow, b: ExperimentListRow): number {
  const running = Number(b.displayStatus === 'RUNNING') - Number(a.displayStatus === 'RUNNING')
  const timeA = Date.parse(a.effectiveUpdatedAt) || 0
  const timeB = Date.parse(b.effectiveUpdatedAt) || 0
  return running || timeB - timeA || a.id.localeCompare(b.id)
}

export function shortExperimentId(id: string): string {
  return id.match(/^E\d+/)?.[0] ?? id
}
