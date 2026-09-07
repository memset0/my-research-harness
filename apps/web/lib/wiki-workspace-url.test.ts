import { ProjectRefSchema } from '@memon/core'
import { describe, expect, it } from 'vitest'
import {
  buildArtifactNavigationHref,
  parseReportWorkspaceUrl,
  setReportWorkspaceUrl,
} from './report-workspace-url'
import {
  canonicalWikiHref,
  isCanonicalFullWikiUrl,
  moveWikiWorkspaceUrl,
  parseWikiWorkspaceUrl,
  removeWikiWorkspaceUrl,
  setWikiWorkspaceUrl,
  switchWikiWorkspaceUrl,
} from './wiki-workspace-url'

describe('wiki workspace URL state', () => {
  it('parses valid split and drawer deep links', () => {
    expect(parseWikiWorkspaceUrl('/p/project-a/e/E0017-kernels?wiki=W0007&wikiSurface=split')).toEqual(
      { wikiId: 'W0007', surface: 'split' },
    )
    expect(
      parseWikiWorkspaceUrl('https://memon.test/p/project-a/journal?wiki=W0003&wikiSurface=drawer'),
    ).toEqual({ wikiId: 'W0003', surface: 'drawer' })
  })

  it('requires an exact uppercase W plus four digits', () => {
    for (const href of [
      '/p/a/e/E0001?wiki=w0001&wikiSurface=split',
      '/p/a/e/E0001?wiki=W001&wikiSurface=split',
      '/p/a/e/E0001?wiki=W00001&wikiSurface=split',
      '/p/a/e/E0001?wiki=W0001-extra&wikiSurface=split',
      '/p/a/e/E0001?wikiSurface=drawer',
    ]) {
      expect(parseWikiWorkspaceUrl(href)).toBeNull()
    }
  })

  it('falls back to split for an unknown surface', () => {
    expect(parseWikiWorkspaceUrl('/p/a/e/E0001?wiki=W0002&wikiSurface=popup')).toEqual({
      wikiId: 'W0002',
      surface: 'split',
    })
  })

  it('suppresses the side surface on a canonical full-page wiki route', () => {
    expect(isCanonicalFullWikiUrl('/p/project-a/wiki/W0001')).toBe(true)
    expect(isCanonicalFullWikiUrl('/h/host-a/p/project-a/wiki/W0001')).toBe(true)
    expect(isCanonicalFullWikiUrl('/p/project-a/wiki')).toBe(false)
    expect(parseWikiWorkspaceUrl('/p/project-a/wiki/W0001?wiki=W0007&wikiSurface=split')).toBeNull()
  })

  it('switches identity and moves presentation without touching other params', () => {
    const href = '/p/project-a/e/E0017?run=sample&wiki=W0007&wikiSurface=split#notes'
    expect(switchWikiWorkspaceUrl(href, 'W0003')).toBe(
      '/p/project-a/e/E0017?run=sample&wiki=W0003&wikiSurface=split#notes',
    )
    expect(moveWikiWorkspaceUrl(href, 'drawer')).toBe(
      '/p/project-a/e/E0017?run=sample&wiki=W0007&wikiSurface=drawer#notes',
    )
    expect(removeWikiWorkspaceUrl(href)).toBe('/p/project-a/e/E0017?run=sample#notes')
  })

  it('rejects a malformed id at the write boundary', () => {
    expect(() => setWikiWorkspaceUrl('/p/a/e/E0001', 'R0001')).toThrow(TypeError)
    expect(() => canonicalWikiHref('project-a', 'W1')).toThrow(TypeError)
  })
})

describe('report= and wiki= are mutually exclusive', () => {
  it('opening a wiki page removes an active Report from the URL', () => {
    const href = setWikiWorkspaceUrl(
      '/p/project-a/e/E0017?run=sample&report=R0007&reportSurface=drawer',
      'W0004',
      'drawer',
    )
    expect(href).toBe('/p/project-a/e/E0017?run=sample&wiki=W0004&wikiSurface=drawer')
    expect(parseReportWorkspaceUrl(href)).toBeNull()
    expect(parseWikiWorkspaceUrl(href)).toEqual({ wikiId: 'W0004', surface: 'drawer' })
  })

  it('opening a Report removes an active wiki page from the URL', () => {
    const href = setReportWorkspaceUrl(
      '/p/project-a/e/E0017?run=sample&wiki=W0004&wikiSurface=split',
      'R0007',
      'split',
    )
    expect(href).toBe('/p/project-a/e/E0017?run=sample&report=R0007&reportSurface=split')
    expect(parseWikiWorkspaceUrl(href)).toBeNull()
    expect(parseReportWorkspaceUrl(href)).toEqual({ reportId: 'R0007', surface: 'split' })
  })

  it('never yields a URL carrying both identities', () => {
    let href = '/p/project-a/e/E0017'
    for (const step of ['wiki', 'report', 'wiki'] as const) {
      href = step === 'wiki' ? setWikiWorkspaceUrl(href, 'W0004') : setReportWorkspaceUrl(href, 'R0007')
      const search = new URL(href, 'http://memon.invalid').searchParams
      expect([search.has('wiki'), search.has('report')].filter(Boolean)).toHaveLength(1)
    }
  })

  it('gives wiki precedence when a stale URL contains both identities', () => {
    const href =
      '/p/project-a/e/E0017?run=sample&report=R0007&reportSurface=split&wiki=W0004&wikiSurface=drawer'
    expect(parseReportWorkspaceUrl(href)).toBeNull()
    expect(parseWikiWorkspaceUrl(href)).toEqual({ wikiId: 'W0004', surface: 'drawer' })
  })
})

