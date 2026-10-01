// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  type ArtifactInventory,
  resolveArtifactMarkdownHref,
  resolveBareArtifactReference,
} from './artifact-links'

const ROOT = '/srv/vsqa'
const INVENTORY: ArtifactInventory = {
  project: 'vsqa',
  experiments: [
    {
      id: 'E0017-vsqa-fvfa4-inference',
      path: `${ROOT}/docs/experiments/E0017-vsqa-fvfa4-inference/README.md`,
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
      id: 'E0017-vsqa-fvfa4-inference',
    })
    expect(resolveBareArtifactReference('E0017-vsqa-fvfa4-inference', INVENTORY)).toEqual({
      kind: 'experiment',
      id: 'E0017-vsqa-fvfa4-inference',
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
        '../experiments/E0017-vsqa-fvfa4-inference/README.md',
        standaloneReportSource,
        INVENTORY,
      ),
    ).toMatchObject({ kind: 'experiment', id: 'E0017-vsqa-fvfa4-inference' })
    expect(
      resolveArtifactMarkdownHref(
        '../../experiments/E0018-legacy.md',
        bundledReportSource,
        INVENTORY,
      ),
    ).toMatchObject({ kind: 'experiment', id: 'E0018-legacy' })
  })

  it('resolves both wiki page forms and the canonical wiki route', () => {
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
      resolveArtifactMarkdownHref('/p/vsqa/wiki/W0006', experimentSource, INVENTORY),
    ).toMatchObject({ kind: 'wiki', id: 'W0006' })
  })

  it('resolves portable Backend resources without requiring absolute cluster paths', () => {
    const portable: ArtifactInventory = {
      project: 'vsqa',
      host: 'host-a',
      experiments: [
        {
          id: 'E0017-vsqa-fvfa4-inference',
          path: 'docs/experiments/E0017-vsqa-fvfa4-inference/README.md',
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

  it('recognizes canonical current-project web routes', () => {
    expect(
      resolveArtifactMarkdownHref('/p/vsqa/reports/R0007?view=full', experimentSource, INVENTORY),
    ).toMatchObject({ kind: 'report', id: 'R0007' })
    expect(
      resolveArtifactMarkdownHref(
        '/p/vsqa/e/E0017-vsqa-fvfa4-inference#results',
        bundledReportSource,
        INVENTORY,
      ),
    ).toMatchObject({
      kind: 'experiment',
      id: 'E0017-vsqa-fvfa4-inference',
      fragment: '#results',
    })
  })

  it('requires the exact Host on central canonical routes', () => {
    const central: ArtifactInventory = { ...INVENTORY, host: 'host-a' }
    expect(
      resolveArtifactMarkdownHref('/h/host-a/p/vsqa/reports/R0007', experimentSource, central),
    ).toMatchObject({ kind: 'report', id: 'R0007' })
    for (const href of [
      '/h/host-b/p/vsqa/reports/R0007',
      '/h/host-a/p/other/reports/R0007',
      '/p/vsqa/reports/R0007',
    ]) {
      expect(resolveArtifactMarkdownHref(href, experimentSource, central), href).toBeNull()
    }
  })

  it('rejects external, cross-project, malformed, and unresolved paths', () => {
    const hrefs = [
      'https://example.com/R0007.md',
      'file:///srv/vsqa/docs/reports/R0003-summary.md',
      '//example.com/R0007.md',
      '/p/other/reports/R0007',
      '/srv/other/docs/reports/R0003-summary.md',
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
      resolveArtifactMarkdownHref('/p/vsqa/reports/R0007', experimentSource, ambiguous),
    ).toBeNull()
  })
})
