import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../../test/utils'
import { Markdown } from '../markdown'

vi.mock('../session-provider', () => ({ useIsOwner: () => false }))

const documentRef = { project: 'project-a', path: 'docs/wiki/note/W0010-page.md' }
const source = [
  '```yaml datatable@1 #table',
  'columns: [name, value]',
  'data: [[a, 1]]',
  '```',
  '```yaml figure@1 #fig',
  'image: assets/x.svg',
  'caption: Figure X.',
  'description: A useful image.',
  '```',
  '```html embed@1 #embed',
  '<p>embedded body</p>',
  '```',
  '```yaml checklist@1 #plan',
  'items:',
  '  - title: Verify output',
  '```',
].join('\n')

afterEach(() => vi.restoreAllMocks())

describe('Markdown component wiring', () => {
  it('renders all four shipped component types and the html {data} fallback', () => {
    renderWithQuery(<Markdown document={documentRef}>{source}</Markdown>)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/doc-assets/project-a/docs/wiki/note/assets/x.svg')
    expect(screen.getByText('Figure X.')).toBeInTheDocument()
    expect(screen.getByTitle('Embedded HTML')).toHaveAttribute('srcdoc', expect.stringContaining('<base href="/api/doc-assets/project-a/docs/wiki/note/">'))
    expect(screen.getByTitle('Embedded HTML')).toHaveAttribute('srcdoc', expect.stringContaining('<p>embedded body</p>'))
    expect(screen.getByText('Verify output')).toBeInTheDocument()
  })

  it('loads and validates an executable datatable cache', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      columns: ['name', 'value'], data: [['cached', 2]],
      __component_id: 'live', __component_type: 'datatable@1',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const executable = [
      '```yaml datatable@1 #live',
      'code: |',
      '  def collect(**kw):',
      "    return {'columns': ['name', 'value'], 'data': [['cached', 2]]}",
      '```',
    ].join('\n')
    renderWithQuery(<Markdown document={documentRef}>{executable}</Markdown>)
    expect(await screen.findByText('cached')).toBeInTheDocument()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/doc-assets/project-a/docs/wiki/note/W0010-page__assets/live.json',
      { cache: 'no-store' },
    )
  })

  it('surfaces a first-run cache error even when no data was produced', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      __component_id: 'live', __component_type: 'datatable@1',
      __last_error: { at: '2026-09-16T00:00:00+00:00', message: 'collector exploded' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const executable = [
      '```yaml datatable@1 #live',
      'script: collect.py::main',
      '```',
    ].join('\n')
    renderWithQuery(<Markdown document={documentRef}>{executable}</Markdown>)
    expect(await screen.findByText(/Last recompute failed: collector exploded/)).toBeInTheDocument()
    expect(screen.getByText(/Cached result field columns is invalid/)).toBeInTheDocument()
  })

  it('keeps an invalid component payload readable', async () => {
    render(<Markdown>{'```yaml figure@1\nimage: x.svg\n```'}</Markdown>)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('caption'))
    expect(screen.getByText('image: x.svg')).toBeInTheDocument()
  })
})
