import { promises as fs } from 'node:fs'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rebuildIndex } from '../derived-index/rebuild.js'
import { withFileWriterLock } from '../file-writer-lock.js'
import { deleteWikiPage } from './delete.js'
import { reserveWikiId } from './id-watermark.js'

const page =
  '---\nid: W0001\nkind: note\ntitle: Alpha\ncreated_at: 2026-10-20T12:00:00+08:00\nupdated_at: 2026-10-20T12:00:00+08:00\n---\n# Alpha\n'
const source = 'docs/wiki/note/W0001-alpha/README.md'
afterEach(async () => {
  vi.restoreAllMocks()
  await removeTempDirs()
})

async function fixture(files: Record<string, string> = {}) {
  const p = await createTempProject({
    files: { [source]: page, 'docs/wiki/note/W0001-alpha/chart.svg': '<svg/>', ...files },
  })
  await rebuildIndex(p.root, { role: 'cli' })
  return p
}

describe('guarded Wiki deletion', () => {
  it.each([
    ['docs/experiments/E0001-study/README.md', 'See @W0001.'],
    ['docs/reports/R0001-review.md', 'See [reference](../wiki/note/W0001-alpha/README.md).'],
    ['docs/experiments/E0001-study/details/analysis.md', 'W0001'],
    ['docs/reports/R0001-review/manifest.json', '{"sources":["W0001"]}'],
    [
      'docs/reports/R0002-notes/report.html',
      '<a href="../../wiki/note/W0001-alpha/chart.svg">Chart</a>',
    ],
  ])('blocks a real reference in %s and preserves every target byte', async (location, text) => {
    const p = await fixture({ [location]: text })
    await expect(
      deleteWikiPage({ projectRoot: p.root, page: 'W0001', projectName: 'project-a' }),
    ).rejects.toMatchObject({
      code: 'WIKI_REFERENCED',
      details: {
        references: expect.arrayContaining([
          expect.objectContaining({ source: location, line: expect.any(Number) }),
        ]),
      },
    })
    expect(await fs.readFile(p.path(source), 'utf8')).toBe(page)
    expect(await fs.readFile(p.path('docs/wiki/note/W0001-alpha/chart.svg'), 'utf8')).toBe('<svg/>')
  })

  it('deletes a manifest-only bundle, preserves sibling assets, and publishes inventory', async () => {
    const p = await createTempProject({
      files: {
        'docs/wiki/tools/W0001-alpha/manifest.json': '{"id":"W0001","title":"Alpha","type":"html"}',
        'docs/wiki/tools/W0001-alpha/index.html': '<a href="#self">Self</a>',
        'docs/wiki/tools/W0001-alpha__assets/other.txt': 'unowned sibling',
      },
    })
    await rebuildIndex(p.root, { role: 'cli' })
    const result = await deleteWikiPage({ projectRoot: p.root, page: 'alpha' })
    expect(result.deleted).toEqual(['docs/wiki/tools/W0001-alpha'])
    expect(await fs.readFile(p.path('docs/wiki/tools/W0001-alpha__assets/other.txt'), 'utf8')).toBe(
      'unowned sibling',
    )
    expect(
      JSON.parse(await fs.readFile(p.path('.memon/index/snapshot.json'), 'utf8')).wiki,
    ).toEqual({})
  })

  it('lets an existing classified Report own its legacy R identity', async () => {
    const p = await fixture({
      [source]: page.replace('kind: note', 'kind: note\nlegacy_id: R0003'),
      'docs/reports/analysis/R0003-original/README.md': '# Original Report\n',
      'docs/reports/R0004-other.md': 'See R0003.\n',
    })
    const result = await deleteWikiPage({ projectRoot: p.root, page: 'W0001' })
    expect(result.id).toBe('W0001')
    expect(
      await fs.readFile(p.path('docs/reports/analysis/R0003-original/README.md'), 'utf8'),
    ).toBe('# Original Report\n')
  })

  it('ignores Run metadata and unrelated files outside the three document roots', async () => {
    const p = await createTempProject({
      wiki: { 'note/W0001-alpha/README.md': page },
      runs: {
        'logs/trial-261020-120000':
          '---\nid: trial-261020-120000\nstatus: FINISHED\ncreated_at: 2026-10-20T12:00:00+08:00\n---\nSee @W0001.\n',
      },
      files: {
        'logs/raw-output/unknown.json': 'not JSON and not a registered research document',
        'README.md': 'See @W0001.',
        'docs/handoff.md': 'See @W0001.',
      },
    })
    await rebuildIndex(p.root, { role: 'cli' })
    const read = vi.spyOn(fs, 'readFile')
    const result = await deleteWikiPage({ projectRoot: p.root, page: 'W0001' })
    expect(result.id).toBe('W0001')
    expect(read.mock.calls.some(([path]) => String(path).includes('/logs/'))).toBe(false)
  })

  it('does not follow Experiment model cache links or traverse generated output trees', async () => {
    const p = await fixture(),
      other = await createTempProject({ files: { 'config.json': '{"reference":"W0001"}' } })
    for (const name of ['cache', 'outputs', 'checkpoints']) {
      const directory = p.path(`docs/experiments/E0001-study/${name}`)
      await fs.mkdir(directory, { recursive: true })
      await fs.symlink(other.root, `${directory}/model`)
    }
    const realpath = vi.spyOn(fs, 'realpath')
    const readdir = vi.spyOn(fs, 'readdir')
    expect((await deleteWikiPage({ projectRoot: p.root, page: 'W0001' })).id).toBe('W0001')
    for (const spy of [realpath, readdir])
      expect(
        spy.mock.calls.some(([path]) => /\/(cache|outputs|checkpoints)(\/|$)/.test(String(path))),
      ).toBe(false)
    expect(await fs.readFile(other.path('config.json'), 'utf8')).toBe('{"reference":"W0001"}')
  })

  it.each([
    ['docs/wiki/cache/W0002-related.md', 'See @W0001.'],
    ['docs/experiments/E0001-study/details/cache/notes.md', 'See @W0001.'],
    ['docs/reports/cache/R0001-related/README.md', 'See @W0001.'],
    [
      'docs/reports/R0001-related/data/view.html',
      '<a href="../../../wiki/note/W0001-alpha/README.md">Source</a>',
    ],
    ['docs/experiments/E0001-study/experiment.json', '{"sources":["W0001"]}'],
  ])('checks ordinary document references in %s', async (location, content) => {
    const p = await fixture({ [location]: content })
    await expect(deleteWikiPage({ projectRoot: p.root, page: 'W0001' })).rejects.toMatchObject({
      code: 'WIKI_REFERENCED',
      details: {
        references: expect.arrayContaining([expect.objectContaining({ source: location })]),
      },
    })
    expect(await fs.readFile(p.path(source), 'utf8')).toBe(page)
  })

  it('accepts an unchanged contained legacy document alias', async () => {
    const p = await fixture({
      'docs/experiments/E0001-study/details/contract.md': 'Historical contract.',
    })
    await fs.symlink('details/contract.md', p.path('docs/experiments/E0001-study/contract.md'))
    const result = await deleteWikiPage({ projectRoot: p.root, page: 'W0001' })
    expect(result.id).toBe('W0001')
    expect(await fs.readlink(p.path('docs/experiments/E0001-study/contract.md'))).toBe(
      'details/contract.md',
    )
  })

  it('detects referent content changes behind a stable document alias', async () => {
    const p = await fixture({ 'docs/experiments/E0001-study/details/contract.md': 'No reference.' })
    const alias = p.path('docs/experiments/E0001-study/contract.md')
    const referent = p.path('docs/experiments/E0001-study/details/contract.md')
    await fs.symlink('details/contract.md', alias)
    const stat = await fs.stat(referent)
    const read = fs.readFile.bind(fs)
    let aliasReads = 0
    vi.spyOn(fs, 'readFile').mockImplementation((async (path, ...rest) => {
      if (String(path) === alias && ++aliasReads === 2) {
        await fs.writeFile(referent, 'See @W0001.')
        await fs.utimes(referent, stat.atime, stat.mtime)
      }
      return Reflect.apply(read, fs, [path, ...rest])
    }) as typeof fs.readFile)
    await expect(deleteWikiPage({ projectRoot: p.root, page: 'W0001' })).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(await read(p.path(source), 'utf8')).toBe(page)
  })

  it('refuses an escaping link inside Experiment details', async () => {
    const p = await fixture(),
      other = await createTempProject({ files: { 'article.md': 'External' } })
    await fs.mkdir(p.path('docs/experiments/E0001-study/details'), { recursive: true })
    await fs.symlink(
      other.path('article.md'),
      p.path('docs/experiments/E0001-study/details/linked.md'),
    )
    await expect(deleteWikiPage({ projectRoot: p.root, page: 'W0001' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(await fs.readFile(p.path(source), 'utf8')).toBe(page)
  })

  it('refuses an escaping symlink without deleting external files', async () => {
    const p = await fixture(),
      other = await createTempProject({ files: { 'private.md': 'External' } })
    await fs.symlink(other.path('private.md'), p.path('docs/wiki/note/W0001-alpha/escape.md'))
    await expect(deleteWikiPage({ projectRoot: p.root, page: 'W0001' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(await fs.readFile(other.path('private.md'), 'utf8')).toBe('External')
    expect(await fs.readFile(p.path(source), 'utf8')).toBe(page)
  })

  it('treats an external alias to a bundle asset as an inbound reference', async () => {
    const p = await fixture()
    await fs.mkdir(p.path('docs/reports'), { recursive: true })
    await fs.symlink('../wiki/note/W0001-alpha/chart.svg', p.path('docs/reports/plot.svg'))
    await expect(deleteWikiPage({ projectRoot: p.root, page: 'W0001' })).rejects.toMatchObject({
      code: 'WIKI_REFERENCED',
      details: {
        references: expect.arrayContaining([
          expect.objectContaining({ source: 'docs/reports/plot.svg', field: 'symlink' }),
        ]),
      },
    })
    expect(await fs.readFile(p.path('docs/reports/plot.svg'), 'utf8')).toBe('<svg/>')
  })

  it('fails closed when a source cannot be read', async () => {
    const p = await fixture({ 'docs/reports/R0002-check.md': 'No links' })
    const read = fs.readFile.bind(fs)
    vi.spyOn(fs, 'readFile').mockImplementation((async (path, ...rest) => {
      if (String(path) === p.path('docs/reports/R0002-check.md'))
        throw Object.assign(new Error('unreachable source'), { code: 'EIO' })
      return Reflect.apply(read, fs, [path, ...rest])
    }) as typeof fs.readFile)
    await expect(deleteWikiPage({ projectRoot: p.root, page: 'W0001' })).rejects.toMatchObject({
      code: 'BAD_STATE',
    })
    expect(await read(p.path(source), 'utf8')).toBe(page)
  })

  it('restores the complete bundle if inventory publication fails', async () => {
    const p = await fixture()
    const before = await fs.readFile(p.path('.memon/index/snapshot.json'), 'utf8')
    const rename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === p.path('.memon/index/snapshot.json')) throw new Error('publication failed')
      return rename(from, to)
    })
    await expect(deleteWikiPage({ projectRoot: p.root, page: 'W0001' })).rejects.toThrow(
      'publication failed',
    )
    expect(await fs.readFile(p.path(source), 'utf8')).toBe(page)
    expect(await fs.readFile(p.path('docs/wiki/note/W0001-alpha/chart.svg'), 'utf8')).toBe('<svg/>')
    expect(await fs.readFile(p.path('.memon/index/snapshot.json'), 'utf8')).toBe(before)
  })

  it('rejects a source edit with preserved mtime before deletion', async () => {
    const p = await fixture({ 'docs/reports/R0002-check.md': 'No links here.' })
    const stat = await fs.stat(p.path('docs/reports/R0002-check.md'))
    const read = fs.readFile.bind(fs)
    let reads = 0
    vi.spyOn(fs, 'readFile').mockImplementation((async (path, ...rest) => {
      if (String(path) === p.path('docs/reports/R0002-check.md') && ++reads === 2) {
        await fs.writeFile(p.path('docs/reports/R0002-check.md'), 'See W0001 now.')
        await fs.utimes(p.path('docs/reports/R0002-check.md'), stat.atime, stat.mtime)
      }
      return Reflect.apply(read, fs, [path, ...rest])
    }) as typeof fs.readFile)
    await expect(deleteWikiPage({ projectRoot: p.root, page: 'W0001' })).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(await read(p.path(source), 'utf8')).toBe(page)
  })

  it('never reuses the deleted highest ID, even after rebuilding the cache', async () => {
    const p = await fixture()
    await deleteWikiPage({ projectRoot: p.root, page: 'W0001' })
    await fs.rm(p.path('.memon/index'), { recursive: true })
    await rebuildIndex(p.root, { role: 'cli' })
    expect(await withFileWriterLock(p.root, () => reserveWikiId(p.root, 0))).toBe(2)
    expect(JSON.parse(await fs.readFile(p.path('.memon/id-watermarks.json'), 'utf8'))).toEqual({
      wiki: 2,
    })
  })

  it('removes only the canonical cache beside a standalone page', async () => {
    const p = await createTempProject({
      files: {
        'docs/wiki/note/W0001-alpha.md': page,
        'docs/wiki/note/W0001-alpha__assets/block.json': '{"value":1}',
        'docs/wiki/note/shared/chart.svg': '<svg/>',
      },
    })
    await rebuildIndex(p.root, { role: 'cli' })
    const result = await deleteWikiPage({ projectRoot: p.root, page: 'W0001' })
    expect(result.deleted).toEqual([
      'docs/wiki/note/W0001-alpha.md',
      'docs/wiki/note/W0001-alpha__assets',
    ])
    expect(await fs.readFile(p.path('docs/wiki/note/shared/chart.svg'), 'utf8')).toBe('<svg/>')
  })

  it('keeps the strict project declaration byte-identical while reserving IDs', async () => {
    const declaration = '# Keep this comment\nschema_version: 1\nrun_dirs: [logs/*]\n'
    const p = await createTempProject({
      files: {
        '.memon/project.yml': declaration,
        '.memon/id-watermarks.json': '{"wiki":40,"future_extension":{"keep":true}}\n',
      },
    })
    expect(await withFileWriterLock(p.root, () => reserveWikiId(p.root, 12))).toBe(41)
    const content = await fs.readFile(p.path('.memon/project.yml'), 'utf8')
    expect(content).toBe(declaration)
    expect(JSON.parse(await fs.readFile(p.path('.memon/id-watermarks.json'), 'utf8'))).toEqual({
      wiki: 41,
      future_extension: { keep: true },
    })
  })
})
