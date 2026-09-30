// @vitest-environment node
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Poller, type WikiProjectContext, type WikiReview } from '@memon/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gitWatchPaths, WikiCache, type WikiCacheGit } from './wiki-cache'

let root: string
let changes: string[]
let reviewChanges: string[]

const EMPTY_CONTEXT: WikiProjectContext = {
  experiments: [],
  runs: [],
  hypothesesMtime: null,
}

function page(id: string, kind: string, title: string, extra = ''): string {
  return [
    '---',
    `id: ${id}`,
    `kind: ${kind}`,
    `title: ${title}`,
    'created_at: 2026-05-01T10:00:00+08:00',
    'updated_at: 2026-05-01T10:00:00+08:00',
    extra,
    '---',
    '',
    `# ${title}`,
    '',
    'Body.',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

function noGit(overrides: Partial<WikiCacheGit> = {}): WikiCacheGit {
  return {
    isGitWorktree: vi.fn(async () => false),
    listWikiCommits: vi.fn(async () => null),
    readWikiReviewMarks: vi.fn(async () => []),
    deriveWikiReview: vi.fn(async () => null),
    ...overrides,
  }
}

function makeCache(git: WikiCacheGit = noGit()): WikiCache {
  return new WikiCache({
    projects: [{ name: 'project-a', root }],
    context: () => EMPTY_CONTEXT,
    onChange: (project) => changes.push(project),
    onReviewChange: (project) => reviewChanges.push(project),
    git,
  })
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'wiki-cache-'))
  changes = []
  reviewChanges = []
  await fs.mkdir(join(root, 'docs', 'wiki', 'finding'), { recursive: true })
  await fs.writeFile(
    join(root, 'docs', 'wiki', 'finding', 'W0001-zero-snr.md'),
    page('W0001', 'finding', 'Zero SNR', 'status: TENTATIVE\nsources:\n  - E0017'),
  )
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('WikiCache', () => {
  it('lists both page forms two levels deep and serves them without touching disk', async () => {
    const bundle = join(root, 'docs', 'wiki', 'showcase', 'W0006-explorer')
    await fs.mkdir(join(bundle, 'views'), { recursive: true })
    await fs.writeFile(join(bundle, 'README.md'), page('W0006', 'showcase', 'Explorer'))
    await fs.writeFile(join(bundle, 'views', 'index.html'), '<html></html>')

    const cache = makeCache()
    await cache.warmup()

    const list = cache.getWikiList('project-a')
    expect(list.map((entry) => entry.id)).toEqual(['W0001', 'W0006'])
    expect(list.map((entry) => entry.path)).toEqual([
      'docs/wiki/finding/W0001-zero-snr.md',
      'docs/wiki/showcase/W0006-explorer/README.md',
    ])
    expect(list[1]!.format).toBe('bundle')
    expect(cache.getPageRecord('project-a', 'W0006')?.assets).toContain('views/index.html')

    // A served list is pure CPU: no new stat/read/git after warmup.
    const statSpy = vi.spyOn(fs, 'stat')
    const readSpy = vi.spyOn(fs, 'readFile')
    const before = cache.getStats()
    for (let i = 0; i < 100; i += 1) cache.getWikiList('project-a')
    expect(statSpy).not.toHaveBeenCalled()
    expect(readSpy).not.toHaveBeenCalled()
    expect(cache.getStats()).toEqual(before)
    statSpy.mockRestore()
    readSpy.mockRestore()
  })

  it('picks up a new kind directory and a new page through the Poller', async () => {
    const cache = makeCache()
    await cache.warmup()
    const poller = new Poller({ minIntervalMs: 10, maxIntervalMs: 20, backoffFactor: 2 }, () => {})
    try {
      const wikiDir = join(root, 'docs', 'wiki')
      await fs.mkdir(join(wikiDir, 'decision'))
      await fs.writeFile(
        join(wikiDir, 'decision', 'W0003-bf16.md'),
        page('W0003', 'decision', 'Adopt bf16', 'status: ACCEPTED'),
      )
      changes = []

      // Root dir mtime advanced → the new kind dir is registered and scanned.
      expect(cache.handlePollChange(wikiDir, poller)).toBe(true)
      await vi.waitFor(() => {
        expect(cache.getWikiList('project-a').map((entry) => entry.id)).toEqual(['W0001', 'W0003'])
      })
      expect(changes).toContain('project-a')
      expect(cache.dirs()).toContain(join(wikiDir, 'decision'))
      expect(cache.paths()).toContain(join(wikiDir, 'decision', 'W0003-bf16.md'))
    } finally {
      poller.stop()
    }
  })

  it('reflects an external page edit and drops a deleted page', async () => {
    const cache = makeCache()
    await cache.warmup()
    const target = join(root, 'docs', 'wiki', 'finding', 'W0001-zero-snr.md')

    await fs.writeFile(target, page('W0001', 'finding', 'Zero SNR revisited'))
    expect(cache.handlePollChange(target)).toBe(true)
    await vi.waitFor(() => {
      expect(cache.getWikiSummary('project-a', 'W0001')?.title).toBe('Zero SNR revisited')
    })
    const fresh = await cache.getWikiPage('project-a', 'W0001')
    expect(fresh?.content).toContain('Zero SNR revisited')
    expect(fresh?.hash).toHaveLength(40)

    await fs.rm(target)
    expect(cache.handlePollChange(target)).toBe(true)
    await vi.waitFor(() => {
      expect(cache.getWikiList('project-a')).toEqual([])
    })
  })

  it('recomputes staleness from the live projection context', async () => {
    // A minimal Experiment record: staleness only reads id / project /
    // frontMatter.{updatedAt,runs}, and the real type carries a dozen fields
    // the projection never looks at.
    const experiment = {
      id: 'E0017-fused',
      project: 'project-a',
      path: join(root, 'docs', 'experiments', 'E0017-fused', 'README.md'),
      frontMatter: { updatedAt: '2026-05-01T09:00:00+08:00', runs: [] as string[] },
    }
    const experiments = [experiment] as unknown as WikiProjectContext['experiments']
    const cache = new WikiCache({
      projects: [{ name: 'project-a', root }],
      context: () => ({ ...EMPTY_CONTEXT, experiments }),
      onChange: (project) => changes.push(project),
      onReviewChange: (project) => reviewChanges.push(project),
      git: noGit(),
    })
    await cache.warmup()
    expect(cache.getWikiSummary('project-a', 'W0001')?.stale).toBe(false)

    // The cited Experiment moves past the page's own updated_at.
    experiment.frontMatter.updatedAt = '2026-06-01T09:00:00+08:00'
    cache.invalidate('project-a')
    const stale = cache.getWikiSummary('project-a', 'W0001')
    expect(stale?.stale).toBe(true)
    expect(stale?.staleSources).toEqual(['E0017'])
  })

  it('derives review off the request path and exposes the commit log', async () => {
    const review: WikiReview = {
      state: 'CHANGED_SINCE_VERIFY',
      verifiedThrough: 'a'.repeat(40),
      verifiedAt: '2026-05-02T10:00:00+08:00',
      unverifiedCommits: ['b'.repeat(40)],
      unverifiedRanges: [[3, 5]],
      dirty: false,
    }
    const commits = [
      {
        sha: 'a'.repeat(40),
        authoredAt: '2026-05-01T10:00:00+08:00',
        subject: 'add W0001',
        pages: ['W0001'],
        files: ['docs/wiki/finding/W0001-zero-snr.md'],
      },
      {
        sha: 'b'.repeat(40),
        authoredAt: '2026-05-03T10:00:00+08:00',
        subject: 'edit W0001',
        pages: ['W0001'],
        files: ['docs/wiki/finding/W0001-zero-snr.md'],
      },
    ]
    const marks = [
      { sha: 'a'.repeat(40), verifiedAt: '2026-05-02T10:00:00+08:00', note: 'looks right' },
    ]
    const derive = vi.fn(async () => new Map([['docs/wiki/finding/W0001-zero-snr.md', review]]))
    const git = noGit({
      isGitWorktree: vi.fn(async () => true),
      listWikiCommits: vi.fn(async () => commits),
      readWikiReviewMarks: vi.fn(async () => marks),
      deriveWikiReview: derive,
    })
    const cache = makeCache(git)
    await cache.warmup()

    expect(cache.getWikiSummary('project-a', 'W0001')?.review).toEqual(review)
    expect(reviewChanges).toEqual(['project-a'])
    const log = cache.getReviewLog('project-a')
    expect(log?.verifiedThrough).toBe('a'.repeat(40))
    expect(log?.commits.map((commit) => commit.verified)).toEqual([true, false])
    expect(log?.commits[0]?.note).toBe('looks right')

    // No further git once warmed: serving the list and the log is snapshot-only.
    const derivations = derive.mock.calls.length
    for (let i = 0; i < 50; i += 1) {
      cache.getWikiList('project-a')
      cache.getReviewLog('project-a')
    }
    expect(derive.mock.calls.length).toBe(derivations)
    expect(cache.getStats().reviewRefreshes).toBe(1)
  })

  it('re-derives review when the review store or HEAD changes, and reports non-git as null', async () => {
    const gitDir = join(root, '.git')
    await fs.mkdir(join(gitDir, 'refs', 'heads'), { recursive: true })
    await fs.writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
    await fs.writeFile(join(gitDir, 'refs', 'heads', 'main'), `${'c'.repeat(40)}\n`)

    const git = noGit({
      isGitWorktree: vi.fn(async () => true),
      listWikiCommits: vi.fn(async () => []),
      deriveWikiReview: vi.fn(async () => new Map<string, WikiReview>()),
    })
    const cache = makeCache(git)
    await cache.warmup()
    const poller = new Poller({ minIntervalMs: 10, maxIntervalMs: 20, backoffFactor: 2 }, () => {})
    try {
      await cache.watchGitPaths(poller)
      expect(cache.handlePollChange(join(root, '.memon', 'wiki-review.csv'), poller)).toBe(true)
      expect(cache.handlePollChange(join(gitDir, 'refs', 'heads', 'main'), poller)).toBe(true)
      await vi.waitFor(() => {
        expect(cache.getStats().reviewRefreshes).toBeGreaterThanOrEqual(3)
      })
    } finally {
      poller.stop()
    }

    const plain = makeCache()
    await plain.warmup()
    expect(plain.getWikiSummary('project-a', 'W0001')?.review).toBeNull()
    expect(plain.getReviewLog('project-a')).toBeNull()
    expect(plain.isGitProject('project-a')).toBe(false)
  })

  it('writes a page under the mtime+hash lock and rejects a stale write', async () => {
    const cache = makeCache()
    await cache.warmup()
    const current = await cache.getWikiPage('project-a', 'W0001')
    const next = `${current!.content}\nMore.\n`

    const stale = await cache.putWikiPage(
      'project-a',
      'W0001',
      next,
      current!.mtime - 1000,
      current!.hash,
    )
    expect(stale).toMatchObject({ ok: false, code: 'CONFLICT' })

    const ok = await cache.putWikiPage('project-a', 'W0001', next, current!.mtime, current!.hash)
    expect(ok.ok).toBe(true)
    const reread = await cache.getWikiPage('project-a', 'W0001')
    expect(reread?.content).toBe(next)
  })
})

describe('gitWatchPaths', () => {
  it('finds HEAD and its branch ref when the Project root is nested in a worktree', async () => {
    const repository = join(root, 'repository')
    const project = join(repository, 'projects', 'project-a')
    await fs.mkdir(join(repository, '.git', 'refs', 'heads'), { recursive: true })
    await fs.mkdir(project, { recursive: true })
    await fs.writeFile(join(repository, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    const paths = await gitWatchPaths(project)
    expect(paths).toEqual([
      join(project, '.memon', 'wiki-review.csv'),
      join(repository, '.git', 'HEAD'),
      join(repository, '.git', 'refs', 'heads', 'main'),
    ])
  })
})
