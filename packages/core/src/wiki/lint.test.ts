import { describe, expect, it } from 'vitest'

import { parseWikiFrontmatter } from './frontmatter.js'
import {
  extractWikiReferences,
  lintWikiPage,
  lintWikiProject,
  resolvesWikiReference,
  type WikiArtifactInventory,
  type WikiLintPage,
} from './lint.js'

const INVENTORY: WikiArtifactInventory = {
  wikiIds: ['W0001', 'W0002'],
  wikiSlugs: ['zero-snr-brightness', 'edm2-nan-crash'],
  wikiLegacyIds: ['R0009'],
  experimentIds: ['E0002-zero-snr-eval', 'E0017-fused-attention'],
  runIds: ['zero-snr-eval-260902-110000'],
  hypothesisIds: ['H0003'],
  reportIds: ['R0007'],
}

function makePage(
  content: string,
  overrides: Partial<WikiLintPage> = {},
): WikiLintPage {
  const parsed = parseWikiFrontmatter(content)
  return {
    id: 'W0001',
    slug: 'zero-snr-brightness',
    kind: 'finding',
    format: 'markdown',
    path: 'docs/wiki/finding/W0001-zero-snr-brightness.md',
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    bodyLineOffset: parsed.raw === '' ? 0 : parsed.raw.split('\n').length + 2,
    ...overrides,
  }
}

const VALID_FINDING = `---
id: W0001
kind: finding
title: Zero-terminal-SNR removes brightness bias
status: VERIFIED
sources: [E0017-fused-attention]
created_at: "2026-09-01T09:00:00+08:00"
updated_at: "2026-09-02T09:00:00+08:00"
---

# Zero-terminal-SNR removes brightness bias

## Claim

The bias disappears.

## Evidence

Measured in @E0017-fused-attention.

## Limits

Single CFG scale.
`

function codes(diagnostics: { code: string }[]): string[] {
  return diagnostics.map((entry) => entry.code)
}

