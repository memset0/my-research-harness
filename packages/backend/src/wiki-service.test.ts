import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { promisify } from 'node:util'
import {
  BackendWikiConflictResponseSchema,
  BackendWikiDocumentSchema,
  BackendWikiInventoryResponseSchema,
  BackendWikiPagesResponseSchema,
  BackendWikiReviewResponseSchema,
  BackendWikiWriteResponseSchema,
  getFileOperationMetrics,
  invalidateGitOperations,
  type ProjectConfig,
  parseWikiFrontmatter,
  WikiReviewError,
  WikiReviewOrderError,
  withProjectFileContext,
} from '@memon/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type BackendDocumentServiceError, FilesystemDocumentService } from './document-service.js'
import type {
  BackendExecutionProvider,
  ExecutionBytesResult,
  ExecutionCommandOptions,
  ExecutionCommandResult,
} from './execution-service.js'

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

  it('keeps W0002 composition automatic while refreshing its selected body manually', async () => {
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

    // Manual refresh serves the current cache while scheduling verification.
    // Inventory composition stays automatic; the selected body becomes fresh
    // after that priority check completes, without another manual refresh.
    expect(page.title).toBe('Beta note')
    expect(counters('automatic').cacheHits).toBeGreaterThan(counters('automatic', before).cacheHits)
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
      const relativePath = index === 0 ? `docs/wiki/finding/${page}` : `docs/wiki/note/${page}`
      await fs.appendFile(join(repoRoot, relativePath), `\nEdit ${index}.\n`)
      await git('add', relativePath)
      await git('commit', '-m', `wiki: edit ${index}`)
      commits.push(await git('rev-parse', 'HEAD'))
    }
    repoService = new FilesystemDocumentService([
      {
        name: 'research',
        root: repoRoot,
        include: [],
        exclude: [],
        execution: { kind: 'local' },
      } satisfies ProjectConfig,
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

  it('serves one page with the same review the list reports for it', async () => {
    await repoService.markWikiReview('research', commits[0]!)
    await repoService.markWikiReview('research', commits[1]!)
    const listed = BackendWikiPagesResponseSchema.parse(await repoService.listWiki('research'))
    for (const id of ['W0001', 'W0002']) {
      const page = BackendWikiDocumentSchema.parse(await repoService.getWiki('research', id))
      expect(page.review).not.toBeNull()
      expect(page.review).toEqual(listed.pages.find((entry) => entry.id === id)?.review)
    }
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

  it('leaves review unchecked for a Project with no execution target', async () => {
    // `repoRoot` is a real worktree, so a local `git` would answer here. A
    // Project that has not said its files are local must not be asked: a
    // mounted root looks exactly like this and reports another machine's git.
    const unconfigured = new FilesystemDocumentService([
      { name: 'research', root: repoRoot, include: [], exclude: [] } satisfies ProjectConfig,
    ])
    const pages = BackendWikiPagesResponseSchema.parse(await unconfigured.listWiki('research'))
    expect(pages.pages.map((page) => page.id)).toEqual(['W0001', 'W0003', 'W0002'])
    expect(pages.pages.every((page) => page.review === null)).toBe(true)

    for (const operation of [
      unconfigured.wikiReviewLog('research'),
      unconfigured.markWikiReview('research', commits[0]!),
      unconfigured.unmarkWikiReview('research', commits[0]!),
    ]) {
      const error = await operation.catch((thrown: unknown) => thrown)
      expect((error as BackendDocumentServiceError).code).toBe('EXECUTION_UNAVAILABLE')
    }
    expect(await fs.readdir(join(repoRoot, '.memon')).catch(() => [])).not.toContain(
      'wiki-review.csv',
    )
  })
})

/** What an unreachable SSH target reports back for every argv. */
const TRANSPORT_FAILURE = 'ssh: connect to host cluster port 22: Connection timed out'

/**
 * Stands in for a configured SSH target: the same argv, run in the target's
 * own copy of the Project at the translated path, never at the mounted path
 * the Backend sees. `unanswerable` argv report a transport failure instead,
 * which is how a dropped connection or a dead target arrives.
 */
function executionTarget(
  mountRoot: string,
  targetRoot: string,
  unanswerable: (args: readonly string[]) => boolean = () => false,
): { provider: BackendExecutionProvider; cwds: string[] } {
  const cwds: string[] = []
  const resolvePath = (absoluteLocalPath: string): string => {
    const rel = relative(mountRoot, absoluteLocalPath)
    if (rel === '') return targetRoot
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`path escapes the Project root: ${absoluteLocalPath}`)
    }
    return join(targetRoot, rel)
  }
  const run = async (
    bin: string,
    args: readonly string[],
    options?: ExecutionCommandOptions,
  ): Promise<ExecutionCommandResult> => {
    const cwd = resolvePath(options?.cwd ?? mountRoot)
    cwds.push(cwd)
    if (unanswerable(args)) {
      return {
        stdout: '',
        stderr: TRANSPORT_FAILURE,
        code: 255,
        timedOut: true,
        spawnFailed: false,
      }
    }
    try {
      const { stdout, stderr } = await exec(bin, [...args], { cwd, maxBuffer: 4_194_304 })
      return { stdout, stderr, code: 0, timedOut: false, spawnFailed: false }
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; code?: number }
      return {
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
        code: typeof failure.code === 'number' ? failure.code : 1,
        timedOut: false,
        spawnFailed: false,
      }
    }
  }
  return {
    cwds,
    provider: {
      target: { kind: 'ssh', target: 'cluster', remoteRoot: targetRoot },
      run,
      // The review store reads text only; these fixtures carry no binary blob.
      runBytes: async (bin, args, options): Promise<ExecutionBytesResult> => {
        const result = await run(bin, args, options)
        return { ...result, stdout: Buffer.from(result.stdout, 'utf8') }
      },
      resolvePath,
    },
  }
}

