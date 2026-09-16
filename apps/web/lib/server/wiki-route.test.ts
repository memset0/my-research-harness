// @vitest-environment node

import type { WikiSummary } from '@memon/core'
import { describe, expect, it } from 'vitest'
import { wikiComponentProjection, wikiPageDto } from './wiki-route'

const FRONTMATTER = [
  '---',
  'id: W0004',
  'kind: note',
  'title: Note',
  'created_at: 2026-05-01T10:00:00+08:00',
  'updated_at: 2026-05-01T10:00:00+08:00',
  '---',
]

function page(...body: string[]): string {
  return [...FRONTMATTER, '', ...body, ''].join('\n')
}

/** Full-file line of the first line containing `needle`, 1-based. */
function lineOf(content: string, needle: string): number {
  return content.split('\n').findIndex((line) => line.includes(needle)) + 1
}

function summary(diagnostics: WikiSummary['diagnostics'] = []): WikiSummary {
  return {
    id: 'W0004',
    slug: 'note',
    kind: 'note',
    title: 'Note',
    description: null,
    status: null,
    date: null,
    tags: [],
    sources: [],
    legacyId: null,
    entry: null,
    deprecated: null,
    deprecatedSections: [],
    stale: false,
    staleSources: [],
    review: null,
    format: 'markdown',
    path: 'docs/wiki/note/W0004-note.md',
    mtime: 1,
    createdAt: '2026-05-01T10:00:00+08:00',
    updatedAt: '2026-05-01T10:00:00+08:00',
    diagnostics,
  }
}

describe('wikiComponentProjection', () => {
  it('reports resolved blocks and diagnostics in full-file line coordinates', () => {
    const content = page(
      '# Note',
      '',
      '```yaml datatable@1 #metrics',
      'columns: [step, loss]',
      'data: [[1, 0.5]]',
      '```',
      '',
      '```yaml datatable',
      'columns: [step]',
      'data: [[1]]',
      '```',
    )
    const projection = wikiComponentProjection(content)

    expect(projection.components).toEqual([
      {
        index: 0,
        type: 'datatable',
        version: 1,
        pinnedVersion: 1,
        latestVersion: 1,
        outdated: false,
        id: 'metrics',
        executable: false,
        line: lineOf(content, 'datatable@1 #metrics'),
      },
      {
        index: 1,
        type: 'datatable',
        version: 1,
        pinnedVersion: null,
        latestVersion: 1,
        outdated: false,
        id: null,
        executable: false,
        line: lineOf(content, 'columns: [step]') - 1,
      },
    ])
    expect(projection.diagnostics).toEqual([
      {
        code: 'WIKI_COMPONENT_UNPINNED',
        severity: 'warn',
        message: expect.stringContaining('datatable@1'),
        line: lineOf(content, 'columns: [step]') - 1,
      },
    ])
  })

  it('excludes a block whose version cannot be resolved but keeps its diagnostic', () => {
    const content = page('```yaml nosuchcomponent@1 #x', 'a: 1', '```')
    const projection = wikiComponentProjection(content)

    expect(projection.components).toEqual([])
    expect(projection.diagnostics).toEqual([
      {
        code: 'WIKI_COMPONENT_INVALID',
        severity: 'error',
        message: expect.stringContaining('not registered'),
        line: lineOf(content, 'nosuchcomponent@1'),
      },
    ])
  })

  it('marks an executable block and reports a duplicate id at the second block', () => {
    const content = page(
      '```yaml datatable@1 #fid',
      'code: |',
      '  def collect():',
      '      return {}',
      '```',
      '',
      '```yaml datatable@1 #fid',
      'columns: [step]',
      'data: [[1]]',
      '```',
    )
    const projection = wikiComponentProjection(content)

    expect(projection.components.map((component) => component.executable)).toEqual([true, false])
    expect(projection.diagnostics).toEqual([
      {
        code: 'COMPONENT_ID_DUPLICATE',
        severity: 'error',
        message: expect.stringContaining('`fid`'),
        line: lineOf(content, 'columns: [step]') - 1,
      },
    ])
  })

  it('ignores an ordinary fenced code block', () => {
    expect(wikiComponentProjection(page('```python', 'print(1)', '```'))).toEqual({
      components: [],
      diagnostics: [],
    })
  })
})

describe('wikiPageDto', () => {
  it('appends component diagnostics after the structural ones', () => {
    const content = page('```yaml datatable', 'columns: [step]', 'data: [[1]]', '```')
    const structural = { code: 'WIKI_SOURCE_UNRESOLVED', severity: 'warn' as const, message: 'x' }
    const dto = wikiPageDto('project-a', summary([structural]), content, 'a'.repeat(40))

    expect(dto.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'WIKI_SOURCE_UNRESOLVED',
      'WIKI_COMPONENT_UNPINNED',
    ])
    expect(dto).toMatchObject({
      project: 'project-a',
      resource: 'docs/wiki/note/W0004-note.md',
      content,
      hash: 'a'.repeat(40),
    })
    expect(dto.components).toHaveLength(1)
  })
})
