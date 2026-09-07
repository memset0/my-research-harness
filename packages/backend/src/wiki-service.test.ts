import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  BackendWikiConflictResponseSchema,
  BackendWikiDocumentSchema,
  BackendWikiPagesResponseSchema,
  BackendWikiReviewResponseSchema,
  BackendWikiWriteResponseSchema,
  parseWikiFrontmatter,
  WikiReviewOrderError,
} from '@memon/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type BackendDocumentServiceError, FilesystemDocumentService } from './document-service.js'

const exec = promisify(execFile)

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

const project = () => ({ name: 'research', root, include: [], exclude: [] })

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
  it('lists pages in canonical order with staleness, review, and no cluster paths', async () => {
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
    // Outside a git worktree there is no verification history at all.
    expect(listed.pages.every((page) => page.review === null)).toBe(true)
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
        reviewState: null,
        updatedAt: '2026-09-02T10:00:00+08:00',
      },
    ])
    expect(await service.wikiBacklinks('research', 'E9999')).toEqual([])
  })

  it('has no review history outside a git worktree', async () => {
    const error = await service
      .wikiReviewLog('research')
      .catch((thrown: BackendDocumentServiceError) => thrown)
    expect((error as BackendDocumentServiceError).code).toBe('RESOURCE_NOT_FOUND')
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

  it('rejects identity and review-column changes, leaving the file untouched', async () => {
    const before = BackendWikiDocumentSchema.parse(await service.getWiki('research', 'W0001'))
    const lock = { expectedMtime: before.mtime, expectedHash: before.hash }
    for (const content of [
      FINDING.replace('id: W0001', 'id: W0040'),
      FINDING.replace('kind: finding', 'kind: note'),
      FINDING.replace('owner: alice', 'reviewed_at: "2026-09-09T10:00:00+08:00"'),
    ]) {
      const error = await service
        .putWiki('research', 'W0001', { ...lock, content })
        .catch((thrown: BackendDocumentServiceError) => thrown)
      expect((error as BackendDocumentServiceError).code).toBe('INVALID_RESOURCE')
    }
    expect(await fs.readFile(join(root, 'docs/wiki/finding/W0001-alpha.md'), 'utf8')).toBe(FINDING)
  })
})

describe('FilesystemDocumentService wiki review', () => {
  let repoRoot = ''
  let repoService: FilesystemDocumentService
  let commits: string[] = []

  async function git(...args: string[]): Promise<string> {
    return (await exec('git', args, { cwd: repoRoot })).stdout.trim()
  }

  beforeEach(async () => {
    repoRoot = await fs.mkdtemp(join(tmpdir(), 'memon-backend-wiki-git-'))
    await writeWikiFixtures(repoRoot)
    await git('init')
    await git('config', 'user.email', 'backend@example.test')
    await git('config', 'user.name', 'Backend Test')
    await git('add', '.')
    await git('commit', '-m', 'wiki: initial pages')
    commits = [await git('rev-parse', 'HEAD')]
    for (const [index, page] of ['W0001-alpha.md', 'W0002-beta.md'].entries()) {
      const relativePath =
        index === 0 ? `docs/wiki/finding/${page}` : `docs/wiki/note/${page}`
      await fs.appendFile(join(repoRoot, relativePath), `\nEdit ${index}.\n`)
      await git('add', relativePath)
      await git('commit', '-m', `wiki: edit ${index}`)
      commits.push(await git('rev-parse', 'HEAD'))
    }
    repoService = new FilesystemDocumentService([
      { name: 'research', root: repoRoot, include: [], exclude: [] },
    ])
  })

  afterEach(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true })
  })

  it('lists wiki commits oldest first with nothing verified yet', async () => {
    const log = BackendWikiReviewResponseSchema.parse(await repoService.wikiReviewLog('research'))
    expect(log.verifiedThrough).toBeNull()
    expect(log.commits.map((commit) => commit.sha)).toEqual(commits)
    expect(log.commits.every((commit) => !commit.verified)).toBe(true)
    expect(log.commits[1]?.pages).toEqual(['W0001'])
  })

  it('refuses an out-of-order mark and offers the next markable commit', async () => {
    const error = await repoService
      .markWikiReview('research', commits[2]!)
      .catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(WikiReviewOrderError)
    expect((error as WikiReviewOrderError).nextSha).toBe(commits[0])
    expect(await fs.readdir(join(repoRoot, '.memon')).catch(() => [])).not.toContain(
      'wiki-review.csv',
    )
  })

  it('marks sequentially, derives per-page review, and cascades an unmark', async () => {
    await repoService.markWikiReview('research', commits[0]!, 'reviewed the seed pages')
    const afterFirst = BackendWikiReviewResponseSchema.parse(
      await repoService.markWikiReview('research', commits[1]!),
    )
    expect(afterFirst.verifiedThrough).toBe(commits[1])
    expect(afterFirst.commits.map((commit) => commit.verified)).toEqual([true, true, false])
    expect(afterFirst.commits[0]?.note).toBe('reviewed the seed pages')

    const pages = BackendWikiPagesResponseSchema.parse(await repoService.listWiki('research'))
    const byId = new Map(pages.pages.map((page) => [page.id, page]))
    expect(byId.get('W0001')?.review?.state).toBe('VERIFIED')
    expect(byId.get('W0002')?.review?.state).toBe('CHANGED_SINCE_VERIFY')
    expect(byId.get('W0002')?.review?.unverifiedCommits).toEqual([commits[2]])

    const cascaded = BackendWikiReviewResponseSchema.parse(
      await repoService.unmarkWikiReview('research', commits[0]!),
    )
    expect(cascaded.verifiedThrough).toBeNull()
    expect(cascaded.commits.every((commit) => !commit.verified)).toBe(true)
  })

  it('reports an uncommitted edit as dirty', async () => {
    await repoService.markWikiReview('research', commits[0]!)
    await repoService.markWikiReview('research', commits[1]!)
    await repoService.markWikiReview('research', commits[2]!)
    await fs.appendFile(join(repoRoot, 'docs/wiki/finding/W0001-alpha.md'), '\nUncommitted.\n')
    const pages = BackendWikiPagesResponseSchema.parse(await repoService.listWiki('research'))
    const page = pages.pages.find((candidate) => candidate.id === 'W0001')!
    expect(page.review?.dirty).toBe(true)
    expect(page.review?.state).toBe('CHANGED_SINCE_VERIFY')
  })
})
