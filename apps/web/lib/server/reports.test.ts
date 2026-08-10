// @vitest-environment node

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  discoverReports,
  findReport,
  type ReportResourceError,
  readReport,
  resolveReportResource,
} from './reports'

const roots: string[] = []

async function makeReportsDir(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'memon-web-reports-'))
  roots.push(root)
  const reports = join(root, 'docs', 'reports')
  await fs.mkdir(reports, { recursive: true })
  return reports
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('directory-style reports', () => {
  it('discovers standalone Markdown and bundle README layouts together', async () => {
    const reports = await makeReportsDir()
    await fs.writeFile(join(reports, 'R0001-legacy.md'), '# Legacy report\n', 'utf8')
    await fs.mkdir(join(reports, 'R0002-rich'))
    await fs.writeFile(join(reports, 'R0002-rich', 'README.md'), '# Rich report\n', 'utf8')
    await fs.writeFile(join(reports, 'R0002-rich', 'chart.html'), '<h1>chart</h1>', 'utf8')

    const found = await discoverReports(reports)
    expect(found.map((entry) => [entry.id, entry.slug, entry.format])).toEqual([
      ['R0002', 'rich', 'bundle'],
      ['R0001', 'legacy', 'markdown'],
    ])
    const rich = await readReport(found[0]!)
    expect(rich?.content).toContain('# Rich report')
    expect(rich?.path).toBe(join(reports, 'R0002-rich', 'README.md'))
  })

  it('uses an H1 title first and falls back to frontmatter title', async () => {
    const reports = await makeReportsDir()
    await fs.writeFile(
      join(reports, 'R0001-frontmatter.md'),
      '---\ntitle: Frontmatter only\n---\n\nNarrative without an H1.\n',
      'utf8',
    )
    await fs.mkdir(join(reports, 'R0002-heading'))
    await fs.writeFile(
      join(reports, 'R0002-heading', 'README.md'),
      '---\ntitle: Metadata title\n---\n\n# Visible heading\n',
      'utf8',
    )

    const found = await discoverReports(reports)
    expect(found.map((entry) => [entry.id, entry.title])).toEqual([
      ['R0002', 'Visible heading'],
      ['R0001', 'Frontmatter only'],
    ])
  })

  it('keeps ID collisions visible in the list and resolves detail to the bundle', async () => {
    const reports = await makeReportsDir()
    await fs.writeFile(join(reports, 'R0003-collision.md'), '# Legacy copy\n', 'utf8')
    await fs.mkdir(join(reports, 'R0003-collision'))
    await fs.writeFile(join(reports, 'R0003-collision', 'README.md'), '# Bundle copy\n', 'utf8')

    const found = await discoverReports(reports)
    expect(found.filter((entry) => entry.id === 'R0003')).toHaveLength(2)
    expect((await findReport(reports, 'R0003'))?.format).toBe('bundle')
  })

  it('serves nested bundle resources with the expected MIME type', async () => {
    const reports = await makeReportsDir()
    const bundle = join(reports, 'R0002-rich')
    await fs.mkdir(join(bundle, 'data'), { recursive: true })
    await fs.writeFile(join(bundle, 'README.md'), '# Rich\n', 'utf8')
    await fs.writeFile(join(bundle, 'data', 'metrics.json'), '{"loss":1}', 'utf8')

    const [entry] = await discoverReports(reports)
    const resource = await resolveReportResource(entry!, ['data', 'metrics.json'])
    expect(resource.path).toBe(join(bundle, 'data', 'metrics.json'))
    expect(resource.contentType).toBe('application/json; charset=utf-8')
  })

  it('rejects dot traversal and symlinks escaping the report directory', async () => {
    const reports = await makeReportsDir()
    const bundle = join(reports, 'R0002-rich')
    await fs.mkdir(bundle)
    await fs.writeFile(join(bundle, 'README.md'), '# Rich\n', 'utf8')
    const outside = join(reports, 'private.json')
    await fs.writeFile(outside, '{"secret":true}', 'utf8')
    await fs.symlink(outside, join(bundle, 'leak.json'))
    const [entry] = await discoverReports(reports)

    await expect(resolveReportResource(entry!, ['..', 'private.json'])).rejects.toMatchObject({
      code: 'BAD_PATH',
    } satisfies Partial<ReportResourceError>)
    await expect(resolveReportResource(entry!, ['%2e%2e', 'private.json'])).rejects.toMatchObject({
      code: 'BAD_PATH',
    } satisfies Partial<ReportResourceError>)
    await expect(
      resolveReportResource(entry!, ['%252e%252e', 'private.json']),
    ).rejects.toMatchObject({
      code: 'BAD_PATH',
    } satisfies Partial<ReportResourceError>)
    await expect(resolveReportResource(entry!, ['leak.json'])).rejects.toMatchObject({
      code: 'OUTSIDE_REPORT',
    } satisfies Partial<ReportResourceError>)
  })

  it('does not expose a directory listing or the canonical README through assets', async () => {
    const reports = await makeReportsDir()
    const bundle = join(reports, 'R0002-rich')
    await fs.mkdir(bundle)
    await fs.writeFile(join(bundle, 'README.md'), '# Rich\n', 'utf8')
    const [entry] = await discoverReports(reports)

    await expect(resolveReportResource(entry!, [])).rejects.toMatchObject({ code: 'BAD_PATH' })
    await expect(resolveReportResource(entry!, ['README.md'])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('does not discover a bundle whose README symlink escapes the bundle', async () => {
    const reports = await makeReportsDir()
    const bundle = join(reports, 'R0004-escaped')
    await fs.mkdir(bundle)
    const outside = join(reports, 'private.md')
    await fs.writeFile(outside, '# Private\n', 'utf8')
    await fs.symlink(outside, join(bundle, 'README.md'))

    expect(await discoverReports(reports)).toEqual([])
  })
})
