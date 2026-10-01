// @vitest-environment node

import { ProjectRefSchema } from '@memon/core'
import { describe, expect, it } from 'vitest'
import {
  buildArtifactNavigationHref,
  canonicalExperimentHref,
  canonicalFullReportIdFromPathname,
  canonicalReportHref,
  isCanonicalFullReportUrl,
  moveReportWorkspaceUrl,
  parseReportWorkspaceUrl,
  removeReportWorkspaceUrl,
  setReportWorkspaceUrl,
  switchReportWorkspaceUrl,
} from './report-workspace-url'

describe('Report workspace URL state', () => {
  it('parses valid split and drawer deep links', () => {
    expect(
      parseReportWorkspaceUrl('/p/vsqa/e/E0017-vsqa?report=R0007&reportSurface=split'),
    ).toEqual({ reportId: 'R0007', surface: 'split' })
    expect(
      parseReportWorkspaceUrl(
        'https://memon.test/p/vsqa/journal?report=R0003&reportSurface=drawer',
      ),
    ).toEqual({ reportId: 'R0003', surface: 'drawer' })
  })

  it('requires an exact uppercase R plus four digits', () => {
    for (const href of [
      '/p/a/e/E0001?report=r0001&reportSurface=split',
      '/p/a/e/E0001?report=R001&reportSurface=split',
      '/p/a/e/E0001?report=R00001&reportSurface=split',
      '/p/a/e/E0001?report=R0001-extra&reportSurface=split',
    ]) {
      expect(parseReportWorkspaceUrl(href)).toBeNull()
    }
  })

  it('renders no workspace when report is missing, even if a surface remains', () => {
    expect(parseReportWorkspaceUrl('/p/a/e/E0001?run=x&reportSurface=drawer')).toBeNull()
    expect(parseReportWorkspaceUrl('/p/a/e/E0001?run=x')).toBeNull()
  })

  it('defaults a missing or malformed presentation to split', () => {
    expect(parseReportWorkspaceUrl('/p/a/e/E0001?report=R0001')).toEqual({
      reportId: 'R0001',
      surface: 'split',
    })
    expect(parseReportWorkspaceUrl('/p/a/e/E0001?report=R0001&reportSurface=sideways')).toEqual({
      reportId: 'R0001',
      surface: 'split',
    })
  })

  it('sets, switches, moves, and removes only workspace parameters', () => {
    const original = '/p/a/e/E0001-alpha?run=trial%201&filter=hot#L12-L15'
    const opened = setReportWorkspaceUrl(original, 'R0007', 'drawer')
    expect(opened).toBe(
      '/p/a/e/E0001-alpha?run=trial+1&filter=hot&report=R0007&reportSurface=drawer#L12-L15',
    )

    const switched = switchReportWorkspaceUrl(opened, 'R0003')
    expect(switched).toBe(
      '/p/a/e/E0001-alpha?run=trial+1&filter=hot&report=R0003&reportSurface=drawer#L12-L15',
    )

    const moved = moveReportWorkspaceUrl(switched, 'split')
    expect(moved).toBe(
      '/p/a/e/E0001-alpha?run=trial+1&filter=hot&report=R0003&reportSurface=split#L12-L15',
    )

    expect(removeReportWorkspaceUrl(moved)).toBe(
      '/p/a/e/E0001-alpha?run=trial+1&filter=hot#L12-L15',
    )
  })

  it('collapses duplicate workspace keys without disturbing unrelated duplicates', () => {
    const href = setReportWorkspaceUrl(
      '/p/a/journal?tag=one&report=R0001&tag=two&report=R0002&reportSurface=drawer',
      'R0007',
      'split',
    )
    const url = new URL(href, 'http://memon.test')
    expect(url.searchParams.getAll('report')).toEqual(['R0007'])
    expect(url.searchParams.getAll('reportSurface')).toEqual(['split'])
    expect(url.searchParams.getAll('tag')).toEqual(['one', 'two'])
  })

  it('does not move a malformed or absent workspace', () => {
    expect(moveReportWorkspaceUrl('/p/a/e/E0001?report=bad&keep=1#plan', 'drawer')).toBe(
      '/p/a/e/E0001?report=bad&keep=1#plan',
    )
  })

  it('suppresses side state on canonical full-Report detail routes', () => {
    const href = '/p/a/reports/R0003?report=R0007&reportSurface=drawer#findings'
    expect(canonicalFullReportIdFromPathname('/p/a/reports/R0003')).toBe('R0003')
    expect(canonicalFullReportIdFromPathname('/p/a/reports/R0003/')).toBe('R0003')
    expect(isCanonicalFullReportUrl(href)).toBe(true)
    expect(parseReportWorkspaceUrl(href)).toBeNull()

    expect(isCanonicalFullReportUrl('/p/a/reports')).toBe(false)
    expect(isCanonicalFullReportUrl('/p/a/reports/not-a-report')).toBe(false)
    expect(canonicalFullReportIdFromPathname('/h/host-a/p/a/reports/R0003')).toBe('R0003')
  })

  it('round-trips state like a reload or browser-history traversal', () => {
    const first = setReportWorkspaceUrl('/p/a/e/E0017?run=sample', 'R0007', 'split')
    const second = switchReportWorkspaceUrl(first, 'R0003')
    const restoredFirst = parseReportWorkspaceUrl(first)
    const restoredSecond = parseReportWorkspaceUrl(second)

    expect(restoredFirst).toEqual({ reportId: 'R0007', surface: 'split' })
    expect(restoredSecond).toEqual({ reportId: 'R0003', surface: 'split' })
    expect(new URL(first, 'http://memon.test').searchParams.get('run')).toBe('sample')
    expect(new URL(second, 'http://memon.test').searchParams.get('run')).toBe('sample')
  })

  it('rejects invalid state passed by a caller', () => {
    expect(() => setReportWorkspaceUrl('/p/a', 'R12', 'split')).toThrow(TypeError)
  })
})

