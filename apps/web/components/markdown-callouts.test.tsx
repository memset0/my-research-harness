import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Markdown } from './markdown'

describe('Markdown callouts', () => {
  it('keeps artifact links, component fences and source-review highlighting inside callouts', () => {
    const { container } = render(
      <Markdown
        artifactLinks={{
          inventory: {
            project: 'project-a',
            experiments: [
              { id: 'E0001-example', path: 'docs/experiments/E0001-example/README.md' },
            ],
            reports: [],
          },
          sourceDocumentPath: 'docs/wiki/note/W0001-example.md',
          sourceSurface: 'left',
          getArtifactHref: (target) => `/artifact/${target.id}`,
        }}
        unverified={{ ranges: [[2, 4]], title: 'uncommitted' }}
      >
        {
          '> [!info]- Evidence\n> See E0001.\n>\n> ```yaml figure@1\n> image: chart.svg\n> caption: Evidence figure\n> ```'
        }
      </Markdown>,
    )
    const callout = container.querySelector('details')!
    expect(callout).toHaveAttribute('data-wiki-unverified')
    expect(callout).toHaveAttribute('title', 'uncommitted')
    expect(callout.querySelector('a[data-memon-artifact-id]')).toHaveAttribute(
      'href',
      '/artifact/E0001-example',
    )
    expect(callout.querySelector('[data-component-type="figure@1"]')).not.toBeNull()
  })
  it('distinguishes static, collapsed and expanded deprecated content', () => {
    const { container } = render(
      <Markdown>
        {
          '> [!DEPRECATED] Old result\n> Static body\n\n> [!DEPRECATED]- Old protocol\n> Hidden body\n\n> [!deprecated]+\n> Expanded body\n\nCurrent content'
        }
      </Markdown>,
    )
    const callouts = container.querySelectorAll('[data-callout]')
    expect(callouts).toHaveLength(3)
    expect(callouts[0]?.tagName).toBe('DIV')
    expect(callouts[0]?.querySelector('summary')).toBeNull()
    expect(callouts[0]?.textContent).toContain('Deprecated · Old result')
    const closed = callouts[1] as HTMLDetailsElement
    expect(closed.open).toBe(false)
    expect(closed.querySelector('summary')?.textContent).toBe('Deprecated · Old protocol')
    fireEvent.click(closed.querySelector('summary')!)
    expect(closed.open).toBe(true)
    expect((callouts[2] as HTMLDetailsElement).open).toBe(true)
    expect(callouts[2]?.querySelector('summary')?.textContent).toBe('Deprecated')
    expect(container.lastElementChild?.lastElementChild?.textContent).toBe('Current content')
  })

  it.each([
    ['note', 'note'],
    ['abstract', 'abstract'],
    ['summary', 'abstract'],
    ['tldr', 'abstract'],
    ['info', 'info'],
    ['todo', 'todo'],
    ['tip', 'tip'],
    ['hint', 'tip'],
    ['important', 'tip'],
    ['success', 'success'],
    ['check', 'success'],
    ['done', 'success'],
    ['question', 'question'],
    ['help', 'question'],
    ['faq', 'question'],
    ['warning', 'warning'],
    ['caution', 'warning'],
    ['attention', 'warning'],
    ['failure', 'failure'],
    ['fail', 'failure'],
    ['missing', 'failure'],
    ['danger', 'danger'],
    ['error', 'danger'],
    ['bug', 'bug'],
    ['example', 'example'],
    ['quote', 'quote'],
    ['cite', 'quote'],
    ['unknown-kind', 'note'],
    ['constructor', 'note'],
    ['__proto__', 'note'],
  ])('renders %s using %s styling', (identifier, kind) => {
    const { container } = render(<Markdown>{`> [!${identifier.toUpperCase()}]\n> Body`}</Markdown>)
    expect(container.querySelector('[data-callout]')?.getAttribute('data-callout')).toBe(kind)
    expect(container.querySelector('.memon-callout-icon')).not.toBeNull()
    expect(container.textContent).not.toContain('[!')
  })

  it('preserves inline titles, nesting, tables, math, code, relative assets and links', () => {
    const { container } = render(
      <Markdown resourceBaseUrl="/api/wiki-assets/project-a/W0001/">
        {[
          '> [!note]- **Summary** with [evidence](./evidence.csv)',
          '> First paragraph with $x$.',
          '>',
          '> - item one',
          '> - item two',
          '>',
          '> | Name | Value |',
          '> | --- | --- |',
          '> | Score | 2 |',
          '>',
          '> ```sh',
          '> echo example',
          '> ```',
          '>',
          '> ![Chart](./chart.svg)',
          '>',
          '> > [!warning]+ Inner',
          '> > Nested content',
        ].join('\n')}
      </Markdown>,
    )
    expect(container.querySelector('summary strong')?.textContent).toBe('Summary')
    expect(container.querySelector('summary a')?.getAttribute('href')).toBe(
      '/api/wiki-assets/project-a/W0001/evidence.csv',
    )
    expect(container.querySelector('.katex')).not.toBeNull()
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelector('pre code')?.textContent).toBe('echo example\n')
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/wiki-assets/project-a/W0001/chart.svg',
    )
    expect(container.querySelector('[data-callout="note"] [data-callout="warning"]')).not.toBeNull()
  })

  it('keeps escaped markers, code and ordinary quotes literal', () => {
    const { container } = render(
      <Markdown>
        {
          '> Ordinary quotation\n\n> \\[!note] example\n\n> &#91;!tip] example\n\n```md\n> [!DEPRECATED]-\n```\n\n`[!warning]`'
        }
      </Markdown>,
    )
    expect(container.querySelector('[data-callout]')).toBeNull()
    expect(container.querySelectorAll('blockquote')).toHaveLength(3)
    expect(container.querySelector('pre')?.textContent).toContain('[!DEPRECATED]-')
  })

  it('supports title-only callouts and a hard break after the marker', () => {
    const { container } = render(
      <Markdown>{'> [!tip] **Title only**\n\n> [!note]-  \n> Body after break'}</Markdown>,
    )
    expect(
      container.querySelector('[data-callout="tip"] .memon-callout-body')?.textContent?.trim(),
    ).toBe('')
    expect(container.querySelector('summary')?.textContent).toBe('Note')
    expect(container.querySelector('details .memon-callout-body')?.textContent).toContain(
      'Body after break',
    )
  })
})
