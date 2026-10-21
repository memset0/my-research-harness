import { describe, expect, it } from 'vitest'
import { type WikiDeleteTarget, wikiDeleteReferences } from './delete-references.js'

const target: WikiDeleteTarget = {
  projectRoot: '/tmp/project-a',
  projectName: 'project-a',
  projectNames: ['registered-a'],
  otherProjectNames: ['project-b'],
  host: null,
  origins: ['http://localhost:3737'],
  id: 'W0001',
  slug: 'alpha',
  legacyId: 'R0007',
  reportIds: [],
  ownedPaths: ['/tmp/project-a/docs/wiki/note/W0001-alpha'],
}
const scan = (text: string, source = 'README.md', overrides: Partial<WikiDeleteTarget> = {}) =>
  wikiDeleteReferences(text, source, { ...target, ...overrides })

// Pure resolver tests: no project files, services, generators or Git state are created.
describe('wiki deletion static references', () => {
  it.each([
    '@W0001',
    '@alpha',
    '[page](@W0001)',
    '[page](@alpha)',
    'W0001',
    '@R0007',
    'R0007',
  ])('recognizes %s', (text) => {
    expect(scan(text)).toHaveLength(1)
  })

  it('reports actual source line and column after frontmatter and multiline paragraphs', () => {
    const text = '---\ntitle: Other\n---\nfirst line\nsecond W0001\n'
    expect(scan(text)).toEqual([{ source: 'README.md', line: 5, column: 8, reference: 'W0001' }])
  })

  it.each([
    'W0001-other',
    'xW0001',
    'W00010',
    'W0001_suffix',
    '`@W0001`',
    '    @W0001',
    '```markdown\n[page](@W0001)\n```',
    '$W0001$',
    '$$\nW0001\n$$',
    '<span>W0001</span>',
    '<code>@W0001</code>',
    '[W0001](https://example.test/elsewhere)',
    'https://example.test/W0001',
    'mail@alpha.example',
    '[download](alpha)',
    '[file](W0001)',
    '<!-- @W0001 -->',
  ])('ignores examples, unrelated identifiers and opaque text: %s', (text) => {
    expect(scan(text)).toEqual([])
  })

  it('checks used reference definitions but not unused definitions', () => {
    expect(scan('[item][ref]\n\n[ref]: @W0001')).toHaveLength(1)
    expect(scan('[ref]: @W0001')).toEqual([])
  })

  it('finds links in GFM tables and autolink URLs', () => {
    expect(scan('| x |\n|---|\n| W0001 |')).toHaveLength(1)
    expect(scan('http://localhost:3737/p/project-a/wiki/W0001')).toHaveLength(1)
  })

  it('resolves paths from the source document, including assets and encoded names', () => {
    expect(
      scan(
        '[asset](../../wiki/note/W0001-alpha/image.svg?size=2#x)',
        'docs/experiments/E0001-demo/README.md',
      ),
    ).toHaveLength(1)
    expect(scan('[page](docs/wiki/note/W0001-alpha/README.md#answer)')).toHaveLength(1)
    expect(scan('[page](/docs/wiki/note/W0001-alpha/README.md)')).toHaveLength(1)
    expect(scan('[asset](docs/wiki/note/%570001-alpha/image.svg)')).toHaveLength(1)
    expect(scan('[other](docs/wiki/note/W0001-alpha-other/README.md)')).toEqual([])
  })

  it.each([
    '/p/project-a/wiki/W0001',
    '/p/registered-a/wiki/alpha',
    '/p/project-a/e/E0001-demo?wiki=W0001&wikiSurface=drawer',
    '?wiki=W0001',
    '/api/wiki/W0001?project=project-a',
    '/api/wiki-assets/project-a/W0001/image.svg',
    '/api/doc-assets/project-a/docs/wiki/note/W0001-alpha/image.svg',
    '/api/content-assets/-/project-a/wiki/W0001/image.svg',
    '/api/content-services/-/project-a/wiki/W0001/',
    '/api/content-health/-/project-a/wiki/W0001',
  ])('recognizes current-project route %s', (href) => {
    const refs = scan(`[link](${href})`)
    expect(refs).toHaveLength(1)
    expect(refs[0]!.ambiguous).toBeUndefined()
  })

  it.each([
    '/p/project-b/wiki/W0001',
    '/h/host-b/p/project-a/wiki/W0001',
    '/api/wiki-assets/project-b/W0001/image.svg',
    '/api/content-assets/host-b/project-a/wiki/W0001/a.svg',
    '/api/content-services/-/project-b/wiki/W0001/',
    '/api/content-assets/-/project-a/report/W0001/a.svg',
    'https://example.test/p/project-a/wiki/W0001',
    '/p/project-a/wiki/W0001/unknown',
    '/p/project-a/wiki/W0002?wiki=W0001',
  ])('ignores a known different scope or unsupported route %s', (href) => {
    expect(scan(`[link](${href})`)).toEqual([])
  })

  it('fails closed with the offending location when deployment scope is unknown', () => {
    for (const href of [
      '/h/host-a/p/project-a/wiki/W0001',
      'https://unknown.test/p/project-a/wiki/W0001',
      '/p/unknown-name/wiki/W0001',
    ]) {
      expect(
        scan(`[link](${href})`, 'docs/details.md', { host: undefined, origins: undefined })[0],
      ).toMatchObject({
        source: 'docs/details.md',
        line: 1,
        ambiguous: expect.stringMatching(/Cannot establish/),
      })
    }
  })

  it('resolves mapped hosted routes', () => {
    expect(
      scan('[link](/h/host-a/p/registered-a/wiki/W0001)', 'README.md', { host: 'host-a' }),
    ).toHaveLength(1)
    expect(scan('[link](/p/project-a/wiki/W0001)', 'README.md', { host: 'host-a' })).toEqual([])
    expect(
      scan('[link](/api/content-assets/-/project-a/wiki/W0001/a.svg)', 'README.md', {
        host: 'host-a',
      }),
    ).toEqual([])
  })

  it('gives a real Report precedence over legacy Wiki identity and paths', () => {
    for (const text of [
      'R0007',
      '@R0007',
      '[old](docs/reports/R0007-summary.md)',
      '[old](/p/project-a/reports/R0007)',
    ]) {
      expect(scan(text)).toHaveLength(1)
      expect(scan(text, 'README.md', { reportIds: ['R0007'] })).toEqual([])
    }
  })

  it('reads frontmatter, nested manifests and YAML aliases with field locations', () => {
    expect(scan('---\nsources: [W0001]\n---\nbody')[0]).toMatchObject({
      line: 2,
      field: 'sources[0]',
      reference: 'W0001',
    })
    const aliases = scan('---\nall_refs: &refs [W0001]\nsources: *refs\n---\nbody')
    expect(aliases).toHaveLength(1)
    expect(aliases[0]).toMatchObject({ line: 3, field: 'sources[0]' })
    expect(
      scan('{"nested":{"references":["@alpha"]}}', 'docs/reports/R0001/manifest.json')[0],
    ).toMatchObject({ field: 'nested.references[0]' })
    expect(scan('---\ndeprecated:\n  superseded_by: W0001\n---\nbody')[0]).toMatchObject({
      field: 'deprecated.superseded_by',
      line: 3,
    })
  })

  it('reads Run imported Markdown without treating ordinary parameter strings as identities', () => {
    const refs = scan(
      JSON.stringify({
        params: { label: 'W0001' },
        legacy_sections: [{ title: 'Old', body: '[evidence](@W0001)' }],
      }),
      'logs/E0002/V0001/run-a/run.json',
    )
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      field: 'legacy_sections[0].body',
      reference: '@W0001',
      line: 1,
    })
  })

  it('finds component HTML in html, yaml and json forms, excluding executable code', () => {
    const href = '/api/wiki-assets/project-a/W0001/chart.html'
    for (const body of [
      `\`\`\`html embed@1 #view\n<a href="${href}">Open</a>\n\`\`\``,
      `\`\`\`yaml embed@1 #view\ndata: '<a href="${href}">Open</a>'\n\`\`\``,
      `\`\`\`json embed@1 #view\n${JSON.stringify({ data: `<a href="${href}">Open</a>` })}\n\`\`\``,
    ])
      expect(scan(body)).toHaveLength(1)
    expect(
      scan('```yaml figure@1 #plot\nimage: docs/wiki/note/W0001-alpha/plot.svg\n```'),
    ).toHaveLength(1)
    expect(scan('```python\npage = "@W0001"\n```')).toEqual([])
  })

  it('parses actual HTML attributes, entities, script sources, SVG and inline styles', () => {
    const html =
      '<!-- <a href="/p/project-a/wiki/W0001"> -->\n<script src="/api/wiki-assets/project-a/W0001/view.js">const dynamic = "W0001";</script>\n<a data-other=">" href="&sol;p&sol;project-a&sol;wiki&sol;W0001">Open</a>\n<img srcset="/api/wiki-assets/project-a/W0001/a.svg 1x, /api/wiki-assets/project-a/W0001/b.svg 2x">\n<div style="background:url(/api/wiki-assets/project-a/W0001/bg.svg)"></div>'
    const refs = scan(html, 'docs/reports/R0001/index.html')
    expect(refs).toHaveLength(5)
    expect(refs[0]).toMatchObject({ line: 2, field: 'src' })
    expect(
      scan(
        '<svg><use href="/api/wiki-assets/project-a/W0001/icons.svg#ok"/></svg>',
        'docs/diagram.svg',
      ),
    ).toHaveLength(1)
    expect(
      scan('<pre><a href="/p/project-a/wiki/W0001">Open</a></pre>', 'docs/report.html'),
    ).toHaveLength(1)
    expect(scan('<a href="@W0001">Literal relative URL</a>', 'docs/report.html')).toEqual([])
  })

  it('respects an HTML base URL for relative assets', () => {
    expect(
      scan(
        '<base href="/api/wiki-assets/project-a/W0001/"><img src="plot.svg">',
        'docs/reports/R0001/index.html',
      ),
    ).toHaveLength(2)
    expect(
      scan(
        '<base href="https://example.test/"><a href="/p/project-a/wiki/W0001">Other site</a>',
        'docs/reports/R0001/index.html',
      ),
    ).toEqual([])
  })

  it('reads CSS dependencies but skips comments and quoted examples', () => {
    const css =
      '/* url(/api/wiki-assets/project-a/W0001/old.svg) */\n@import "/api/wiki-assets/project-a/W0001/theme.css";\nx{background:url(/api/wiki-assets/project-a/W0001/image.svg)}\nx::before{content:"url(/api/wiki-assets/project-a/W0001/example.svg)"}'
    expect(scan(css, 'docs/view.css')).toHaveLength(2)
    expect(scan(`<style>${css}</style>`, 'docs/view.html')).toHaveLength(2)
  })

  it('does not inspect arbitrary JavaScript or execute generators', () => {
    expect(
      scan('<script>const id="W0001";fetch("/p/project-a/wiki/"+id)</script>', 'docs/view.html'),
    ).toEqual([])
    expect(
      scan('```yaml embed@1 #view\ncode: |\n  def render():\n    return {"data": "@W0001"}\n```'),
    ).toEqual([])
    expect(scan('```yaml unknown@1 #example\nsources: [W0001]\n```')).toEqual([])
    expect(
      scan('```yaml figure@99 #example\nimage: docs/wiki/note/W0001-alpha/a.svg\n```'),
    ).toEqual([])
  })

  it('protects a declared component script asset without inspecting or executing its code', () => {
    expect(
      scan(
        '```yaml datatable@1 #metrics\nscript: docs/wiki/note/W0001-alpha/collect.py::collect\n```',
      ),
    ).toHaveLength(1)
  })

  it('rejects malformed metadata and cycles rather than claiming no references', () => {
    expect(() => scan('sources: [', 'docs/manifest.yaml')).toThrow(/unreadable metadata/)
    expect(() => scan('{"sources":[],}', 'docs/manifest.json')).toThrow(/unreadable JSON/)
    expect(() => scan('x: &x {sources: *x}', 'docs/manifest.yaml')).toThrow(/cyclic/)
  })

  it('excludes references owned by the removed bundle', () => {
    expect(scan('@W0001', 'docs/wiki/note/W0001-alpha/README.md')).toEqual([])
    expect(scan('sources: [W0001]', 'docs/wiki/note/W0001-alpha/manifest.json')).toEqual([])
  })
})
