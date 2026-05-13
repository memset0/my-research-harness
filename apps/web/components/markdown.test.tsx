import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Markdown } from './markdown'

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
