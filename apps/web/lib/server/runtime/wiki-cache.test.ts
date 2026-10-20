// @vitest-environment node
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Poller, type WikiProjectContext } from '@memon/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WikiCache } from './wiki-cache'

let root: string
let changes: string[]

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

function makeCache(): WikiCache {
  return new WikiCache({
    projects: [{ name: 'project-a', root }],
    context: () => EMPTY_CONTEXT,
    onChange: (project) => changes.push(project),
  })
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'wiki-cache-'))
  changes = []
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
  it('does not claim review-ledger or Git changes as Wiki polling work', async () => {
    const cache = makeCache()
    await cache.warmup()
    expect(cache.handlePollChange(join(root, '.memon', 'wiki-review.csv'))).toBe(false)
    expect(cache.handlePollChange(join(root, '.git', 'HEAD'))).toBe(false)
    expect(cache.getWikiSummary('project-a', 'W0001')).not.toHaveProperty('review')
  })

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
