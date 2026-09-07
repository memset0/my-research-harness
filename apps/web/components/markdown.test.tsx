import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactInventory, ArtifactTarget } from '../lib/artifact-links'
import { resolveDocumentResourceUrl } from '../lib/document-resource-url'
import {
  Markdown,
  type MarkdownArtifactLinkContext,
  MarkdownArtifactLinkProvider,
} from './markdown'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('<Markdown> math rendering', () => {
  it('renders inline `$...$` as KaTeX inside the surrounding paragraph', () => {
    const src = 'The loss is $\\mathcal{L}_{KL}$ across heads.'
    const { container } = render(<Markdown>{src}</Markdown>)

    const katex = container.querySelector('.katex')
    expect(katex).not.toBeNull()
    expect(container.querySelector('.katex-display')).toBeNull()

    const paragraph = container.querySelector('p')
    expect(paragraph).not.toBeNull()
    expect(paragraph?.textContent).toMatch(/^The loss is/)
    expect(paragraph?.textContent).toMatch(/across heads\.$/)
    expect(paragraph?.contains(katex!)).toBe(true)
  })

  it('renders a `$$`-fenced block (own-line delimiters) as KaTeX display', () => {
    // Convention per micromark-extension-math flow grammar: `$$` on its own
    // line, formula on the next line(s), `$$` on its own closing line.
    const src = '$$\n\\mathcal{L} = \\sum_i \\mathrm{KL}(p_i \\Vert q_i)\n$$\n'
    const { container } = render(<Markdown>{src}</Markdown>)

    expect(container.querySelector('.katex-display')).not.toBeNull()
    expect(container.querySelector('.katex')).not.toBeNull()
  })

  it('renders single-line `$$x$$` as inline KaTeX (not display)', () => {
    // Single-line `$$...$$` is documented-inline behaviour for the
    // upstream toolchain; we surface it as inline math rather than
    // dropping the dollars or crashing.
    const src = 'Inline: $$\\mathcal{L}$$.'
    const { container } = render(<Markdown>{src}</Markdown>)

    expect(container.querySelector('.katex')).not.toBeNull()
    expect(container.querySelector('.katex-display')).toBeNull()
  })

  it('leaves dollar signs inside fenced code blocks literal', () => {
    const src = '```sh\nexport PRICE=$5\n```\n'
    const { container } = render(<Markdown>{src}</Markdown>)

    const codeBlock = container.querySelector('pre code')
    expect(codeBlock).not.toBeNull()
    expect(codeBlock!.textContent).toContain('export PRICE=$5')
    expect(codeBlock!.querySelector('.katex')).toBeNull()
    expect(codeBlock!.querySelector('.katex-display')).toBeNull()
  })

  it('still renders non-math content (code chips, lists) unchanged', () => {
    const src = 'Inline `code` chip.\n\n- a\n- b\n'
    const { container } = render(<Markdown>{src}</Markdown>)

    const codeChip = container.querySelector('p > code')
    expect(codeChip).not.toBeNull()
    expect(codeChip!.textContent).toBe('code')

    const items = container.querySelectorAll('li')
    expect(items.length).toBe(2)
    expect(items[0]!.textContent).toBe('a')
  })
})

