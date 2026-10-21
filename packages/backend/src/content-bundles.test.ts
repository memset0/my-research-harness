import {
  BackendReportResponseSchema,
  BackendReportsResponseSchema,
  BackendWikiDocumentSchema,
  BackendWikiWriteResponseSchema,
  type ProjectConfig,
} from '@memon/core'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { FilesystemDocumentService } from './document-service.js'
import { FilesystemStreamService } from './stream-service.js'

afterEach(removeTempDirs)
async function fixture() {
  const raw = JSON.stringify({
    type: 'html',
    title: 'Analysis',
    category: 'quality',
    freshness: 'STALE',
    stale_reason: 'A newer method exists',
    as_of: '2026-10-01T12:00:00+08:00',
    source_commits: { '.': 'b'.repeat(40) },
    extension: { chart: 'free' },
  })
  const project = await createTempProject({
    files: {
      'docs/reports/quality/R0001-analysis/manifest.json': raw,
      'docs/reports/quality/R0001-analysis/index.html': '<h1>Analysis</h1>',
      'docs/reports/methods/R0002-summary.md': '# Summary\n',
      'docs/wiki/quality/W0001-analysis/manifest.json': raw,
      'docs/wiki/quality/W0001-analysis/index.html': '<h1>Analysis</h1>',
      'docs/wiki/monitor/W0002-live/manifest.json': JSON.stringify({
        type: 'service',
        title: 'Live',
        port: 8123,
      }),
    },
  })
  const config: ProjectConfig = { name: 'project-a', root: project.root, include: [], exclude: [] }
  return {
    project,
    raw,
    documents: new FilesystemDocumentService([config]),
    streams: new FilesystemStreamService([config]),
  }
}

describe('manifest documents', () => {
  it('lists categorized Reports and reads exact JSON bytes with shared fields', async () => {
    const { documents, raw } = await fixture()
    const reports = BackendReportsResponseSchema.parse(
      await documents.listReports('project-a'),
    ).reports
    expect(reports).toHaveLength(2)
    expect(reports.find((report) => report.id === 'R0001')).toMatchObject({
      presentation: 'html',
      category: 'quality',
      freshness: 'STALE',
    })
    expect(reports.find((report) => report.id === 'R0002')).toMatchObject({
      presentation: 'markdown',
      category: 'methods',
    })
    expect(
      BackendReportResponseSchema.parse(await documents.getReport('project-a', 'R0001')).content,
    ).toBe(raw)
    expect(
      BackendWikiDocumentSchema.parse(await documents.getWiki('project-a', 'W0001')).content,
    ).toBe(raw)
    expect(await documents.getContentPresentation('project-a', 'wiki', 'W0002')).toMatchObject({
      servicePort: 8123,
    })
  })
  it('locks manifest writes and preserves extensions while validating targets', async () => {
    const { documents } = await fixture()
    const page = BackendWikiDocumentSchema.parse(await documents.getWiki('project-a', 'W0001'))
    const next = { ...JSON.parse(page.content), title: 'Updated' }
    const result = BackendWikiWriteResponseSchema.parse(
      await documents.putWiki('project-a', 'W0001', {
        content: JSON.stringify(next),
        expectedMtime: page.mtime,
        expectedHash: page.hash,
      }),
    )
    expect(JSON.parse(result.page.content).extension).toEqual({ chart: 'free' })
    expect(JSON.parse(result.page.content).updated_at).toMatch(/[+-]\d\d:\d\d$/)
    expect(
      await documents.putWiki('project-a', 'W0001', {
        content: page.content,
        expectedMtime: page.mtime,
        expectedHash: page.hash,
      }),
    ).toHaveProperty('error.code', 'CONFLICT')
    await expect(
      documents.putWiki('project-a', 'W0001', {
        content: JSON.stringify({ type: 'service', title: 'Bad', port: 70000 }),
        expectedMtime: result.page.mtime,
        expectedHash: result.page.hash,
      }),
    ).rejects.toThrow('port')
  })
  it('serves classified bundle assets and rejects escaping resources', async () => {
    const { streams } = await fixture()
    const asset = await streams.resolveReportAsset('project-a', 'R0001', 'index.html')
    expect(asset.contentType).toBe('text/html; charset=utf-8')
    await streams.closeByteResource?.(asset)
    await expect(
      streams.resolveReportAsset('project-a', 'R0001', '../manifest.json'),
    ).rejects.toThrow()
  })
})
