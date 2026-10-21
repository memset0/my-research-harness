import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BackendWikiConflictResponseSchema,
  BackendWikiDocumentSchema,
  BackendWikiInventoryResponseSchema,
  BackendWikiPagesResponseSchema,
  BackendWikiWriteResponseSchema,
  getFileOperationMetrics,
  type ProjectConfig,
  parseWikiFrontmatter,
  withProjectFileContext,
} from '@memon/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type BackendDocumentServiceError, FilesystemDocumentService } from './document-service.js'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFile: vi.fn(actual.execFile) }
})

const EXPERIMENT = `---
id: E0001-alpha
slug: alpha
title: "Alpha experiment"
status: OPEN
archived: false
runs: []
hypotheses: []
tags: []
created_at: 2026-09-01T09:00:00+08:00
updated_at: 2026-09-05T09:00:00+08:00
---

## Motivation

Alpha.
`

const FINDING = `---
id: W0001
kind: finding
title: Alpha holds
description: Alpha holds under E0001.
status: TENTATIVE
sources: [E0001-alpha]
tags: [alpha]
created_at: 2026-09-01T10:00:00+08:00
updated_at: 2026-09-02T10:00:00+08:00
owner: alice
---

## Claim

Alpha holds.

## Evidence

E0001-alpha measured it.

## Limits

One seed only.
`

const NOTE = `---
id: W0002
kind: note
title: Beta note
created_at: 2026-09-03T10:00:00+08:00
updated_at: 2026-09-04T10:00:00+08:00
---

## Notes

See W0001.
`

const SHOWCASE = `---
id: W0003
kind: showcase
title: Gamma showcase
status: DRAFT
created_at: 2026-09-01T10:00:00+08:00
updated_at: 2026-09-01T10:00:00+08:00
---

## What to show

![Map](./views/map/index.html)

## How to reproduce

Open the view.

## Assets

views/map/index.html
`

let root = ''
let service: FilesystemDocumentService

// These fixtures are this host's own files, so git may run here: a Project
// says so explicitly, exactly as a deployed single-host Project does.
const project = () =>
  ({
    name: 'research',
    root,
    include: [],
    exclude: [],
    execution: { kind: 'local' },
  }) satisfies ProjectConfig