describe('wiki artifact navigation matrix', () => {
  const project = 'project-a'

  it('left document to wiki replaces the shared right slot', () => {
    expect(
      buildArtifactNavigationHref({
        sourceSurface: 'left',
        target: { kind: 'wiki', id: 'W0003' },
        project,
        currentHref: '/p/project-a/e/E0017?run=sample&report=R0007&reportSurface=drawer',
      }),
    ).toBe('/p/project-a/e/E0017?run=sample&wiki=W0003&wikiSurface=drawer')
  })

  it('left document to Experiment preserves the side wiki page', () => {
    expect(
      buildArtifactNavigationHref({
        sourceSurface: 'left',
        target: { kind: 'experiment', id: 'E0018-next' },
        project,
        currentHref: '/p/project-a/e/E0017?run=sample&wiki=W0007&wikiSurface=split',
      }),
    ).toBe('/p/project-a/e/E0018-next?wiki=W0007&wikiSurface=split')
  })

  it('full wiki page to Experiment creates the paired view', () => {
    expect(
      buildArtifactNavigationHref({
        sourceSurface: 'full-wiki',
        target: { kind: 'experiment', id: 'E0017-kernels' },
        project,
        currentHref: '/p/project-a/wiki/W0003',
      }),
    ).toBe('/p/project-a/e/E0017-kernels?wiki=W0003&wikiSurface=split')
  })

  it('full wiki page to wiki page stays a full page', () => {
    expect(
      buildArtifactNavigationHref({
        sourceSurface: 'full-wiki',
        target: { kind: 'wiki', id: 'W0007' },
        project,
        currentHref: '/p/project-a/wiki/W0003',
      }),
    ).toBe('/p/project-a/wiki/W0007')
  })

  it('side wiki page swaps only the addressed side', () => {
    const toExperiment = buildArtifactNavigationHref({
      sourceSurface: 'side-wiki',
      target: { kind: 'experiment', id: 'E0018-next' },
      project,
      currentHref: '/p/project-a/e/E0017?wiki=W0003&wikiSurface=split',
    })
    expect(toExperiment).toBe('/p/project-a/e/E0018-next?wiki=W0003&wikiSurface=split')

    expect(
      buildArtifactNavigationHref({
        sourceSurface: 'side-wiki',
        target: { kind: 'wiki', id: 'W0007' },
        project,
        currentHref: '/p/project-a/e/E0017?wiki=W0003&wikiSurface=split',
      }),
    ).toBe('/p/project-a/e/E0017?wiki=W0007&wikiSurface=split')
  })

  it('side wiki page to Report takes over the shared slot', () => {
    expect(
      buildArtifactNavigationHref({
        sourceSurface: 'side-wiki',
        target: { kind: 'report', id: 'R0007' },
        project,
        currentHref: '/p/project-a/e/E0017?wiki=W0003&wikiSurface=drawer',
      }),
    ).toBe('/p/project-a/e/E0017?report=R0007&reportSurface=drawer')
  })

  it('side Report to wiki page takes over the shared slot', () => {
    expect(
      buildArtifactNavigationHref({
        sourceSurface: 'side-report',
        target: { kind: 'wiki', id: 'W0003' },
        project,
        currentHref: '/p/project-a/e/E0017?report=R0007&reportSurface=drawer',
      }),
    ).toBe('/p/project-a/e/E0017?wiki=W0003&wikiSurface=drawer')
  })

  it('host-qualified projects keep their /h/<host>/ prefix', () => {
    expect(
      buildArtifactNavigationHref({
        sourceSurface: 'full-wiki',
        target: { kind: 'wiki', id: 'W0007' },
        project: ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' }),
        currentHref: '/h/host-a/p/project-a/wiki/W0003',
      }),
    ).toBe('/h/host-a/p/project-a/wiki/W0007')
  })
})