describe('<Markdown> overflow scrolling', () => {
  it('wraps a GFM table in an overflow-x-auto container', () => {
    // 6-column "wide" GFM table — even with short cell content, the
    // wrapper must be present unconditionally so width-driven scroll
    // engages whenever the user's layout is narrower than the table.
    const src = [
      '| c1 | c2 | c3 | c4 | c5 | c6 |',
      '|----|----|----|----|----|----|',
      '| aaaaaaaa | bbbbbbbb | cccccccc | dddddddd | eeeeeeee | ffffffff |',
      '',
    ].join('\n')
    const { container } = render(<Markdown>{src}</Markdown>)

    const table = container.querySelector('table')
    expect(table).not.toBeNull()

    const wrapper = table!.parentElement
    expect(wrapper).not.toBeNull()
    expect(wrapper!.tagName).toBe('DIV')
    expect(wrapper!.className).toMatch(/\boverflow-x-auto\b/)
    expect(wrapper!.className).toMatch(/\bw-full\b/)
    expect(wrapper!.className).toMatch(/\bmy-4\b/)

    // Non-table content remains untouched: a paragraph before the
    // table is not double-wrapped.
    const tableHeaderCell = container.querySelector('th')
    expect(tableHeaderCell?.textContent).toBe('c1')
  })

  it('keeps short tables wrapped (no special-casing)', () => {
    const src = '| a | b |\n|---|---|\n| 1 | 2 |\n'
    const { container } = render(<Markdown>{src}</Markdown>)

    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    const wrapper = table!.parentElement
    expect(wrapper!.className).toMatch(/\boverflow-x-auto\b/)
    expect(container.querySelectorAll('td').length).toBe(2)
  })

  it('renders long fenced-code blocks inside a horizontally-scrollable <pre>', () => {
    // 200-char single-line fence — should not wrap, not truncate, and
    // sit under a markdown root whose class list opts <pre> into
    // overflow-x-auto.
    const longLine = 'a'.repeat(200)
    const src = '```sh\n' + longLine + '\n```\n'
    const { container } = render(<Markdown>{src}</Markdown>)

    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre!.textContent).toContain(longLine)

    // The wrapper opts <pre> into overflow-x-auto via the Tailwind
    // arbitrary-variant `[&_pre]:overflow-x-auto`. Assert that class
    // is present on the <Markdown> root.
    const root = container.firstElementChild
    expect(root).not.toBeNull()
    expect(root!.className).toMatch(/\[&_pre\]:overflow-x-auto/)
  })

  it('puts `min-w-0` on the <Markdown> root', () => {
    const { container } = render(<Markdown>{'plain text'}</Markdown>)
    const root = container.firstElementChild
    expect(root).not.toBeNull()
    expect(root!.className).toMatch(/\bmin-w-0\b/)
  })
})

