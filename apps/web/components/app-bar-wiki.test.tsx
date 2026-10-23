import { ProjectRefSchema } from '@memon/core'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppBar } from './app-bar'

const navigation = vi.hoisted(() => ({ pathname: '/host-a/project-a/wiki' }))
const project = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}))
vi.mock('./tab-badge', () => ({
  TabBadge: ({ kind }: { kind: string }) => <span data-kind={kind}>1</span>,
}))
vi.mock('./manage-shares-dialog', () => ({ ManageSharesDialog: () => null }))
vi.mock('./ui/sidebar', () => ({ SidebarTrigger: () => <button type="button">Sidebar</button> }))

describe('AppBar Wiki tab', () => {
  beforeEach(() => {
    navigation.pathname = '/host-a/project-a/wiki'
  })

  it('renders Wiki immediately after Code Review as the final project tab', () => {
    render(<AppBar project={project} />)
    const tablist = screen.getByRole('tablist')
    expect(
      within(tablist)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Experiments1', 'Journal1', 'Reports1', 'Code Review1', 'Wiki1'])
    expect(screen.queryByRole('tab', { name: /Hypotheses/i })).toBeNull()
    const wiki = within(tablist).getByRole('tab', { name: /^Wiki 1$/ })
    expect(wiki).toHaveAttribute('href', '/host-a/project-a/wiki')
    expect(wiki).toHaveAttribute('aria-selected', 'true')
    expect(wiki.querySelector('[data-kind="wiki"]')).toBeInTheDocument()
  })

  it('keeps the canonical Wiki list link active on a Wiki page', () => {
    navigation.pathname = '/host-a/project-a/w/7'
    render(<AppBar project={project} />)

    const wiki = screen.getByRole('tab', { name: /^Wiki 1$/ })
    expect(wiki).toHaveAttribute('href', '/host-a/project-a/wiki')
    expect(wiki).toHaveAttribute('aria-selected', 'true')
  })
})
