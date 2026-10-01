import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BackendJournalCountResponseSchema,
  BackendResourceInventoryResponseSchema,
  BackendWikiInventoryResponseSchema,
  projectFs,
} from '@memon/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FilesystemDocumentService } from './document-service.js'
import { FilesystemProjectService } from './project-service.js'
import { CENTRAL_READ_POLICY, dropProjectReadIndexes } from './read-index.js'
import { withRequestScope } from './request-scope.js'

let root: string
let outside: string

beforeEach(async () => {
  dropProjectReadIndexes()
  root = await fs.mkdtemp(join(tmpdir(), 'memon-indexed-docs-'))
  outside = await fs.mkdtemp(join(tmpdir(), 'memon-indexed-docs-outside-'))
  const write = async (path: string, content: string) => {
    await fs.mkdir(join(root, path, '..'), { recursive: true })
    await fs.writeFile(join(root, path), content)
  }
  await write('docs/wiki/finding/W0001-alpha.md', '---\nid: W0001\nkind: finding\n---\n# A\n')
  await write(
    'docs/wiki/note/W0002-beta/README.md',
    '---\nid: W0002\nkind: note\nlegacy_id: R0007\n---\n# B\n',
  )
  await write('docs/wiki/note/W0002-beta/figure.svg', '<svg/>')
  await write('docs/code-review/2026-09-01-flat.md', '---\ntitle: Flat\n---\n')
  await write('docs/experiments/E0001-a/code-review/2026-09-02-scoped.md', '---\ntitle: S\n---\n')
  await write('docs/experiments/E0002-b/README.md', '---\nid: E0002-b\n---\n')
  await write('docs/reports/R0001-first.md', '# First\n')
  await write('docs/journal.md', '# Journal\n')
  await fs.mkdir(join(outside, 'code-review'), { recursive: true })
  await fs.writeFile(join(outside, 'code-review', '2026-09-03-escape.md'), '---\ntitle: X\n---\n')
  await fs.symlink(outside, join(root, 'docs', 'experiments', 'E0003-c'))
  await fs.mkdir(join(root, 'docs', 'experiments', 'E0004-d'), { recursive: true })
  await fs.symlink(join(outside, 'code-review'), join(root, 'docs/experiments/E0004-d/code-review'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  dropProjectReadIndexes()
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(outside, { recursive: true, force: true })
})

const project = () => ({ name: 'p', root, include: [], exclude: [] })

describe('readdir-only inventories', () => {
  it('serves the wiki inventory without re-reading page bodies when warm', async () => {
    const documents = new FilesystemDocumentService([project()])
    const first = BackendWikiInventoryResponseSchema.parse(
      await documents.listWiki('p', { inventoryOnly: true }),
    )
    expect(first.pages).toEqual([
      { id: 'W0001', resource: 'docs/wiki/finding/W0001-alpha.md', legacyId: null },
      { id: 'W0002', resource: 'docs/wiki/note/W0002-beta/README.md', legacyId: 'R0007' },
    ])
    const readFile = vi.spyOn(projectFs, 'readFile')
    await documents.listWiki('p', { inventoryOnly: true })
    expect(readFile).not.toHaveBeenCalled()
  })

  it('touches nothing inside the central list window', async () => {
    const documents = new FilesystemDocumentService([project()], {
      readPolicy: CENTRAL_READ_POLICY,
    })
    await documents.listWiki('p', { inventoryOnly: true })
    await documents.listCodeReviews('p', { inventoryOnly: true })
    const calls = [
      vi.spyOn(projectFs, 'readFile'),
      vi.spyOn(projectFs, 'readdir'),
      vi.spyOn(projectFs, 'stat'),
    ]
    const realpath = vi.spyOn(projectFs, 'realpath')
    await withRequestScope(async () => {
      await documents.listWiki('p', { inventoryOnly: true })
      await documents.listCodeReviews('p', { inventoryOnly: true })
    })
    for (const call of calls) expect(call).not.toHaveBeenCalled()
    // Only the per-request Project root resolution remains.
    expect(realpath.mock.calls).toEqual([[root]])
  })

  it('lists contained code reviews and ignores symlinks that leave the Project', async () => {
    const documents = new FilesystemDocumentService([project()])
    const inventory = BackendResourceInventoryResponseSchema.parse(
      await documents.listCodeReviews('p', { inventoryOnly: true }),
    )
    expect(inventory.items.map((item) => item.id)).toEqual([
      'experiments/E0001-a/code-review/2026-09-02-scoped',
      'code-review/2026-09-01-flat',
    ])
  })

  it('lists Reports and counts Journal events once per fingerprint', async () => {
    const documents = new FilesystemDocumentService([project()])
    const reports = BackendResourceInventoryResponseSchema.parse(
      await documents.listReports('p', { inventoryOnly: true }),
    )
    expect(reports.items.map((item) => item.id)).toEqual(['R0001'])
    const service = new FilesystemProjectService([project()])
    expect(BackendJournalCountResponseSchema.parse(await service.getJournalCount('p'))).toEqual({
      totalEvents: 0,
    })
    const readFile = vi.spyOn(projectFs, 'readFile')
    await service.getJournalCount('p')
    expect(readFile).not.toHaveBeenCalled()
  })
})