describe('<Markdown> table of contents', () => {
  it('prepends a linked outline with stable, distinct heading anchors', () => {
    const source = [
      '# Report title',
      '',
      '## Overview',
      '',
      '### **Detailed** results',
      '',
      '## Overview',
      '',
      '#### 结果分析',
    ].join('\n')
    const { container } = render(
      <Markdown tableOfContents={{ headingIdPrefix: 'report-R0002' }}>{source}</Markdown>,
    )

    const toc = screen.getByRole('navigation', { name: 'Table of contents' })
    const links = within(toc).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Overview',
      'Detailed results',
      'Overview',
      '结果分析',
    ])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#report-r0002-overview',
      '#report-r0002-detailed-results',
      '#report-r0002-overview-1',
      '#report-r0002-%E7%BB%93%E6%9E%9C%E5%88%86%E6%9E%90',
    ])
    expect(toc.compareDocumentPosition(screen.getByRole('heading', { name: 'Report title' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(screen.getByRole('heading', { name: 'Report title' })).toHaveAttribute(
      'id',
      'report-r0002-report-title',
    )
    expect(container.querySelectorAll('h2')[0]).toHaveAttribute('id', 'report-r0002-overview')
    expect(container.querySelectorAll('h2')[1]).toHaveAttribute('id', 'report-r0002-overview-1')
    expect(screen.getByRole('heading', { name: '结果分析' })).toHaveAttribute(
      'id',
      'report-r0002-结果分析',
    )
    expect(links[1]?.closest('li')).toHaveClass('ml-3')
    expect(links[3]?.closest('li')).toHaveClass('ml-6')
  })

  it('does not render an empty outline when the document has no section headings', () => {
    render(
      <Markdown tableOfContents={{ headingIdPrefix: 'report-R0003' }}>
        {'# Title only\n\nBody.'}
      </Markdown>,
    )

    expect(screen.queryByRole('navigation', { name: 'Table of contents' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Title only' })).toHaveAttribute(
      'id',
      'report-r0003-title-only',
    )
  })
})

describe('<Markdown> directory Report resources', () => {
  const base = '/api/report-assets/research/R0002'

  it('renders a relative .html image target as an unsandboxed iframe', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 200, headers: { 'content-type': 'text/html' } }),
        ),
    )
    const { container } = render(
      <Markdown resourceBaseUrl={base}>{'![Interactive curves](./charts/curves.html)'}</Markdown>,
    )

    await waitFor(() => expect(container.querySelector('iframe[data-report-html]')).not.toBeNull())
    const iframe = container.querySelector('iframe[data-report-html]')
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('src')).toBe(`${base}/charts/curves.html`)
    expect(iframe?.getAttribute('title')).toBe('Interactive curves')
    expect(iframe?.hasAttribute('sandbox')).toBe(false)
    expect(container.querySelector('img')).toBeNull()
    expect(iframe?.closest('p')).toBeNull()
    expect(iframe?.closest('[data-report-html-wrapper]')?.parentElement?.tagName).toBe('DIV')
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('keeps an HTML markdown link as a link while rewriting its target', () => {
    const { container } = render(
      <Markdown resourceBaseUrl={base}>{'[Open curves](./charts/curves.html)'}</Markdown>,
    )

    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('a')?.getAttribute('href')).toBe(`${base}/charts/curves.html`)
  })

  it('keeps an HTML image ordinary when no Report bundle resource base exists', () => {
    const { container } = render(<Markdown>{'![Static fallback](./chart.html)'}</Markdown>)

    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('img')).toHaveAttribute('src', './chart.html')
  })

  it('rewrites relative images and leaves remote images untouched', () => {
    const { container } = render(
      <Markdown resourceBaseUrl={base}>
        {'![local](images/loss.png)\n\n![remote](https://example.com/loss.png)'}
      </Markdown>,
    )

    const images = container.querySelectorAll('img')
    expect(images[0]?.getAttribute('src')).toBe(`${base}/images/loss.png`)
    expect(images[1]?.getAttribute('src')).toBe('https://example.com/loss.png')
    expect(images[0]?.closest('p')).not.toBeNull()
  })

  it('refuses relative paths with traversal segments', () => {
    expect(resolveDocumentResourceUrl(base, '../secret.json')).toBeNull()
    expect(resolveDocumentResourceUrl(base, '%2e%2e/secret.json')).toBeNull()
    expect(resolveDocumentResourceUrl(base, './data/metrics.json')).toBe(`${base}/data/metrics.json`)
  })

  it('keeps central Host selectors after the appended asset path', () => {
    expect(
      resolveDocumentResourceUrl(
        `${base}?host=host-a&project=research`,
        'charts/curve.svg?download=1#plot',
      ),
    ).toBe(`${base}/charts/curve.svg?host=host-a&project=research&download=1#plot`)
  })
})

