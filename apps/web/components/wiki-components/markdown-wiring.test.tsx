import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { listComponents } from '../../lib/wiki-components/registry'
import { Markdown } from '../markdown'
import { hasWikiComponentRenderer } from './index'

const INLINE_DATA_BLOCK = [
  '## Evidence',
  '',
  '```memon-data@1 title="Brightness bias"',
  'script: python3 scripts/collect.py',
  'captured_at: 2026-05-06T14:20:00+08:00',
  'captured_commit: 9f2c4e1a7b3d5f6081a2c3d4e5f60718293a4b5c',
  'columns: [cfg, delta]',
  'rows:',
  '  - [CFG=4.5, 0.009]',
  '  - [CFG=7.5, 0.011]',
  '```',
].join('\n')

describe('Markdown component wiring', () => {
  it('renders a memon-data block as a table with its provenance caption', () => {
    render(<Markdown>{INLINE_DATA_BLOCK}</Markdown>)

    const table = screen.getByRole('table')
    expect(table).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'cfg' })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(3)
    expect(screen.getByText('Brightness bias')).toBeInTheDocument()
    expect(screen.getByText(/captured 2026-05-06T14:20:00\+08:00/)).toBeInTheDocument()
    // Abbreviated commit, not the full object id.
    expect(screen.getByText('9f2c4e1')).toBeInTheDocument()
    expect(screen.queryByText('9f2c4e1a7b3d5f6081a2c3d4e5f60718293a4b5c')).toBeNull()
  })

  it('keeps the inline collection script behind a collapsible panel', async () => {
    render(
      <Markdown>
        {[
          '```memon-data@1',
          'runner: bash -s',
          'code: |',
          '  echo collecting',
          'captured_at: 2026-05-06T14:20:00+08:00',
          'captured_commit: 9f2c4e1a7b3d5f6081a2c3d4e5f60718293a4b5c',
          'columns: [run]',
          'rows: [[foo-260501-100000]]',
          '```',
        ].join('\n')}
      </Markdown>,
    )

    const trigger = screen.getByRole('button', { name: 'Collection script' })
    expect(screen.queryByText('echo collecting')).toBeNull()
    trigger.click()
    await waitFor(() => expect(screen.getByText('echo collecting')).toBeInTheDocument())
    expect(screen.getByText('bash -s')).toBeInTheDocument()
  })

  it('renders an html-embed block as a srcdoc iframe with the requested height', async () => {
    render(
      <Markdown resourceBaseUrl="/api/wiki-assets/project-a/W0006">
        {['```html-embed@1 height=280 title="FID chart"', '<div id="chart">hi</div>', '```'].join(
          '\n',
        )}
      </Markdown>,
    )

    const frame = await waitFor(() => {
      const found = document.querySelector('iframe')
      if (!found) throw new Error('iframe not mounted')
      return found
    })
    expect(frame.getAttribute('title')).toBe('FID chart')
    expect(frame.getAttribute('src')).toBeNull()
    expect(frame.getAttribute('srcdoc')).toContain('<div id="chart">hi</div>')
    // The asset base has to reach the embedded document, otherwise its
    // `./data/*` requests would resolve against the dashboard route.
    expect(frame.getAttribute('srcdoc')).toContain(
      '<base href="/api/wiki-assets/project-a/W0006/">',
    )
    expect(document.querySelector('[data-report-html-wrapper] > div + div')).toHaveStyle({
      height: '280px',
    })
  })

  it('renders an unregistered language as a plain code block without diagnostics', () => {
    const { container } = render(
      <Markdown>{['```foo-chart', 'not a component', '```'].join('\n')}</Markdown>,
    )

    expect(container.querySelector('pre code.language-foo-chart')).not.toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('renders an invalid component block verbatim as a code block', () => {
    const { container } = render(
      <Markdown>
        {[
          '```memon-data@1',
          'script: python3 scripts/collect.py',
          'captured_at: 2026-05-06T14:20:00+08:00',
          'captured_commit: 9f2c4e1a7b3d5f6081a2c3d4e5f60718293a4b5c',
          'columns: [cfg, delta]',
          'rows:',
          '  - [CFG=4.5]',
          '```',
        ].join('\n')}
      </Markdown>,
    )

    expect(screen.queryByRole('table')).toBeNull()
    expect(container.querySelector('pre code.language-memon-data\\@1')).not.toBeNull()
  })

  it('reports an unresolvable data path instead of failing the surrounding document', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    render(
      <Markdown>
        {[
          '# Run',
          '',
          '```memon-data@1',
          'script: python3 scripts/collect.py',
          'captured_at: 2026-05-06T14:20:00+08:00',
          'captured_commit: 9f2c4e1a7b3d5f6081a2c3d4e5f60718293a4b5c',
          'data: ./data/x.csv',
          '```',
          '',
          'Body text still renders.',
        ].join('\n')}
      </Markdown>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('no asset route')
    expect(screen.getByText('Body text still renders.')).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('fetches the file form through the document asset route', async () => {
    const fetchSpy = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response('step,fid\n20000,41.2\n40000,28.6\n', {
          status: 200,
          headers: { 'content-type': 'text/csv' },
        }),
    )
    vi.stubGlobal('fetch', fetchSpy)
    render(
      <Markdown resourceBaseUrl="/api/wiki-assets/project-a/W0006">
        {[
          '```memon-data@1',
          'script: python3 scripts/collect.py',
          'captured_at: 2026-05-06T14:20:00+08:00',
          'captured_commit: 9f2c4e1a7b3d5f6081a2c3d4e5f60718293a4b5c',
          'data: ./data/fid.csv',
          '```',
        ].join('\n')}
      </Markdown>,
    )

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/wiki-assets/project-a/W0006/data/fid.csv')
    expect(screen.getByRole('columnheader', { name: 'fid' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '41.2' })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('has a renderer for every registered component version', () => {
    for (const descriptor of listComponents()) {
      expect(
        hasWikiComponentRenderer(descriptor.name, descriptor.version),
        `${descriptor.name}@${descriptor.version}`,
      ).toBe(true)
    }
  })
})
