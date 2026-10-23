// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  type ArtifactInventory,
  resolveArtifactMarkdownHref,
  resolveBareArtifactReference,
} from './artifact-links'

const ROOT = '/srv/project-a'
const INVENTORY: ArtifactInventory = {
  project: 'project-a',
  experiments: [
    {
      id: 'E0017-inference-kernels',
      path: `${ROOT}/docs/experiments/E0017-inference-kernels/README.md`,
    },
    {
      id: 'E0018-legacy',
      path: `${ROOT}/docs/experiments/E0018-legacy.md`,
    },
  ],
  reports: [
    { id: 'R0003', path: `${ROOT}/docs/reports/R0003-summary.md` },
    { id: 'R0005', path: `${ROOT}/docs/reports/R0005-learning-guide/README.md` },
    { id: 'R0007', path: `${ROOT}/docs/reports/R0007-inference-kernel-learning-guide/README.md` },
  ],
  wiki: [
    { id: 'W0001', path: `${ROOT}/docs/wiki/finding/W0001-zero-snr.md`, legacyId: null },
    {
      id: 'W0006',
      path: `${ROOT}/docs/wiki/showcase/W0006-precond-explorer/README.md`,
      legacyId: null,
    },
    { id: 'W0021', path: `${ROOT}/docs/wiki/note/W0021-migrated.md`, legacyId: 'R0009' },
  ],
}

describe('resolveBareArtifactReference', () => {
  it('resolves a unique Report, short Experiment, and full Experiment identity', () => {
    expect(resolveBareArtifactReference('R0007', INVENTORY)).toEqual({
      kind: 'report',
      id: 'R0007',
    })
    expect(resolveBareArtifactReference('E0017', INVENTORY)).toEqual({
      kind: 'experiment',
      id: 'E0017-inference-kernels',
    })
    expect(resolveBareArtifactReference('E0017-inference-kernels', INVENTORY)).toEqual({
      kind: 'experiment',
      id: 'E0017-inference-kernels',
    })
  })

  it('leaves malformed, missing, and ambiguous references unresolved', () => {
    const ambiguous: ArtifactInventory = {
      ...INVENTORY,
      experiments: [
        ...INVENTORY.experiments,
        { id: 'E0017-second-copy', path: `${ROOT}/docs/experiments/E0017-second-copy/README.md` },
      ],
    }
    expect(resolveBareArtifactReference('R9999', INVENTORY)).toBeNull()
    expect(resolveBareArtifactReference('r0007', INVENTORY)).toBeNull()
    expect(resolveBareArtifactReference('E0017', ambiguous)).toBeNull()
  })

  it('resolves wiki page ids and both legacy Report cases', () => {
    expect(resolveBareArtifactReference('W0001', INVENTORY)).toEqual({
      kind: 'wiki',
      id: 'W0001',
    })
    // A live Report keeps its token even when a page claims it as legacy_id.
    const stillReported: ArtifactInventory = {
      ...INVENTORY,
      reports: [...INVENTORY.reports, { id: 'R0009', path: `${ROOT}/docs/reports/R0009-old.md` }],
    }
    expect(resolveBareArtifactReference('R0009', stillReported)).toEqual({
      kind: 'report',
      id: 'R0009',
    })
    // Report gone: the page that inherited the id takes over.
    expect(resolveBareArtifactReference('R0009', INVENTORY)).toEqual({
      kind: 'wiki',
      id: 'W0021',
    })
    // Neither exists — the token stays plain text.
    expect(resolveBareArtifactReference('R0042', INVENTORY)).toBeNull()
    expect(resolveBareArtifactReference('W9999', INVENTORY)).toBeNull()
  })

  it('refuses an ambiguous legacy_id (WIKI_LEGACY_ID_DUPLICATE territory)', () => {
    const duplicated: ArtifactInventory = {
      ...INVENTORY,
      wiki: [
        ...INVENTORY.wiki!,
        { id: 'W0022', path: `${ROOT}/docs/wiki/note/W0022-other.md`, legacyId: 'R0009' },
      ],
    }
    expect(resolveBareArtifactReference('R0009', duplicated)).toBeNull()
  })
})