describe('canonical artifact hrefs', () => {
  it('encodes project names and canonical IDs as path segments', () => {
    expect(canonicalExperimentHref('vision qa', 'E0017-vsqa inference')).toBe(
      '/p/vision%20qa/e/E0017-vsqa%20inference',
    )
    expect(canonicalReportHref('vision qa', 'R0007')).toBe('/p/vision%20qa/reports/R0007')
    const central = ProjectRefSchema.parse({ host: 'host-a', project: 'vision-qa' })
    expect(canonicalExperimentHref(central, 'E0017-vsqa inference')).toBe(
      '/h/host-a/p/vision-qa/e/E0017-vsqa%20inference',
    )
    expect(canonicalReportHref(central, 'R0007')).toBe('/h/host-a/p/vision-qa/reports/R0007')
  })
})

describe('six-cell artifact navigation matrix', () => {
  const project = 'vsqa'

  it('left -> Experiment changes the left document and retains side Report state', () => {
    expect(
      buildArtifactNavigationHref({
        sourceSurface: 'left',
        target: { kind: 'experiment', id: 'E0018-next' },
        project,
        currentHref:
          '/p/vsqa/e/E0017-current?run=old-run&report=R0007&reportSurface=drawer#old-heading',
      }),
    ).toBe('/p/vsqa/e/E0018-next?report=R0007&reportSurface=drawer')
  })

  it('left -> Report replaces only the right side and preserves left URL state', () => {
    expect(
      buildArtifactNavigationHref({
        sourceSurface: 'left',
        target: { kind: 'report', id: 'R0003' },
        project,
        currentHref: '/p/vsqa/e/E0017-current?run=sample&report=R0007&reportSurface=drawer#results',
      }),
    ).toBe('/p/vsqa/e/E0017-current?run=sample&report=R0003&reportSurface=drawer#results')
  })

  it('full Report -> Experiment pairs the source Report beside the Experiment', () => {
    expect(
      buildArtifactNavigationHref({
        sourceSurface: 'full-report',
        target: { kind: 'experiment', id: 'E0017-vsqa-fvfa4-inference' },
        project,
        currentHref: '/p/vsqa/reports/R0003#findings',
      }),
    ).toBe('/p/vsqa/e/E0017-vsqa-fvfa4-inference?report=R0003&reportSurface=split')
  })

  it('full Report -> Report stays in the canonical full-page surface', () => {
    expect(
      buildArtifactNavigationHref({
        sourceSurface: 'full-report',
        target: { kind: 'report', id: 'R0007' },
        project,
        currentHref: '/p/vsqa/reports/R0003',
      }),
    ).toBe('/p/vsqa/reports/R0007')
  })

  it('side Report -> Experiment changes left and retains the source side Report', () => {
    expect(
      buildArtifactNavigationHref({
        sourceSurface: 'side-report',
        target: { kind: 'experiment', id: 'E0018-next' },
        project,
        currentHref: '/p/vsqa/e/E0017-current?run=old&report=R0003&reportSurface=drawer#old',
      }),
    ).toBe('/p/vsqa/e/E0018-next?report=R0003&reportSurface=drawer')
  })

  it('side Report -> Report replaces only the right side', () => {
    expect(
      buildArtifactNavigationHref({
        sourceSurface: 'side-report',
        target: { kind: 'report', id: 'R0007' },
        project,
        currentHref: '/p/vsqa/e/E0017-current?run=sample&report=R0003&reportSurface=split#results',
      }),
    ).toBe('/p/vsqa/e/E0017-current?run=sample&report=R0007&reportSurface=split#results')
  })

  it('accepts explicit source Report identity when the href alone cannot supply it', () => {
    expect(
      buildArtifactNavigationHref({
        sourceSurface: 'full-report',
        sourceReportId: 'R0005',
        target: { kind: 'experiment', id: 'E0017-vsqa' },
        project,
        currentHref: '/rendered-report-preview',
        defaultReportSurface: 'drawer',
      }),
    ).toBe('/p/vsqa/e/E0017-vsqa?report=R0005&reportSurface=drawer')
  })
})
