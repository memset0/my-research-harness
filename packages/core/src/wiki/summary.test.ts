import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Experiment } from '../types.js'
import { discoverWikiPages } from './discover.js'
import { parseWikiFrontmatter } from './frontmatter.js'
import {
  buildWikiPage,
  buildWikiProject,
  buildWikiSummary,
  sortWikiSummaries,
  wikiContentHash,
} from './summary.js'
import type { WikiSummary } from './types.js'

function makeExperiment(id: string, updatedAt: string): Experiment {
  return {
    id,
    project: 'project-a',
    path: `/tmp/docs/experiments/${id}/README.md`,
    mtime: 0,
    readmeMtime: 0,
    frontMatter: {
      id,
      slug: id.slice(6),
      title: id,
      status: 'OPEN',
      archived: false,
      runs: [],
      hypotheses: [],
      tags: [],
      createdAt: '2026-08-01T10:00:00+08:00',
      updatedAt,
    },
    sections: {
      motivation: null,
      findings: null,
      limitations: null,
      conclusion: null,
      method: null,
      plan: null,
      caveats: null,
    },
    warnings: [],
    warningsRaw: null,
    body: '',
    parseErrors: [],
    parseWarnings: [],
  }
}

function summary(overrides: Partial<WikiSummary>): WikiSummary {
  return {
    id: 'W0001',
    slug: 'alpha',
    kind: 'note',
    title: 'Alpha',
    description: null,
    status: null,
    date: null,
    tags: [],
    sources: [],
    legacyId: null,
    entry: null,
    deprecated: null,
    deprecatedSections: [],
    stale: false,
    staleSources: [],
    review: null,
    format: 'markdown',
    path: 'docs/wiki/note/W0001-alpha.md',
    mtime: 0,
    createdAt: '2026-09-01T09:00:00+08:00',
    updatedAt: '2026-09-01T09:00:00+08:00',
    diagnostics: [],
    ...overrides,
  }
}

describe('buildWikiSummary', () => {
  it('projects frontmatter, deprecation, and deprecated sections', () => {
    const content = `---
id: W0007
kind: finding
title: Karras-EDM preconditioning is the production baseline
description: Original baseline choice.
status: RETRACTED
sources: [E0001]
tags: [precond]
legacy_id: R0009
created_at: "2026-04-28T10:00:00+08:00"
updated_at: "2026-05-04T10:00:00+08:00"
deprecated:
  at: "2026-05-04T10:00:00+08:00"
  reason: EDM2 is ahead everywhere
  superseded_by: W0006
---

# Karras-EDM

## Old approach

> [!DEPRECATED] since 2026-05-01: replaced by EDM2
`
    const parsed = parseWikiFrontmatter(content)
    const result = buildWikiSummary({
      location: {
        id: 'W0007',
        slug: 'karras-edm-baseline',
        kind: 'finding',
        format: 'markdown',
        path: 'docs/wiki/finding/W0007-karras-edm-baseline.md',
        mtime: 1_700_000_000_000,
      },
      frontmatter: parsed.frontmatter,
      body: parsed.body,
    })
    expect(result).toMatchObject({
      id: 'W0007',
      status: 'RETRACTED',
      legacyId: 'R0009',
      tags: ['precond'],
      sources: ['E0001'],
      deprecatedSections: ['Old approach'],
      stale: false,
      review: null,
      updatedAt: '2026-05-04T10:00:00+08:00',
    })
    expect(result.deprecated?.superseded_by).toBe('W0006')
  })

  it('falls back to the body H1 and the file mtime when frontmatter is unusable', () => {
    const result = buildWikiSummary({
      location: {
        id: 'W0009',
        slug: 'orphan',
        kind: 'note',
        format: 'markdown',
        path: 'docs/wiki/note/W0009-orphan.md',
        mtime: Date.parse('2026-09-04T12:00:00Z'),
      },
      frontmatter: null,
      body: '# Recovered title\n\ntext\n',
    })
    expect(result.id).toBe('W0009')
    expect(result.title).toBe('Recovered title')
    expect(result.createdAt).toBe(result.updatedAt)
    expect(Date.parse(result.updatedAt)).toBe(Date.parse('2026-09-04T12:00:00Z'))
  })
})

describe('buildWikiPage', () => {
  it('adds the content hash used by the optimistic lock', () => {
    const page = buildWikiPage(summary({}), 'body\n')
    expect(page.hash).toBe(wikiContentHash('body\n'))
    expect(page.hash).toMatch(/^[0-9a-f]{40}$/)
    expect(page.components).toEqual([])
  })
})

