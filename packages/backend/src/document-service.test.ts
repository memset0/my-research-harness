import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BackendCodeReviewPatchResponseSchema,
  BackendCodeReviewResponseSchema,
  BackendCodeReviewsResponseSchema,
  BackendDocumentConflictResponseSchema,
  BackendDocumentWriteResponseSchema,
  BackendReadmeResponseSchema,
  BackendReportResponseSchema,
  BackendReportsResponseSchema,
  BackendResourceInventoryResponseSchema,
  type ProjectConfig,
} from '@memon/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type BackendDocumentServiceError, FilesystemDocumentService } from './document-service.js'

const CODE_REVIEW = `---
title: Review fixture
description: Review a change
experiment: null
created_at: 2026-08-26T00:00:00Z
updated_at: 2026-08-26T00:00:00Z
commits:
  - repo: .
    sha: abc123
    url: https://example.test/commit/abc123
    reviewed: false
review_todolist:
  - item: verify behavior
    done: false
---

# Review fixture
`

let root = ''
let service: FilesystemDocumentService

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-backend-documents-'))
  await Promise.all([
    fs.mkdir(join(root, 'docs', 'reports', 'R0002-bundle'), { recursive: true }),
    fs.mkdir(join(root, 'docs', 'digests'), { recursive: true }),
    fs.mkdir(join(root, 'docs', 'code-review'), { recursive: true }),
    fs.mkdir(join(root, 'logs', 'run-one'), { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(join(root, 'docs', 'reports', 'R0001-report.md'), '# Report one\n'),
    fs.writeFile(join(root, 'docs', 'reports', 'R0002-bundle', 'README.md'), '# Bundle two\n'),
    fs.writeFile(join(root, 'docs', 'digests', 'D0001-2026-08-26.md'), '# Digest one\n'),
    fs.writeFile(join(root, 'docs', 'code-review', '2026-08-26-review.md'), CODE_REVIEW),
    fs.writeFile(join(root, 'logs', 'run-one', 'README.md'), '# Run one\n'),
  ])
  const project = {
    name: 'research',
    root,
    include: [],
    exclude: [],
  } satisfies ProjectConfig
  service = new FilesystemDocumentService([project])
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function expectPathFree(value: unknown): void {
  const serialized = JSON.stringify(value)
  expect(serialized).not.toContain(root)
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item)
      return
    }
    if (!candidate || typeof candidate !== 'object') return
    for (const [key, nested] of Object.entries(candidate)) {
      expect(['path', 'root', 'cwd', 'absolutePath']).not.toContain(key)
      visit(nested)
    }
  }
  visit(value)
}