describe('lintWikiPage', () => {
  it('reports nothing for a complete finding', () => {
    expect(lintWikiPage(makePage(VALID_FINDING), { inventory: INVENTORY })).toEqual([])
  })

  it('reports a malformed id and a prefix/frontmatter mismatch separately', () => {
    const malformed = lintWikiPage(makePage(VALID_FINDING.replace('id: W0001', 'id: W1')))
    expect(codes(malformed)).toContain('WIKI_ID_INVALID')
    expect(codes(malformed)).not.toContain('WIKI_ID_MISMATCH')

    const mismatched = lintWikiPage(makePage(VALID_FINDING.replace('id: W0001', 'id: W0008')))
    expect(codes(mismatched)).toEqual(['WIKI_ID_MISMATCH'])
  })

  it('reports a page whose frontmatter kind disagrees with its directory', () => {
    const diagnostics = lintWikiPage(makePage(VALID_FINDING, { kind: 'note' }))
    expect(codes(diagnostics)).toContain('WIKI_KIND_MISMATCH')
  })

  it('tolerates an unknown kind directory with a warning and no status rules', () => {
    const diagnostics = lintWikiPage(
      makePage(VALID_FINDING.replace('kind: finding', 'kind: retro'), { kind: 'retro' }),
    )
    expect(codes(diagnostics)).toEqual(['WIKI_UNKNOWN_KIND'])
    expect(diagnostics[0]?.severity).toBe('warn')
  })

  it('reports a missing title', () => {
    const diagnostics = lintWikiPage(
      makePage(VALID_FINDING.replace(/^title: .*$/m, 'title: "  "')),
    )
    expect(codes(diagnostics)).toContain('WIKI_TITLE_MISSING')
  })

  it('enforces the per-kind status vocabulary', () => {
    const missing = lintWikiPage(makePage(VALID_FINDING.replace(/^status: .*$/m, 'tags: [x]')))
    expect(codes(missing)).toContain('WIKI_STATUS_MISSING')

    const invalid = lintWikiPage(
      makePage(VALID_FINDING.replace('kind: finding', 'kind: bottleneck'), {
        kind: 'bottleneck',
      }),
    )
    expect(codes(invalid)).toContain('WIKI_STATUS_INVALID')
  })

  it('requires no status for `meeting`, `roadmap`, and `note`', () => {
    const note = `---
id: W0001
kind: note
title: Scratch
created_at: "2026-09-01T09:00:00+08:00"
updated_at: "2026-09-01T09:00:00+08:00"
---

text
`
    expect(lintWikiPage(makePage(note, { kind: 'note' }))).toEqual([])
    const roadmap = note
      .replace('kind: note', 'kind: roadmap')
      .replace('title: Scratch', 'title: Research plan')
    expect(lintWikiPage(makePage(roadmap, { kind: 'roadmap' }))).toEqual([])
  })

  it('requires `date` on a meeting', () => {
    const meeting = `---
id: W0001
kind: meeting
title: Weekly sync
created_at: "2026-09-01T09:00:00+08:00"
updated_at: "2026-09-01T09:00:00+08:00"
---

## Attendees

## Notes

## Decisions

## Action items
`
    expect(codes(lintWikiPage(makePage(meeting, { kind: 'meeting' })))).toContain(
      'WIKI_DATE_MISSING',
    )
    const dated = meeting.replace('title: Weekly sync', 'title: Weekly sync\ndate: 2026-09-01')
    expect(lintWikiPage(makePage(dated, { kind: 'meeting' }))).toEqual([])
  })

  it('requires non-empty `sources` on a finding', () => {
    const diagnostics = lintWikiPage(
      makePage(VALID_FINDING.replace(/^sources: .*$/m, 'sources: []')),
    )
    expect(codes(diagnostics)).toContain('WIKI_SOURCES_REQUIRED')
  })

  it('validates source reference syntax and list member types without target lookup', () => {
    const diagnostics = lintWikiPage(
      makePage(VALID_FINDING.replace(/^sources: .*$/m, 'sources: [invalid/source, 42]')),
    ).filter((entry) => entry.code === 'WIKI_SOURCE_UNRESOLVED')
    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('invalid/source'),
      }),
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('must be strings'),
      }),
    ])
  })

  it('requires ISO8601 timestamps with an explicit offset', () => {
    const diagnostics = lintWikiPage(
      makePage(VALID_FINDING.replace('"2026-09-02T09:00:00+08:00"', '"2026-09-02 09:00"')),
    )
    expect(codes(diagnostics)).toEqual(['WIKI_TIMESTAMP_INVALID'])
  })

  it('warns once per missing recommended section', () => {
    const diagnostics = lintWikiPage(
      makePage(VALID_FINDING.replace('## Limits\n\nSingle CFG scale.\n', '')),
    )
    const missing = diagnostics.filter((entry) => entry.code === 'WIKI_MISSING_SECTION')
    expect(missing).toHaveLength(1)
    expect(missing[0]?.message).toContain('Limits')
    expect(missing[0]?.severity).toBe('warn')
  })

  it('passes unresolved sources through as warnings', () => {
    const diagnostics = lintWikiPage(makePage(VALID_FINDING), {
      unresolvedSources: ['E9999'],
    })
    expect(diagnostics).toEqual([
      {
        code: 'WIKI_SOURCE_UNRESOLVED',
        severity: 'warn',
        message:
          'source "E9999" does not resolve to an Experiment, Variant, Hypothesis, wiki page, or run directory',
      },
    ])
  })

  it('warns when a finding body carries no evidence token', () => {
    const withoutEvidence = VALID_FINDING.replace('Measured in @E0017-fused-attention.', 'Trust me.')
    const diagnostics = lintWikiPage(makePage(withoutEvidence))
    expect(codes(diagnostics)).toEqual(['WIKI_CLAIM_WITHOUT_EVIDENCE'])
    // The same body with a run identifier is fine.
    expect(
      lintWikiPage(makePage(withoutEvidence.replace('Trust me.', 'See zero-snr-eval-260902-110000.'))),
    ).toEqual([])
  })

  it('warns when a VERIFIED finding is not review-verified', () => {
    const review = {
      state: 'CHANGED_SINCE_VERIFY' as const,
      verifiedThrough: 'a'.repeat(40),
      verifiedAt: '2026-09-02T09:00:00+08:00',
      unverifiedCommits: ['b'.repeat(40)],
      unverifiedRanges: [[12, 18] as [number, number]],
      dirty: false,
    }
    expect(codes(lintWikiPage(makePage(VALID_FINDING), { review }))).toEqual([
      'WIKI_UNREVIEWED_VERIFIED',
    ])
    expect(lintWikiPage(makePage(VALID_FINDING), { review: { ...review, state: 'VERIFIED' } })).toEqual(
      [],
    )
  })

  it('warns on an unresolved `@` reference and points at its line', () => {
    const body = VALID_FINDING.replace('Measured in @E0017-fused-attention.', 'Measured in @E0017-fused-attention and @H0007.')
    const diagnostics = lintWikiPage(makePage(body), { inventory: INVENTORY })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.code).toBe('WIKI_LINK_UNRESOLVED')
    expect(diagnostics[0]?.severity).toBe('warn')
    // 1-based line in the file, frontmatter included.
    expect(body.split('\n')[diagnostics[0]!.line! - 1]).toContain('@H0007')
  })

  it('warns only for a known component whose info string omits @version', () => {
    const body = VALID_FINDING.replace(
      'Single CFG scale.',
      ['```memon-data', 'rows: []', '```', '', '```mermaid', 'flowchart LR', '```'].join('\n'),
    )
    const diagnostics = lintWikiPage(makePage(body), {
      componentNames: ['memon-data', 'html-embed'],
    })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.code).toBe('WIKI_COMPONENT_UNPINNED')
    expect(body.split('\n')[diagnostics[0]!.line! - 1]).toBe('```memon-data')
    expect(
      lintWikiPage(makePage(body.replace('```memon-data', '```memon-data@1')), {
        componentNames: ['memon-data'],
      }),
    ).toEqual([])
  })

  it('warns when `superseded_by` names a page that does not exist', () => {
    const body = VALID_FINDING.replace(
      'updated_at: "2026-09-02T09:00:00+08:00"',
      'updated_at: "2026-09-02T09:00:00+08:00"\ndeprecated:\n  at: "2026-09-03T09:00:00+08:00"\n  reason: superseded\n  superseded_by: W0099',
    )
    expect(codes(lintWikiPage(makePage(body), { inventory: INVENTORY }))).toEqual([
      'WIKI_SOURCE_UNRESOLVED',
    ])
  })

  it('degrades to a single error when the frontmatter is unreadable', () => {
    const page = makePage('# no frontmatter\n')
    const diagnostics = lintWikiPage(page)
    expect(codes(diagnostics)).toContain('WIKI_ID_INVALID')
    expect(diagnostics[0]?.line).toBe(1)
  })
})

