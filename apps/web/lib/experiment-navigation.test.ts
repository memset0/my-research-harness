// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ExperimentListRow } from './api'
import { compareExperimentNavigation, experimentGroup } from './experiment-navigation'

const row = (
  id: string,
  status: ExperimentListRow['frontMatter']['status'],
  updated: string,
  displayStatus: ExperimentListRow['displayStatus'] = status,
) =>
  ({
    id,
    frontMatter: {
      id,
      slug: id,
      title: id,
      status,
      archived: false,
      tags: [],
      createdAt: '',
      updatedAt: '',
    },
    project: 'project-a',
    readmeMtime: 0,
    runCount: 0,
    hypothesisCount: 0,
    openWarningCount: 0,
    parseWarnings: [],
    effectiveCreatedAt: '',
    effectiveUpdatedAt: updated,
    displayStatus,
    parseErrors: [],
  }) as ExperimentListRow

describe('Experiment navigation semantics', () => {
  it('never mistakes completed progress, legacy archive, or unavailable metadata for a lifecycle decision', () => {
    expect(experimentGroup(row('E0001', 'ACTIVE', '', 'COMPLETED'))).toBe('ACTIVE')
    const legacy = row('E0002', 'RESOLVED', '')
    expect(experimentGroup(legacy)).toBe('RESOLVED')
    legacy.frontMatter.archived = true
    expect(experimentGroup(legacy)).toBe('LEGACY_ARCHIVED')
    legacy.parseErrors = [{ message: 'invalid status' }]
    expect(experimentGroup(legacy)).toBe('UNKNOWN')
    expect(experimentGroup()).toBe('UNKNOWN')
  })
  it('prioritizes running, compares actual instants across offsets, then uses a deterministic ID tie break', () => {
    const rows = [
      row('E0004', 'ACTIVE', '2026-10-12T20:00:00+08:00'),
      row('E0003', 'ACTIVE', '2026-10-12T13:00:00+00:00'),
      row('E0002', 'ACTIVE', '2026-10-12T13:00:00+00:00'),
      row('E0001', 'ACTIVE', '2026-10-01T00:00:00+00:00', 'RUNNING'),
    ]
    expect(rows.sort(compareExperimentNavigation).map((r) => r.id)).toEqual([
      'E0001',
      'E0002',
      'E0003',
      'E0004',
    ])
  })
})