describe('FilesystemDocumentService wiki review on a remote execution target', () => {
  let mountRoot = ''
  let targetRoot = ''
  let commit = ''

  const remoteProject = () =>
    ({
      name: 'research',
      root: mountRoot,
      include: [],
      exclude: [],
      execution: { kind: 'ssh', target: 'cluster', remoteRoot: targetRoot },
    }) satisfies ProjectConfig

  beforeEach(async () => {
    // The target owns the worktree; the Backend sees the same files through a
    // mount that is no repository at all — a local `git` there answers nothing.
    targetRoot = await fs.mkdtemp(join(tmpdir(), 'memon-backend-wiki-target-'))
    mountRoot = await fs.mkdtemp(join(tmpdir(), 'memon-backend-wiki-mount-'))
    await Promise.all([writeWikiFixtures(targetRoot), writeWikiFixtures(mountRoot)])
    for (const args of [
      ['init'],
      ['config', 'user.email', 'backend@example.test'],
      ['config', 'user.name', 'Backend Test'],
      ['add', '.'],
      ['commit', '-m', 'wiki: initial pages'],
    ]) {
      await exec('git', args, { cwd: targetRoot })
    }
    commit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: targetRoot })).stdout.trim()
  })

  afterEach(async () => {
    await Promise.all([
      fs.rm(mountRoot, { recursive: true, force: true }),
      fs.rm(targetRoot, { recursive: true, force: true }),
    ])
  })

  it('derives review from the target repository, keeping marks beside mounted files', async () => {
    const { provider, cwds } = executionTarget(mountRoot, targetRoot)
    const remote = new FilesystemDocumentService([remoteProject()], {
      execution: () => provider,
    })

    const listed = BackendWikiPagesResponseSchema.parse(await remote.listWiki('research'))
    const before = new Map(listed.pages.map((page) => [page.id, page]))
    expect(before.get('W0001')?.review?.state).toBe('UNVERIFIED')
    expect(before.get('W0001')?.review?.unverifiedCommits).toEqual([commit])

    const log = BackendWikiReviewResponseSchema.parse(await remote.wikiReviewLog('research'))
    expect(log.commits.map((entry) => entry.sha)).toEqual([commit])

    await remote.markWikiReview('research', commit, 'read on the cluster')
    const verified = BackendWikiPagesResponseSchema.parse(await remote.listWiki('research'))
    expect(verified.pages.every((page) => page.review?.state === 'VERIFIED')).toBe(true)

    // Marks are Project files, so they land on the mount; git never ran there.
    expect(await fs.readdir(join(mountRoot, '.memon'))).toContain('wiki-review.csv')
    expect(await fs.readdir(join(targetRoot, '.memon')).catch(() => [])).not.toContain(
      'wiki-review.csv',
    )
    expect(cwds.length).toBeGreaterThan(0)
    expect(cwds.every((cwd) => cwd === targetRoot || cwd.startsWith(`${targetRoot}/`))).toBe(true)
    expect(cwds.some((cwd) => cwd.startsWith(mountRoot))).toBe(false)
  })

  it('reports review as unchecked, never verified, when the target stops answering', async () => {
    const reachable = executionTarget(mountRoot, targetRoot)
    const marker = new FilesystemDocumentService([remoteProject()], {
      execution: () => reachable.provider,
    })
    await marker.markWikiReview('research', commit)

    // The target's earlier answers are gone: in production a Project write or
    // an observed filesystem change flushes them, and the shared git read
    // cache keeps a success for seconds at most. What is under test is the
    // verdict with nothing saved, so start from nothing saved.
    invalidateGitOperations()
    const unreachable = executionTarget(mountRoot, targetRoot, () => true)
    const stranded = new FilesystemDocumentService([remoteProject()], {
      execution: () => unreachable.provider,
    })
    const pages = BackendWikiPagesResponseSchema.parse(await stranded.listWiki('research'))
    expect(pages.pages.map((page) => page.id)).toEqual(['W0001', 'W0003', 'W0002'])
    expect(pages.pages.every((page) => page.review === null)).toBe(true)

    const error = await stranded.wikiReviewLog('research').catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(WikiReviewError)
    expect((error as WikiReviewError).code).toBe('GIT_UNAVAILABLE')
  })

  it('keeps a verified page unchecked when only the dirty-state read fails', async () => {
    const reachable = executionTarget(mountRoot, targetRoot)
    const marker = new FilesystemDocumentService([remoteProject()], {
      execution: () => reachable.provider,
    })
    await marker.markWikiReview('research', commit)
    expect(
      BackendWikiPagesResponseSchema.parse(await marker.listWiki('research')).pages.every(
        (page) => page.review?.state === 'VERIFIED',
      ),
    ).toBe(true)

    // History and blame still answer; only the working-tree state is lost. A
    // page whose uncommitted edits cannot be seen is not a verified page.
    // `git` argv carry global flags ahead of the subcommand, so match on it.
    invalidateGitOperations()
    const partial = executionTarget(mountRoot, targetRoot, (args) => args.includes('status'))
    const degraded = new FilesystemDocumentService([remoteProject()], {
      execution: () => partial.provider,
    })
    const pages = BackendWikiPagesResponseSchema.parse(await degraded.listWiki('research'))
    expect(pages.pages.every((page) => page.review === null)).toBe(true)
  })
})