describe('<Markdown> artifact references', () => {
  const root = '/srv/vsqa'
  const inventory: ArtifactInventory = {
    project: 'vsqa',
    experiments: [
      {
        id: 'E0017-vsqa-fvfa4-inference',
        path: `${root}/docs/experiments/E0017-vsqa-fvfa4-inference/README.md`,
      },
    ],
    reports: [
      {
        id: 'R0007',
        path: `${root}/docs/reports/R0007-inference-kernel-learning-guide/README.md`,
      },
    ],
  }
  const sourceDocumentPath = inventory.experiments[0]!.path
  const hrefFor = (target: ArtifactTarget) => `/artifact/${target.kind}/${target.id}`

  function artifactLinks(
    overrides: Partial<MarkdownArtifactLinkContext> = {},
  ): MarkdownArtifactLinkContext {
    return {
      inventory,
      sourceDocumentPath,
      sourceSurface: 'left',
      getArtifactHref: hrefFor,
      ...overrides,
    }
  }

  it('links unique bare short IDs and badges only the literal identifier', () => {
    render(
      <Markdown artifactLinks={artifactLinks()}>
        {'See R0007, E0017, and E0017-vsqa-fvfa4-inference.'}
      </Markdown>,
    )

    const reportLink = screen.getByRole('link', { name: 'R0007' })
    expect(reportLink).toHaveAttribute('href', '/artifact/report/R0007')
    expect(reportLink.querySelector('[data-artifact-badge]')).toHaveTextContent('R0007')

    const experimentLinks = screen.getAllByRole('link', { name: /^E0017/ })
    expect(experimentLinks).toHaveLength(2)
    for (const link of experimentLinks) {
      expect(link).toHaveAttribute('href', '/artifact/experiment/E0017-vsqa-fvfa4-inference')
    }
    // The long form keeps its full text, but only the `E0017` identifier is
    // badged — the `-vsqa-…` slug stays plain running text.
    const longForm = experimentLinks[1]!
    expect(longForm).toHaveTextContent('E0017-vsqa-fvfa4-inference')
    const badge = longForm.querySelector('[data-artifact-badge]')
    expect(badge).toHaveTextContent('E0017')
    expect(badge?.textContent).not.toContain('-vsqa')
  })

  it('badges a bare reference but leaves an ordinary Markdown link plain', () => {
    render(
      <Markdown artifactLinks={artifactLinks()}>
        {'See R0007 and [docs](https://example.com/docs).'}
      </Markdown>,
    )

    expect(
      screen.getByRole('link', { name: 'R0007' }).querySelector('[data-artifact-badge]'),
    ).not.toBeNull()
    const ordinary = screen.getByRole('link', { name: 'docs' })
    expect(ordinary).toHaveAttribute('href', 'https://example.com/docs')
    expect(ordinary.querySelector('[data-artifact-badge]')).toBeNull()
  })

  it('supports a nearest provider while allowing a Markdown instance to opt out', () => {
    const { container } = render(
      <MarkdownArtifactLinkProvider value={artifactLinks()}>
        <Markdown>{'R0007'}</Markdown>
        <Markdown artifactLinks={null}>{'R0007'}</Markdown>
      </MarkdownArtifactLinkProvider>,
    )
    expect(container.querySelectorAll('a[data-memon-artifact-id]')).toHaveLength(1)
    expect(container.textContent).toBe('R0007R0007')
  })

  it('leaves code, math, raw HTML, unresolved IDs, and identifier substrings unchanged', () => {
    const body = [
      '`R0007` and R9999 and XR0007 and R00070 and R0007-title',
      '',
      '$E0017$',
      '',
      '```txt',
      'E0017 R0007',
      '```',
      '',
      '<span>R0007</span>',
    ].join('\n')
    const { container } = render(<Markdown artifactLinks={artifactLinks()}>{body}</Markdown>)

    expect(container.querySelector('a[data-memon-artifact-id]')).toBeNull()
    expect(container.querySelector('code')).toHaveTextContent('R0007')
    expect(container.querySelector('.katex')).not.toBeNull()
    expect(container.querySelector('pre')).toHaveTextContent('E0017 R0007')
  })

  it('does not nest or restyle an authored external link containing an artifact ID', () => {
    const { container } = render(
      <Markdown artifactLinks={artifactLinks()}>
        {'[R0007 external](https://example.com/R0007.md)'}
      </Markdown>,
    )
    const link = container.querySelector('a')
    expect(container.querySelectorAll('a')).toHaveLength(1)
    expect(link).toHaveAttribute('href', 'https://example.com/R0007.md')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link?.querySelector('[data-artifact-badge]')).toBeNull()
  })

  it('recognizes an explicit relative artifact link before bundle resource rewriting', () => {
    const { container } = render(
      <Markdown artifactLinks={artifactLinks()} resourceBaseUrl="/api/report-assets/vsqa/R0001">
        {'[R0007: learning guide](../../reports/R0007-inference-kernel-learning-guide/README.md)'}
      </Markdown>,
    )
    const link = container.querySelector('a[data-memon-artifact-id="R0007"]')
    expect(link).toHaveAttribute('href', '/artifact/report/R0007')
    expect(link).toHaveTextContent('R0007: learning guide')
    expect(link?.querySelector('[data-artifact-badge]')).toHaveTextContent('R0007')
    expect(link?.querySelector('[data-artifact-badge]')?.textContent).not.toContain('learning')
  })

  it('recognizes an explicit absolute artifact link without inventing label emphasis', () => {
    const context = artifactLinks({
      sourceDocumentPath: inventory.reports[0]!.path,
      sourceSurface: 'side-report',
    })
    const { container } = render(
      <Markdown artifactLinks={context}>
        {`[current experiment](${inventory.experiments[0]!.path}?plain=1#results)`}
      </Markdown>,
    )
    const link = container.querySelector('a[data-memon-artifact-kind="experiment"]')
    expect(link).toHaveAttribute('href', '/artifact/experiment/E0017-vsqa-fvfa4-inference')
    expect(link).toHaveTextContent('current experiment')
    expect(link?.querySelector('[data-artifact-badge]')).toBeNull()
  })

  it('recognizes canonical project web routes and keeps unresolved files ordinary', () => {
    const { container } = render(
      <Markdown artifactLinks={artifactLinks()}>
        {'[E0017 experiment](/p/vsqa/e/E0017-vsqa-fvfa4-inference) and [notes](./notes.md)'}
      </Markdown>,
    )
    const artifact = container.querySelector('a[data-memon-artifact-kind="experiment"]')
    expect(artifact).toHaveAttribute('href', '/artifact/experiment/E0017-vsqa-fvfa4-inference')
    expect(container.querySelector('a[href="./notes.md"]')).not.toBeNull()
  })

  it('passes source surface to the navigation callback', () => {
    const getArtifactHref = vi.fn((target: ArtifactTarget) => hrefFor(target))
    render(
      <Markdown artifactLinks={artifactLinks({ sourceSurface: 'full-report', getArtifactHref })}>
        {'R0007'}
      </Markdown>,
    )
    expect(getArtifactHref).toHaveBeenCalledWith({ kind: 'report', id: 'R0007' }, 'full-report')
  })

  it('updates same-left Report state through History without remounting local content', () => {
    window.history.replaceState({}, '', '/p/vsqa/e/E0017-vsqa-fvfa4-inference?run=sample')
    const context = artifactLinks({
      getArtifactHref: () =>
        '/p/vsqa/e/E0017-vsqa-fvfa4-inference?run=sample&report=R0007&reportSurface=split',
    })
    const { container } = render(
      <div>
        <input aria-label="Experiment draft" defaultValue="kept" />
        <Markdown artifactLinks={context}>{'R0007'}</Markdown>
      </div>,
    )
    const draft = container.querySelector('input') as HTMLInputElement
    fireEvent.change(draft, { target: { value: 'unsaved experiment state' } })
    const reportLink = container.querySelector('a[data-memon-artifact-id="R0007"]')!

    fireEvent.click(reportLink)

    expect(`${window.location.pathname}${window.location.search}`).toBe(
      '/p/vsqa/e/E0017-vsqa-fvfa4-inference?run=sample&report=R0007&reportSurface=split',
    )
    expect(container.querySelector('input')).toBe(draft)
    expect(draft).toHaveValue('unsaved experiment state')
  })
})

describe('<Markdown> raw HTML with inline styles', () => {
  it('preserves style attributes on span elements in raw HTML', () => {
    const { container } = render(
      <Markdown>{'<span style="color: red;">highlighted</span>'}</Markdown>,
    )

    const span = container.querySelector('span')
    expect(span).not.toBeNull()
    // style-to-js normalizes the value (drops spaces/semicolons); any non-empty
    // style proves the attribute survived the render pipeline.
    expect(span?.getAttribute('style')).toBeTruthy()
    expect(span!.getAttribute('style')).toMatch(/color/)
  })

  it('preserves multiple CSS properties in inline styles', () => {
    const { container } = render(
      <Markdown>{'<span style="color: red; background-color: yellow;">styled</span>'}</Markdown>,
    )

    const span = container.querySelector('span')
    expect(span).not.toBeNull()
    expect(span?.getAttribute('style')).toBeTruthy()
    expect(span!.getAttribute('style')).toMatch(/color/)
  })
})
