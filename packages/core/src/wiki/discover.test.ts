import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { discoverWikiPages } from './discover.js'

let root: string

async function write(relative: string, content: string): Promise<void> {
  const target = path.join(root, relative)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content, 'utf8')
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'memon-wiki-discover-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('discoverWikiPages', () => {
  it('returns an empty list when docs/wiki is missing', async () => {
    expect(await discoverWikiPages(root)).toEqual([])
  })

  it('discovers both forms, tolerates an unknown kind, and ignores everything else', async () => {
    await write('docs/wiki/finding/W0003-vsa-debt.md', '---\nid: W0003\n---\nbody\n')
    await write('docs/wiki/showcase/W0004-kernel-map/README.md', '---\nid: W0004\n---\nmap\n')
    await write('docs/wiki/showcase/W0004-kernel-map/views/map/index.html', '<html></html>')
    await write('docs/wiki/retro/W0005-sprint-3.md', '---\nid: W0005\n---\nretro\n')
    // Ignored: loose file at depth 1, a non-matching name, a nested page.
    await write('docs/wiki/README.md', 'index\n')
    await write('docs/wiki/note/scratch.md', 'no id prefix\n')
    await write('docs/wiki/note/W0006-alpha/notes/README.md', 'too deep\n')

    const pages = await discoverWikiPages(root)
    expect(pages.map((page) => [page.id, page.kind, page.format, page.path])).toEqual([
      ['W0003', 'finding', 'markdown', 'docs/wiki/finding/W0003-vsa-debt.md'],
      ['W0005', 'retro', 'markdown', 'docs/wiki/retro/W0005-sprint-3.md'],
      ['W0004', 'showcase', 'bundle', 'docs/wiki/showcase/W0004-kernel-map/README.md'],
    ])
  })

  it('lists bundle assets and carries the README content and mtime', async () => {
    await write('docs/wiki/showcase/W0004-kernel-map/README.md', 'readme\n')
    await write('docs/wiki/showcase/W0004-kernel-map/data/fid.csv', 'step,fid\n')
    await write('docs/wiki/showcase/W0004-kernel-map/views/map/index.html', '<html></html>')

    const [page] = await discoverWikiPages(root)
    expect(page?.content).toBe('readme\n')
    expect(page?.mtime).toBeGreaterThan(0)
    expect(page?.assets).toEqual(['README.md', 'data/fid.csv', 'views/map/index.html'])
    expect(page?.bundleMtime).toBeGreaterThanOrEqual(page!.mtime)
  })

  it('skips a bundle directory that has no README.md', async () => {
    await write('docs/wiki/note/W0007-empty/data/x.json', '{}')
    expect(await discoverWikiPages(root)).toEqual([])
  })
})