describe('resolveArtifactMarkdownHref', () => {
  const experimentSource = INVENTORY.experiments[0]!.path
  const standaloneReportSource = INVENTORY.reports[0]!.path
  const bundledReportSource = INVENTORY.reports[2]!.path

  it('resolves standalone and bundled Reports relative to an Experiment README', () => {
    expect(
      resolveArtifactMarkdownHref('../../reports/R0003-summary.md', experimentSource, INVENTORY),
    ).toMatchObject({ kind: 'report', id: 'R0003' })
    expect(
      resolveArtifactMarkdownHref(
        '../../reports/R0007-inference-kernel-learning-guide/README.md',
        experimentSource,
        INVENTORY,
      ),
    ).toMatchObject({ kind: 'report', id: 'R0007' })
  })

  it('keeps legacy Report paths working before and after migration', () => {
    const migratedPath = '../../reports/R0009-retired-guide.md'
    expect(resolveArtifactMarkdownHref(migratedPath, experimentSource, INVENTORY)).toMatchObject({
      kind: 'wiki',
      id: 'W0021',
    })

    const stillReported: ArtifactInventory = {
      ...INVENTORY,
      reports: [
        ...INVENTORY.reports,
        { id: 'R0009', path: `${ROOT}/docs/reports/R0009-current-guide.md` },
      ],
    }
    expect(
      resolveArtifactMarkdownHref(migratedPath, experimentSource, stillReported),
    ).toMatchObject({
      kind: 'report',
      id: 'R0009',
    })
  })

  it('resolves bundled and legacy Experiments from standalone and bundled Reports', () => {
    expect(
      resolveArtifactMarkdownHref(
        '../experiments/E0017-inference-kernels/README.md',
        standaloneReportSource,
        INVENTORY,
      ),
    ).toMatchObject({ kind: 'experiment', id: 'E0017-inference-kernels' })
    expect(
      resolveArtifactMarkdownHref(
        '../../experiments/E0018-legacy.md',
        bundledReportSource,
        INVENTORY,
      ),
    ).toMatchObject({ kind: 'experiment', id: 'E0018-legacy' })
  })

  it('resolves both wiki page forms and the hostless wiki route', () => {
    expect(
      resolveArtifactMarkdownHref(
        '../../wiki/finding/W0001-zero-snr.md',
        experimentSource,
        INVENTORY,
      ),
    ).toMatchObject({ kind: 'wiki', id: 'W0001' })
    expect(
      resolveArtifactMarkdownHref(
        '../../wiki/showcase/W0006-precond-explorer/README.md',
        experimentSource,
        INVENTORY,
      ),
    ).toMatchObject({ kind: 'wiki', id: 'W0006' })
    expect(
      resolveArtifactMarkdownHref('/p/project-a/wiki/W0006', experimentSource, INVENTORY),
    ).toMatchObject({ kind: 'wiki', id: 'W0006' })
  })

  it('resolves portable Backend resources without requiring absolute cluster paths', () => {
    const portable: ArtifactInventory = {
      project: 'project-a',
      host: 'host-a',
      experiments: [
        {
          id: 'E0017-inference-kernels',
          path: 'docs/experiments/E0017-inference-kernels/README.md',
        },
      ],
      reports: [{ id: 'R0003', path: 'docs/reports/R0003-summary.md' }],
    }
    expect(
      resolveArtifactMarkdownHref(
        '../../reports/R0003-summary.md',
        portable.experiments[0]!.path,
        portable,
      ),
    ).toMatchObject({ kind: 'report', id: 'R0003' })
  })

  it('resolves exact absolute paths, encoded paths, query strings, and fragments', () => {
    const spaced: ArtifactInventory = {
      ...INVENTORY,
      reports: [
        ...INVENTORY.reports,
        { id: 'R0008', path: `${ROOT}/docs/reports/R0008-space name.md` },
      ],
    }
    expect(
      resolveArtifactMarkdownHref(INVENTORY.reports[1]!.path, experimentSource, INVENTORY),
    ).toMatchObject({ kind: 'report', id: 'R0005' })
    expect(
      resolveArtifactMarkdownHref(
        '../../reports/R0008-space%20name.md?plain=1#findings',
        experimentSource,
        spaced,
      ),
    ).toMatchObject({ kind: 'report', id: 'R0008', fragment: '#findings' })
  })

  it('recognizes hostless current-project web routes', () => {
    expect(
      resolveArtifactMarkdownHref(
        '/p/project-a/reports/R0007?view=full',
        experimentSource,
        INVENTORY,
      ),
    ).toMatchObject({ kind: 'report', id: 'R0007' })
    expect(
      resolveArtifactMarkdownHref(
        '/p/project-a/e/E0017-inference-kernels#results',
        bundledReportSource,
        INVENTORY,
      ),
    ).toMatchObject({
      kind: 'experiment',
      id: 'E0017-inference-kernels',
      fragment: '#results',
    })
  })

  it('resolves canonical, legacy Host-qualified, and hostless routes on a central Project', () => {
    const central: ArtifactInventory = { ...INVENTORY, host: 'host-a' }
    expect(
      resolveArtifactMarkdownHref('/host-a/project-a/r/7?view=full', experimentSource, central),
    ).toMatchObject({ kind: 'report', id: 'R0007' })
    expect(
      resolveArtifactMarkdownHref('/host-a/project-a/e/17#results', bundledReportSource, central),
    ).toMatchObject({ kind: 'experiment', id: 'E0017-inference-kernels', fragment: '#results' })
    expect(
      resolveArtifactMarkdownHref('/host-a/project-a/w/6', experimentSource, central),
    ).toMatchObject({ kind: 'wiki', id: 'W0006' })
    expect(
      resolveArtifactMarkdownHref('/h/host-a/p/project-a/reports/R0007', experimentSource, central),
    ).toMatchObject({ kind: 'report', id: 'R0007' })
    expect(
      resolveArtifactMarkdownHref(
        '/h/host-a/p/project-a/e/E0017-inference-kernels',
        experimentSource,
        central,
      ),
    ).toMatchObject({ kind: 'experiment', id: 'E0017-inference-kernels' })
    expect(
      resolveArtifactMarkdownHref('/h/host-a/p/project-a/wiki/W0001', experimentSource, central),
    ).toMatchObject({ kind: 'wiki', id: 'W0001' })
    // A hostless link resolves within the document's own Host.
    expect(
      resolveArtifactMarkdownHref('/p/project-a/reports/R0007', experimentSource, central),
    ).toMatchObject({ kind: 'report', id: 'R0007' })
  })

  it('requires the exact Host and Project on canonical and legacy Host-qualified routes', () => {
    const central: ArtifactInventory = { ...INVENTORY, host: 'host-a' }
    for (const href of [
      '/host-b/project-a/r/7',
      '/host-a/project-b/r/7',
      '/host-a/project-a/r/99',
      '/host-a/project-a/reports',
      '/h/host-b/p/project-a/reports/R0007',
      '/h/host-a/p/project-b/reports/R0007',
      '/p/project-b/reports/R0007',
    ]) {
      expect(resolveArtifactMarkdownHref(href, experimentSource, central), href).toBeNull()
    }
    // Without a known Host, no Host-qualified route can name this Project.
    for (const href of ['/host-a/project-a/r/7', '/h/host-a/p/project-a/reports/R0007']) {
      expect(resolveArtifactMarkdownHref(href, experimentSource, INVENTORY), href).toBeNull()
    }
  })

  it('rejects external, cross-project, malformed, and unresolved paths', () => {
    const hrefs = [
      'https://example.com/R0007.md',
      'file:///srv/project-a/docs/reports/R0003-summary.md',
      '//example.com/R0007.md',
      '/p/project-b/reports/R0007',
      '/srv/project-b/docs/reports/R0003-summary.md',
      '../../reports/notes.md',
      '../../reports/%ZZ.md',
      '../../reports/%2Fetc.md',
    ]
    for (const href of hrefs) {
      expect(resolveArtifactMarkdownHref(href, experimentSource, INVENTORY), href).toBeNull()
    }
  })

  it('does not route an exact path when its route identity is ambiguous', () => {
    const ambiguous: ArtifactInventory = {
      ...INVENTORY,
      reports: [
        ...INVENTORY.reports,
        { id: 'R0007', path: `${ROOT}/docs/reports/R0007-migration-leftover.md` },
      ],
    }
    expect(
      resolveArtifactMarkdownHref(
        '../../reports/R0007-inference-kernel-learning-guide/README.md',
        experimentSource,
        ambiguous,
      ),
    ).toBeNull()
    expect(
      resolveArtifactMarkdownHref('/p/project-a/reports/R0007', experimentSource, ambiguous),
    ).toBeNull()
  })
})