describe('FilesystemDocumentService', () => {
  it('serves migrated Digest content through ordinary Wiki inventory and detail', async () => {
    await fs.mkdir(join(root, 'docs/wiki/digest'), { recursive: true })
    const content =
      '---\nid: W0001\nkind: digest\nlegacy_id: D0001\ntitle: Period summary\n---\n# Preserved summary\n'
    await fs.writeFile(join(root, 'docs/wiki/digest/W0001-period.md'), content)
    const inventory = await service.listWiki('research', { inventoryOnly: true })
    expect(inventory).toEqual({
      pages: [{ id: 'W0001', resource: 'docs/wiki/digest/W0001-period.md', legacyId: 'D0001' }],
    })
    expect(await service.getWiki('research', 'W0001')).toMatchObject({
      content,
      kind: 'digest',
      legacyId: 'D0001',
    })
  })

  it('discovers strict, path-free report, code-review, and README DTOs', async () => {
    const reports = BackendReportsResponseSchema.parse(await service.listReports('research'))
    expect(reports.reports.map((report) => report.id)).toEqual(['R0002', 'R0001'])
    expect(reports.reports[0]?.format).toBe('bundle')
    expect(reports.reports[0]?.resource).toBe('docs/reports/R0002-bundle/README.md')
    const report = BackendReportResponseSchema.parse(await service.getReport('research', 'R0001'))

    const reviews = BackendCodeReviewsResponseSchema.parse(
      await service.listCodeReviews('research'),
    )
    expect(reviews.codeReviews[0]?.id).toBe('code-review/2026-08-26-review')
    const review = BackendCodeReviewResponseSchema.parse(
      await service.getCodeReview('research', 'code-review/2026-08-26-review'),
    )
    const readme = BackendReadmeResponseSchema.parse(
      await service.getReadme('research', 'logs/run-one/README.md'),
    )

    for (const payload of [reports, report, reviews, review, readme]) {
      expectPathFree(payload)
    }
  })

  it('lists document identities from names without parsing their bodies', async () => {
    await fs.writeFile(
      join(root, 'docs', 'code-review', '2026-08-26-review.md'),
      '---\n[unterminated\n---\n',
    )

    const reports = BackendResourceInventoryResponseSchema.parse(
      await service.listReports('research', { inventoryOnly: true }),
    )
    const reviews = BackendResourceInventoryResponseSchema.parse(
      await service.listCodeReviews('research', { inventoryOnly: true }),
    )

    expect(reports.items).toEqual([
      {
        id: 'R0002',
        slug: 'bundle',
        resource: 'docs/reports/R0002-bundle/README.md',
      },
      {
        id: 'R0001',
        slug: 'report',
        resource: 'docs/reports/R0001-report.md',
      },
    ])
    expect(reviews.items).toEqual([
      {
        id: 'code-review/2026-08-26-review',
        slug: 'review',
        resource: 'docs/code-review/2026-08-26-review.md',
      },
    ])
    expect(
      BackendCodeReviewsResponseSchema.parse(await service.listCodeReviews('research')).codeReviews,
    ).toEqual([])
  })

  it('uses both mtime and hash for optimistic document writes', async () => {
    const report = BackendReportResponseSchema.parse(await service.getReport('research', 'R0001'))
    const conflict = BackendDocumentConflictResponseSchema.parse(
      await service.putReport('research', 'R0001', {
        content: '# stale write\n',
        expectedMtime: report.mtime + 1,
        expectedHash: report.hash,
      }),
    )
    expect(conflict.currentHash).toBe(report.hash)
    expect(conflict).not.toHaveProperty('currentContent')

    BackendDocumentWriteResponseSchema.parse(
      await service.putReport('research', 'R0001', {
        content: '# Updated report\n',
        expectedMtime: report.mtime,
        expectedHash: report.hash,
      }),
    )
    expect(
      BackendReportResponseSchema.parse(await service.getReport('research', 'R0001')).content,
    ).toBe('# Updated report\n')

    // Standalone Digest methods are retired.
    expect('putDigest' in service).toBe(false)

    const readme = BackendReadmeResponseSchema.parse(
      await service.getReadme('research', 'logs/run-one/README.md'),
    )
    BackendDocumentWriteResponseSchema.parse(
      await service.putReadme('research', 'logs/run-one/README.md', {
        content: '# Updated run\n',
        expectedMtime: readme.mtime,
        expectedHash: readme.hash,
      }),
    )
  })

  it('patches code-review progress with the same optimistic lock', async () => {
    const before = BackendCodeReviewResponseSchema.parse(
      await service.getCodeReview('research', 'code-review/2026-08-26-review'),
    )
    BackendCodeReviewPatchResponseSchema.parse(
      await service.patchCodeReview('research', 'code-review/2026-08-26-review', {
        op: 'commit',
        sha: 'abc123',
        reviewed: true,
        expectedMtime: before.mtime,
        expectedHash: before.hash,
      }),
    )
    const after = BackendCodeReviewResponseSchema.parse(
      await service.getCodeReview('research', 'code-review/2026-08-26-review'),
    )
    expect(after.frontmatter.commits[0]?.reviewed).toBe(true)
    expect(String(after.frontmatter.updatedAt)).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    )
    BackendDocumentConflictResponseSchema.parse(
      await service.patchCodeReview('research', 'code-review/2026-08-26-review', {
        op: 'todo',
        index: 0,
        done: true,
        expectedMtime: before.mtime,
        expectedHash: before.hash,
      }),
    )
  })

  it('rejects non-README resources and traversal, and omits an escaping symlink', async () => {
    await fs.symlink('/etc/hostname', join(root, 'docs', 'digests', 'D0002-2026-08-27.md'))
    await expect(service.getReadme('research', '../outside/README.md')).rejects.toMatchObject({
      code: 'INVALID_RESOURCE',
    } satisfies Partial<BackendDocumentServiceError>)
    await expect(
      service.getReadme('research', 'docs/digests/D0001-2026-08-26.md'),
    ).rejects.toMatchObject({
      code: 'INVALID_RESOURCE',
    } satisfies Partial<BackendDocumentServiceError>)
  })

  it('fails closed instead of selecting the first duplicate resource ID', async () => {
    await fs.writeFile(join(root, 'docs', 'reports', 'R0001-second.md'), '# Duplicate\n')
    await expect(service.getReport('research', 'R0001')).rejects.toMatchObject({
      code: 'AMBIGUOUS_RESOURCE',
    } satisfies Partial<BackendDocumentServiceError>)
  })
})