describe('sortWikiSummaries', () => {
  it('orders by canonical kind, then deprecation, then updated_at descending', () => {
    const ordered = sortWikiSummaries([
      summary({ id: 'W0001', kind: 'note', updatedAt: '2026-09-01T09:00:00+08:00' }),
      summary({ id: 'W0002', kind: 'retro', updatedAt: '2026-09-09T09:00:00+08:00' }),
      summary({ id: 'W0003', kind: 'meeting', updatedAt: '2026-09-02T09:00:00+08:00' }),
      summary({
        id: 'W0004',
        kind: 'finding',
        updatedAt: '2026-09-08T09:00:00+08:00',
        deprecated: { at: '2026-09-08T09:00:00+08:00', reason: 'superseded' },
      }),
      summary({ id: 'W0005', kind: 'finding', updatedAt: '2026-09-03T09:00:00+08:00' }),
      summary({ id: 'W0006', kind: 'alpha-retro', updatedAt: '2026-09-01T09:00:00+08:00' }),
    ])
    expect(ordered.map((entry) => entry.id)).toEqual([
      'W0003', // meeting
      'W0005', // finding, not deprecated
      'W0004', // finding, deprecated last within its kind despite a newer date
      'W0001', // note
      'W0006', // unknown kinds last, alphabetically
      'W0002',
    ])
  })
})

describe('buildWikiProject', () => {
  let root: string

  async function write(relative: string, content: string): Promise<void> {
    const target = path.join(root, relative)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf8')
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'memon-wiki-project-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('parses, resolves, lints, and orders a whole project', async () => {
    await write(
      'docs/wiki/finding/W0001-zero-snr-brightness.md',
      `---
id: W0001
kind: finding
title: Zero-terminal-SNR removes brightness bias
status: TENTATIVE
sources: [E0017, E9999]
created_at: "2026-09-01T09:00:00+08:00"
updated_at: "2026-09-01T10:00:00+08:00"
---

# Zero-terminal-SNR removes brightness bias

## Claim

Measured in @E0017-fused-attention, cross-checked against @W0002 and @H0007.

## Evidence

See E0017.

## Limits

One CFG scale.
`,
    )
    await write(
      'docs/wiki/note/W0002-scratch.md',
      `---
id: W0002
kind: note
title: Scratch
created_at: "2026-09-02T09:00:00+08:00"
updated_at: "2026-09-02T09:00:00+08:00"
---

Notes.
`,
    )

    const pages = await discoverWikiPages(root)
    const projection = buildWikiProject(pages, {
      experiments: [makeExperiment('E0017-fused-attention', '2026-09-03T09:00:00+08:00')],
      runs: [],
      hypothesesMtime: Date.parse('2026-08-15T09:00:00+08:00'),
      hypothesisIds: ['H0003'],
    })

    expect(projection.summaries.map((entry) => entry.id)).toEqual(['W0001', 'W0002'])
    const finding = projection.byId.get('W0001')!
    expect(finding.stale).toBe(true)
    expect(finding.staleSources).toEqual(['E0017'])
    expect(finding.diagnostics.map((entry) => entry.code).sort()).toEqual([
      'WIKI_LINK_UNRESOLVED',
      'WIKI_SOURCE_UNRESOLVED',
    ])
    const unresolvedLink = finding.diagnostics.find(
      (entry) => entry.code === 'WIKI_LINK_UNRESOLVED',
    )!
    // Line numbers address the file, frontmatter included.
    const fileLines = pages[0]!.content.split('\n')
    expect(fileLines[unresolvedLink.line! - 1]).toContain('@H0007')
    expect(projection.bySlug.get('scratch')?.id).toBe('W0002')
    expect(projection.backlinks.get('E0017')).toEqual([
      {
        id: 'W0001',
        slug: 'zero-snr-brightness',
        kind: 'finding',
        title: 'Zero-terminal-SNR removes brightness bias',
        status: 'TENTATIVE',
        stale: true,
        deprecated: false,
        reviewState: null,
        updatedAt: '2026-09-01T10:00:00+08:00',
      },
    ])
  })

  it('merges project-level duplicate diagnostics into each page', async () => {
    const body = (id: string) => `---
id: ${id}
kind: note
title: Alpha
created_at: "2026-09-01T09:00:00+08:00"
updated_at: "2026-09-01T09:00:00+08:00"
---

text
`
    await write('docs/wiki/note/W0006-alpha.md', body('W0006'))
    await write('docs/wiki/decision/W0007-alpha.md', body('W0007').replace('kind: note', 'kind: decision\nstatus: ACCEPTED'))

    const projection = buildWikiProject(await discoverWikiPages(root), {
      experiments: [],
      runs: [],
      hypothesesMtime: null,
    })
    for (const page of projection.summaries) {
      expect(page.diagnostics.map((entry) => entry.code)).toContain('WIKI_SLUG_DUPLICATE')
    }
  })
})
