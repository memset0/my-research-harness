import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../test/utils'

const pathname = vi.fn(() => '/h/host-a/p/project-x/wiki/W0004')
vi.mock('next/navigation', () => ({ usePathname: () => pathname() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { copyUrlFor, ManageSharesDialog, pageDocument, scopeLabel } from './manage-shares-dialog'

const PROJECT = { host: 'host-a', project: 'project-x' } as never
const row = (id: string, scope: unknown) => ({
  id,
  token: 'a'.repeat(24),
  host: 'host-a',
  project: 'project-x',
  scope,
  path: '/h/host-a/p/project-x',
  created_at: '2026-10-21T10:00:00+08:00',
  expires_at: null,
  share_url: `https://memon.example.test/s/${'a'.repeat(24)}`,
})

let posted: unknown[]
let listed: unknown[]
let detail: Record<string, unknown>
beforeEach(() => {
  posted = []
  detail = { id: 'W0004', presentation: 'markdown' }
  listed = [
    row('shr_project1', { kind: 'project' }),
    row('shr_wikipage', { kind: 'wiki', id: 'W0004' }),
  ]
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (/^\/api\/(wiki|reports)\/[WR]\d{4}/.test(url)) return Response.json(detail)
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        posted.push(body)
        return Response.json(
          {
            share: { ...row('shr_newshare', body.scope), ...(body.public ? { public: true } : {}) },
          },
          { status: 201 },
        )
      }
      return Response.json({ shares: listed })
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ManageSharesDialog', () => {
  it('lists each link with its reach and issues a page-only link by default', async () => {
    renderWithQuery(<ManageSharesDialog project={PROJECT} />)
    await userEvent.click(screen.getByRole('button', { name: /Share/ }))

    expect(
      await screen.findByText('Whole project', { selector: '[data-share-scope]' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Wiki W0004', { selector: '[data-share-scope]' })).toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/shares?project=project-x&host=host-a')

    await userEvent.click(screen.getByRole('button', { name: 'Create link for Wiki W0004' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({
      host: 'host-a',
      project: 'project-x',
      scope: { kind: 'wiki', id: 'W0004' },
      expires: 'never',
    })

    await userEvent.click(screen.getByRole('radio', { name: 'Whole project' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create link for Whole project' }))
    await waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[1]).toMatchObject({ scope: { kind: 'project' } })
  })

  it('offers only Project links away from document pages', async () => {
    pathname.mockReturnValue('/h/host-a/p/project-x/reports')
    renderWithQuery(<ManageSharesDialog project={PROJECT} />)
    await userEvent.click(screen.getByRole('button', { name: /Share/ }))
    expect(
      await screen.findByRole('button', { name: 'Create link for Whole project' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /This page only/ })).not.toBeInTheDocument()
  })
})

describe('page helpers', () => {
  it('recognises document pages and labels scopes', () => {
    expect(pageDocument('/h/host-a/p/project-x/e/E0001-pipeline')).toEqual({
      kind: 'experiment',
      id: 'E0001-pipeline',
    })
    expect(pageDocument('/p/project-x/reports/R0005')).toEqual({ kind: 'report', id: 'R0005' })
    expect(pageDocument('/h/host-a/p/project-x/wiki')).toBeNull()
    expect(scopeLabel({ kind: 'report', id: 'R0005' })).toBe('Report R0005')
  })
})

describe('ManageSharesDialog public pages', () => {
  it('makes the current Wiki page public and shows when it already is', async () => {
    pathname.mockReturnValue('/h/host-a/p/project-x/wiki/W0004')
    const view = renderWithQuery(<ManageSharesDialog project={PROJECT} />)
    await userEvent.click(screen.getByRole('button', { name: /Share/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Make public' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ scope: { kind: 'wiki', id: 'W0004' }, public: true })
    view.unmount()

    listed = [{ ...row('shr_public01', { kind: 'wiki', id: 'W0004' }), public: true }]
    renderWithQuery(<ManageSharesDialog project={PROJECT} />)
    await userEvent.click(screen.getByRole('button', { name: /Share/ }))
    expect(
      await screen.findByText('Public · Wiki W0004', { selector: '[data-share-scope]' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make private' })).toBeInTheDocument()
  })

  it('does not offer public Experiment pages', async () => {
    pathname.mockReturnValue('/h/host-a/p/project-x/e/E0001-pipeline')
    renderWithQuery(<ManageSharesDialog project={PROJECT} />)
    await userEvent.click(screen.getByRole('button', { name: /Share/ }))
    expect(
      await screen.findByRole('button', { name: 'Create link for Experiment E0001-pipeline' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Make public' })).not.toBeInTheDocument()
  })
})

describe('ManageSharesDialog service links', () => {
  it('offers a service link only on a service page and labels it', async () => {
    pathname.mockReturnValue('/h/host-a/p/project-x/wiki/W0004')
    const view = renderWithQuery(<ManageSharesDialog project={PROJECT} />)
    await userEvent.click(screen.getByRole('button', { name: /Share/ }))
    await screen.findByRole('button', { name: 'Create link for Wiki W0004' })
    expect(screen.queryByRole('radio', { name: 'Service' })).not.toBeInTheDocument()
    view.unmount()

    detail = { id: 'W0004', presentation: 'service' }
    listed = [{ ...row('shr_service1', { kind: 'wiki', id: 'W0004' }), service: true }]
    renderWithQuery(<ManageSharesDialog project={PROJECT} />)
    await userEvent.click(screen.getByRole('button', { name: /Share/ }))
    expect(
      await screen.findByText('Service · Wiki W0004', { selector: '[data-share-scope]' }),
    ).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('radio', { name: 'Service' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Create link for Service · Wiki W0004' }),
    )
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ scope: { kind: 'wiki', id: 'W0004' }, service: true })
  })
})

describe('copyUrlFor', () => {
  const token = 'a'.repeat(24)
  const current =
    'http://127.0.0.1:3737/h/host-a/p/project-x/reports/R0006?expanded=1&share=old#top'

  it('copies a whole-Project link for the page currently open', () => {
    expect(copyUrlFor(row('shr_project1', { kind: 'project' }) as never, current)).toBe(
      `https://memon.example.test/h/host-a/p/project-x/reports/R0006?expanded=1&share=${token}`,
    )
  })

  it('keeps the record link for page-scoped and public records', () => {
    const page = row('shr_wikipage', { kind: 'wiki', id: 'W0004' })
    expect(copyUrlFor(page as never, current)).toBe(page.share_url)
    const pub = { ...row('shr_public', { kind: 'project' }), public: true }
    expect(copyUrlFor(pub as never, current)).toBe(pub.share_url)
  })
})