describe('lintWikiProject', () => {
  it('reports duplicate ids, slugs, and legacy ids on every offending page', () => {
    const first = makePage(VALID_FINDING, { path: 'docs/wiki/finding/W0001-alpha.md', slug: 'alpha' })
    const second = makePage(VALID_FINDING, {
      path: 'docs/wiki/note/W0001-alpha.md',
      kind: 'note',
      slug: 'alpha',
    })
    const withLegacy = (page: WikiLintPage): WikiLintPage => ({
      ...page,
      frontmatter: { ...page.frontmatter!, legacy_id: 'R0007' },
    })
    const diagnostics = lintWikiProject([withLegacy(first), withLegacy(second)])
    expect(new Set(codes(diagnostics))).toEqual(
      new Set(['WIKI_ID_DUPLICATE', 'WIKI_SLUG_DUPLICATE', 'WIKI_LEGACY_ID_DUPLICATE']),
    )
    expect(diagnostics.filter((entry) => entry.code === 'WIKI_ID_DUPLICATE')).toHaveLength(2)
    expect(new Set(diagnostics.map((entry) => entry.path))).toEqual(
      new Set(['docs/wiki/finding/W0001-alpha.md', 'docs/wiki/note/W0001-alpha.md']),
    )
  })

  it('is silent for unique pages', () => {
    const first = makePage(VALID_FINDING)
    const second = makePage(VALID_FINDING.replace('id: W0001', 'id: W0002'), {
      id: 'W0002',
      slug: 'other',
      path: 'docs/wiki/finding/W0002-other.md',
    })
    expect(lintWikiProject([first, second])).toEqual([])
  })
})

describe('extractWikiReferences / resolvesWikiReference', () => {
  it('finds link and bare forms and skips code spans, URLs, and emails', () => {
    const body = [
      '[the finding](@zero-snr-brightness) and see @E0002 for the sweep.',
      'Not references: `@W0001`, mail@example.com, https://x.test/@handle.',
      '```',
      '@W0002',
      '```',
    ].join('\n')
    expect(extractWikiReferences(body)).toEqual([
      { ref: 'zero-snr-brightness', line: 1, linked: true },
      { ref: 'zero-snr-brightness', line: 1, linked: false },
      { ref: 'E0002', line: 1, linked: false },
    ])
  })

  it('keeps the Variant suffix only for the experiment form', () => {
    expect(extractWikiReferences('see @E0017-fused-attention/V0068 and @H0003/H0004')).toEqual([
      { ref: 'E0017-fused-attention/V0068', line: 1, linked: false },
      { ref: 'H0003', line: 1, linked: false },
    ])
  })

  it('resolves every artifact form and rejects a renamed slug', () => {
    for (const ref of [
      'W0001',
      'zero-snr-brightness',
      'E0002',
      'E0002-zero-snr-eval',
      'E0017-fused-attention/V0068',
      'H0003',
      'R0007',
      'R0009',
      'zero-snr-eval-260902-110000',
    ]) {
      expect(resolvesWikiReference(ref, INVENTORY), ref).toBe(true)
    }
    for (const ref of ['W0099', 'old-slug', 'E0099', 'E0002-wrong-slug', 'H0007', 'R0042']) {
      expect(resolvesWikiReference(ref, INVENTORY), ref).toBe(false)
    }
  })
})
