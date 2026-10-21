import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { parseContent, validContentEntry } from './content.js'
import { discoverWikiPages } from './wiki/discover.js'
import { buildWikiProject } from './wiki/summary.js'

afterEach(removeTempDirs)
describe('content metadata', () => {
  it('keeps source revisions, explicit freshness and extension metadata independent', () => {
    const metadata = {
      type: 'service',
      title: 'Monitor',
      port: 8888,
      category: 'Analysis',
      freshness: 'STALE',
      stale_reason: 'Method superseded, measurements remain valid',
      as_of: '2026-10-01T10:00:00+08:00',
      source_commits: { '.': 'a'.repeat(40) },
      extension: { arbitrary: true },
    }
    const result = parseContent(JSON.stringify(metadata), '/manifest.json')
    expect(result.errors).toEqual([])
    expect(result.metadata).toEqual(metadata)
    expect(result.fields).toMatchObject({
      presentation: 'service',
      servicePort: 8888,
      freshness: 'STALE',
      asOf: metadata.as_of,
      sourceCommits: metadata.source_commits,
    })
    expect(result.body).toBe('')
  })
  it.each([
    '../x',
    '/x',
    'https://host/x',
    '%252e%252e/secret',
    'x\\y',
    'index.html?port=1',
  ])('rejects unsafe entry %s', (entry) => {
    expect(validContentEntry(entry)).toBe(false)
    const result = parseContent(
      JSON.stringify({ type: 'service', title: 'Bad', port: 1234, entry }),
      '/manifest.json',
    )
    expect(result.fields.servicePort).toBeUndefined()
    expect(result.fields.contentError).toBeTruthy()
  })
  it('diagnoses malformed JSON and timezone-free timestamps', () => {
    expect(parseContent('{', '/manifest.json').errors.length).toBeGreaterThan(0)
    expect(
      parseContent(
        JSON.stringify({ type: 'html', title: 'X', as_of: '2026-10-01T12:00:00' }),
        '/manifest.json',
      ).errors.join(),
    ).toContain('offset')
  })
  it('discovers all three presentations with manifest precedence and no legacy status ceremony', async () => {
    const project = await createTempProject({
      wiki: {
        'methods/W0001-map/manifest.json': JSON.stringify({
          type: 'html',
          title: 'Map',
          freshness: 'CURRENT',
        }),
        'methods/W0001-map/README.md': '# supporting explanation',
        'methods/W0001-map/index.html': '<h1>Map</h1>',
        'monitor/W0002-live/manifest.json': JSON.stringify({
          type: 'service',
          title: 'Live',
          port: 8000,
        }),
        'note/W0003-text.md':
          '---\nid: W0003\nkind: note\ntitle: Text\ncreated_at: 2026-10-01T12:00:00+08:00\nupdated_at: 2026-10-01T12:00:00+08:00\n---\nText',
      },
    })
    const pages = await discoverWikiPages(project.root)
    const projection = buildWikiProject(pages, { resolveSourceTargets: false })
    expect(pages).toHaveLength(3)
    expect(projection.byId.get('W0001')).toMatchObject({
      presentation: 'html',
      contentEntry: 'index.html',
      category: 'methods',
      freshness: 'CURRENT',
      stale: false,
      diagnostics: [],
    })
    expect(projection.byId.get('W0002')).toMatchObject({
      presentation: 'service',
      servicePort: 8000,
      diagnostics: [],
    })
  })
  it('preserves explicit freshness when cited source time changes', async () => {
    const project = await createTempProject({
      wiki: {
        'note/W0001-a/manifest.json': JSON.stringify({
          type: 'html',
          title: 'A',
          updated_at: '2026-01-01T00:00:00+08:00',
          freshness: 'CURRENT',
          sources: ['W0002'],
        }),
        'note/W0002-b/manifest.json': JSON.stringify({
          type: 'html',
          title: 'B',
          updated_at: '2026-10-01T00:00:00+08:00',
        }),
      },
    })
    const projection = buildWikiProject(await discoverWikiPages(project.root), {
      experiments: [],
      runs: [],
    })
    expect(projection.byId.get('W0001')?.stale).toBe(false)
  })
})