async function writeWikiFixtures(target: string): Promise<void> {
  await Promise.all([
    fs.mkdir(join(target, 'docs', 'wiki', 'finding'), { recursive: true }),
    fs.mkdir(join(target, 'docs', 'wiki', 'note'), { recursive: true }),
    fs.mkdir(join(target, 'docs', 'wiki', 'showcase', 'W0003-gamma', 'views', 'map'), {
      recursive: true,
    }),
    fs.mkdir(join(target, 'docs', 'experiments', 'E0001-alpha'), { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(join(target, 'docs', 'wiki', 'finding', 'W0001-alpha.md'), FINDING),
    fs.writeFile(join(target, 'docs', 'wiki', 'note', 'W0002-beta.md'), NOTE),
    fs.writeFile(join(target, 'docs', 'wiki', 'showcase', 'W0003-gamma', 'README.md'), SHOWCASE),
    fs.writeFile(
      join(target, 'docs', 'wiki', 'showcase', 'W0003-gamma', 'views', 'map', 'index.html'),
      '<p>map</p>\n',
    ),
    fs.writeFile(join(target, 'docs', 'experiments', 'E0001-alpha', 'README.md'), EXPERIMENT),
  ])
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-backend-wiki-'))
  await writeWikiFixtures(root)
  service = new FilesystemDocumentService([project()])
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('FilesystemDocumentService wiki reads', () => {
  it('reads and writes Wiki content without Git or the historical review ledger', async () => {
    await fs.mkdir(join(root, '.memon'), { recursive: true })
    const ledger = join(root, '.memon', 'wiki-review.csv')
    await fs.symlink('wiki-review.csv', ledger)
    await fs.symlink('.git', join(root, '.git'))
    vi.mocked(execFile).mockClear()
    const listed = BackendWikiPagesResponseSchema.parse(await service.listWiki('research'))
    expect(listed.pages).toHaveLength(3)
    expect(listed.pages.every((page) => !('review' in page))).toBe(true)
    const page = BackendWikiDocumentSchema.parse(await service.getWiki('research', 'W0001'))
    const result = BackendWikiWriteResponseSchema.parse(
      await service.putWiki('research', 'W0001', {
        content: page.content.replace('owner: alice', 'owner: alice\nreviewed_hash: legacy'),
        expectedMtime: page.mtime,
        expectedHash: page.hash,
      }),
    )
    expect(result.page.content).toContain('reviewed_hash: legacy')
    expect(result.page.diagnostics.map((item) => item.code)).not.toContain(
      'WIKI_UNREVIEWED_VERIFIED',
    )
    expect(await service.wikiBacklinks('research', 'E0001-alpha')).toHaveLength(1)
    expect(execFile).not.toHaveBeenCalled()
    expect(await fs.readlink(ledger)).toBe('wiki-review.csv')
  })

  it('builds navigation identities without reading source targets or resolving staleness', async () => {
    await fs.writeFile(
      join(root, 'docs', 'wiki', 'finding', 'W0001-alpha.md'),
      FINDING.replace('kind: finding', 'kind: finding\nlegacy_id: R0042'),
    )
    const inventory = BackendWikiInventoryResponseSchema.parse(
      await service.listWiki('research', { inventoryOnly: true }),
    )
    expect(inventory.pages[0]).toEqual({
      id: 'W0001',
      resource: 'docs/wiki/finding/W0001-alpha.md',
      legacyId: 'R0042',
    })
  })

  it('lists and serves pages without reading an uncited Run', async () => {
    // An unreadable README no page cites: reading it would fail the request,
    // so a successful list is proof the Run was never opened. Its directory
    // name still comes from the walk, so an `@` mention of it resolves.
    const uncited = 'unrelated-260901-010203'
    await fs.mkdir(join(root, 'logs', uncited), { recursive: true })
    await fs.symlink('README.md', join(root, 'logs', uncited, 'README.md'))
    await fs.writeFile(
      join(root, 'docs', 'wiki', 'note', 'W0002-beta.md'),
      NOTE.replace('See W0001.', `See W0001, @${uncited} and @E0001-alpha.`),
    )

    const listed = BackendWikiPagesResponseSchema.parse(await service.listWiki('research'))
    const note = listed.pages.find((page) => page.id === 'W0002')!
    expect(note.diagnostics.filter((entry) => entry.code === 'WIKI_LINK_UNRESOLVED')).toEqual([])
    // The cited Experiment is still resolved, so staleness stays real.
    expect(listed.pages.find((page) => page.id === 'W0001')).toMatchObject({
      stale: true,
      staleSources: ['E0001-alpha'],
    })
    const page = BackendWikiDocumentSchema.parse(await service.getWiki('research', 'W0002'))
    expect(page.id).toBe('W0002')
  })

  it('shares one Run walk between a page and the list requested together, then reuses it', async () => {
    let walks = 0
    const counted = new FilesystemDocumentService([project()], {
      runWalk: async () => {
        walks += 1
        await new Promise((resolve) => setTimeout(resolve, 20))
        return []
      },
    })
    const [page, listed] = await Promise.all([
      counted.getWiki('research', 'W0001'),
      counted.listWiki('research'),
    ])
    expect(BackendWikiDocumentSchema.parse(page).id).toBe('W0001')
    expect(BackendWikiPagesResponseSchema.parse(listed).pages).toHaveLength(3)
    expect(walks).toBe(1)

    await counted.getWiki('research', 'W0002')
    expect(walks).toBe(1)
  })

  it('lists pages whose sources cite an ambiguous Run base name instead of failing', async () => {
    // Two Run directories share one base name; a citation by that name is
    // simply unresolved (the Web reports it), never an exception that turns
    // the whole listing into a 500.
    const shared = 'dup-260901-010203'
    for (const root_ of ['logs', 'outputs']) {
      await fs.mkdir(join(root, root_, shared), { recursive: true })
      await fs.writeFile(
        join(root, root_, shared, 'README.md'),
        '---\nid: dup-260901-010203\n---\n\n## Setup\n\ns\n\n## Result\n\nr\n\n## Artifacts\n\n- a\n',
      )
    }
    await fs.writeFile(
      join(root, 'docs', 'wiki', 'note', 'W0002-beta.md'),
      NOTE.replace(
        'updated_at: 2026-09-04T10:00:00+08:00',
        `updated_at: 2026-09-04T10:00:00+08:00\nsources: [${shared}]`,
      ),
    )
    const listed = BackendWikiPagesResponseSchema.parse(await service.listWiki('research'))
    const note = listed.pages.find((page) => page.id === 'W0002')!
    expect(note.stale).toBe(false)
    expect(note.diagnostics.map((entry) => entry.code)).toContain('WIKI_SOURCE_UNRESOLVED')
  })

  it('resolves path-qualified citations of same-basename Runs independently', async () => {
    const shared = 'dup-260901-010203'
    for (const root_ of ['logs', 'outputs']) {
      await fs.mkdir(join(root, root_, shared), { recursive: true })
      await fs.writeFile(
        join(root, root_, shared, 'README.md'),
        `---\nid: ${shared}\nstatus: FINISHED\ncreated_at: '2026-09-01T10:00:00+08:00'\n---\n`,
      )
    }
    await fs.writeFile(
      join(root, 'docs', 'wiki', 'note', 'W0002-beta.md'),
      NOTE.replace(
        'updated_at: 2026-09-04T10:00:00+08:00',
        `updated_at: 2026-09-04T10:00:00+08:00\nsources: [logs/${shared}, outputs/${shared}]`,
      ),
    )
    const listed = BackendWikiPagesResponseSchema.parse(await service.listWiki('research'))
    const note = listed.pages.find((page) => page.id === 'W0002')!
    expect(note.diagnostics.map((entry) => entry.code)).not.toContain('WIKI_SOURCE_UNRESOLVED')
  })

  it('reads the Results document only for Experiments cited with a Variant', async () => {
    await fs.writeFile(
      join(root, 'docs', 'experiments', 'E0001-alpha', 'experiment.json'),
      `${JSON.stringify({
        experiment_schema_version: 1,
        groups: {},
        columns: [],
        variants: [{ id: 'V0001', name: 'A', runs: [] }],
      })}\n`,
    )
    const cite = async (source: string) => {
      await fs.writeFile(
        join(root, 'docs', 'wiki', 'note', 'W0002-beta.md'),
        NOTE.replace(
          'updated_at: 2026-09-04T10:00:00+08:00',
          `updated_at: 2026-09-04T10:00:00+08:00\nsources: [${source}]`,
        ),
      )
      const listed = BackendWikiPagesResponseSchema.parse(await service.listWiki('research'))
      return listed.pages
        .find((page) => page.id === 'W0002')!
        .diagnostics.map((entry) => entry.code)
    }
    expect(await cite('E0001-alpha/V0001')).not.toContain('WIKI_SOURCE_UNRESOLVED')
    expect(await cite('E0001-alpha/V0002')).toContain('WIKI_SOURCE_UNRESOLVED')
    expect(await cite('E0001-alpha')).not.toContain('WIKI_SOURCE_UNRESOLVED')
  })

  it('refreshes Wiki metadata and selected body together on a manual request', async () => {
    const storageGroup = `wiki-detail-${root}`
    const context = { root, storageGroup, persistentCache: true, attentionId: 'wiki-tab' }
    await withProjectFileContext({ ...context, reason: 'automatic' }, () =>
      service.getWiki('research', 'W0002'),
    )
    await fs.writeFile(
      join(root, 'docs', 'wiki', 'note', 'W0002-beta.md'),
      NOTE.replace('title: Beta note', 'title: Changed inventory title').replace(
        'See W0001.',
        'Changed selected body.',
      ),
    )
    const before = getFileOperationMetrics()
    const page = BackendWikiDocumentSchema.parse(
      await withProjectFileContext({ ...context, reason: 'manual' }, () =>
        service.getWiki('research', 'W0002'),
      ),
    )
    await expect
      .poll(async () => {
        const refreshed = BackendWikiDocumentSchema.parse(
          await withProjectFileContext({ ...context, reason: 'automatic' }, () =>
            service.getWiki('research', 'W0002'),
          ),
        )
        return refreshed.content
      })
      .toContain('Changed selected body.')
    const after = getFileOperationMetrics()
    const counters = (origin: 'human' | 'automatic', metrics = after) =>
      metrics.series
        .filter((series) => series.storageGroup === storageGroup && series.origin === origin)
        .reduce(
          (total, series) => ({
            samples: total.samples + series.samples,
            cacheHits: total.cacheHits + series.cacheHits,
          }),
          { samples: 0, cacheHits: 0 },
        )

    // Manual refresh returns current metadata and body together.
    expect(page.title).toBe('Changed inventory title')
    expect(counters('human').samples).toBeGreaterThan(counters('human', before).samples)
  })

  it('resolves member evidence without archive-sidecar policy reads', async () => {
    const runId = 'cited-260906-010203'
    const runDir = join(root, 'logs', runId)
    await fs.mkdir(runDir, { recursive: true })
    await fs.writeFile(
      join(runDir, 'README.md'),
      `---
id: ${runId}
name: cited member
entry: script.py
command: python script.py
status: FINISHED
archived: false
experiment: E0001-alpha
updated_at: 2026-09-06T01:02:03+00:00
---
evidence
`,
    )
    await fs.symlink('.archived', join(runDir, '.archived'))
    await fs.writeFile(
      join(root, 'docs', 'experiments', 'E0001-alpha', 'README.md'),
      EXPERIMENT.replace('runs: []', `runs: [${runId}]`),
    )
    await fs.writeFile(
      join(root, 'docs', 'wiki', 'finding', 'W0001-alpha.md'),
      FINDING.replace('2026-09-02T10:00:00+08:00', '2026-09-05T12:00:00+08:00'),
    )
    const listed = BackendWikiPagesResponseSchema.parse(await service.listWiki('research'))
    expect(listed.pages.find((page) => page.id === 'W0001')).toMatchObject({
      stale: true,
      staleSources: ['E0001-alpha'],
    })
  })

  it('lists pages in canonical order with staleness and no review claims or cluster paths', async () => {
    const listed = BackendWikiPagesResponseSchema.parse(await service.listWiki('research'))
    expect(listed.pages.map((page) => page.id)).toEqual(['W0001', 'W0003', 'W0002'])
    const finding = listed.pages[0]!
    expect(finding.resource).toBe('docs/wiki/finding/W0001-alpha.md')
    expect(finding.format).toBe('markdown')
    expect(listed.pages[1]?.format).toBe('bundle')
    // E0001-alpha's effective updated time (2026-09-05) is newer than the
    // page's updated_at (2026-09-02).
    expect(finding.stale).toBe(true)
    expect(finding.staleSources).toEqual(['E0001-alpha'])
    // Wiki responses no longer carry human-review state.
    expect(listed.pages.every((page) => !('review' in page))).toBe(true)
    expect(JSON.stringify(listed)).not.toContain(root)
  })

  it('serves one page with content and hash, and refuses non-W identifiers', async () => {
    const page = BackendWikiDocumentSchema.parse(await service.getWiki('research', 'W0001'))
    expect(page.content).toBe(FINDING)
    expect(page.hash).toMatch(/^[a-f0-9]{40}$/)
    expect(page.title).toBe('Alpha holds')

    const invalid = await service
      .getWiki('research', 'R0001')
      .catch((error: BackendDocumentServiceError) => error)
    expect((invalid as BackendDocumentServiceError).code).toBe('INVALID_RESOURCE')
    const missing = await service
      .getWiki('research', 'W9999')
      .catch((error: BackendDocumentServiceError) => error)
    expect((missing as BackendDocumentServiceError).code).toBe('RESOURCE_NOT_FOUND')
  })

  it('reports the pages citing an Experiment newest first', async () => {
    expect(await service.wikiBacklinks('research', 'E0001-alpha')).toEqual([
      {
        id: 'W0001',
        slug: 'alpha',
        kind: 'finding',
        title: 'Alpha holds',
        status: 'TENTATIVE',
        stale: true,
        deprecated: false,
        updatedAt: '2026-09-02T10:00:00+08:00',
      },
    ])
    expect(await service.wikiBacklinks('research', 'E9999')).toEqual([])
  })
})

describe('FilesystemDocumentService wiki writes', () => {
  it('writes under the mtime+hash lock, stamps updated_at, and keeps unknown keys', async () => {
    const before = BackendWikiDocumentSchema.parse(await service.getWiki('research', 'W0001'))
    const edited = FINDING.replace('Alpha holds.\n', 'Alpha holds for one seed.\n')
    const result = BackendWikiWriteResponseSchema.parse(
      await service.putWiki('research', 'W0001', {
        content: edited,
        expectedMtime: before.mtime,
        expectedHash: before.hash,
      }),
    )
    expect(result.ok).toBe(true)
    expect(result.page.content).toContain('Alpha holds for one seed.')
    const frontmatter = parseWikiFrontmatter(result.page.content).frontmatter!
    expect(frontmatter.owner).toBe('alice')
    expect(frontmatter.updated_at).not.toBe('2026-09-02T10:00:00+08:00')
    expect(result.page.updatedAt).toBe(frontmatter.updated_at)
    expect(result.hash).toBe(result.page.hash)
    expect(await fs.readFile(join(root, 'docs/wiki/finding/W0001-alpha.md'), 'utf8')).toBe(
      result.page.content,
    )
  })

  it('returns the conflict envelope with the current bytes when the page moved on', async () => {
    const before = BackendWikiDocumentSchema.parse(await service.getWiki('research', 'W0001'))
    const onDisk = FINDING.replace('One seed only.', 'Two seeds.')
    await fs.writeFile(join(root, 'docs/wiki/finding/W0001-alpha.md'), onDisk)
    const conflict = BackendWikiConflictResponseSchema.parse(
      await service.putWiki('research', 'W0001', {
        content: FINDING.replace('One seed only.', 'Three seeds.'),
        expectedMtime: before.mtime,
        expectedHash: before.hash,
      }),
    )
    expect(conflict.error.code).toBe('CONFLICT')
    expect(conflict.currentContent).toBe(onDisk)
    expect(conflict.currentHash).not.toBe(before.hash)
    expect(await fs.readFile(join(root, 'docs/wiki/finding/W0001-alpha.md'), 'utf8')).toBe(onDisk)
  })

  it('rejects identity changes, leaving the file untouched', async () => {
    const before = BackendWikiDocumentSchema.parse(await service.getWiki('research', 'W0001'))
    const lock = { expectedMtime: before.mtime, expectedHash: before.hash }
    for (const content of [
      FINDING.replace('id: W0001', 'id: W0040'),
      FINDING.replace('kind: finding', 'kind: note'),
    ]) {
      const error = await service
        .putWiki('research', 'W0001', { ...lock, content })
        .catch((thrown: BackendDocumentServiceError) => thrown)
      expect((error as BackendDocumentServiceError).code).toBe('INVALID_RESOURCE')
    }
    expect(await fs.readFile(join(root, 'docs/wiki/finding/W0001-alpha.md'), 'utf8')).toBe(FINDING)
  })
})
