import { ProjectRefSchema } from '@memon/core'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppBar } from './app-bar'

const navigation = vi.hoisted(() => ({ pathname: '/p/project-a/wiki' }))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}))
vi.mock('./tab-badge', () => ({
  TabBadge: ({ kind }: { kind: string }) => <span data-kind={kind}>1</span>,
}))
vi.mock('./manage-shares-dialog', () => ({ ManageSharesDialog: () => null }))
vi.mock('./open-with-button', () => ({ OpenWithButton: () => null }))
vi.mock('./ui/sidebar', () => ({ SidebarTrigger: () => <button type="button">Sidebar</button> }))

describe('AppBar Wiki tab', () => {
  beforeEach(() => {
    navigation.pathname = '/p/project-a/wiki'
  })

  it('renders Wiki immediately after Code Review as the final project tab', () => {
    render(<AppBar project="project-a" />)
    const tablist = screen.getByRole('tablist')
    expect(within(tablist).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Experiments1',
      'Hypotheses1',
      'Journal1',
      'Reports1',
      'Digests1',
      'Code Review1',
      'Wiki1',
    ])
    const wiki = within(tablist).getByRole('tab', { name: /^Wiki 1$/ })
    expect(wiki).toHaveAttribute('href', '/p/project-a/wiki')
    expect(wiki).toHaveAttribute('aria-selected', 'true')
    expect(wiki.querySelector('[data-kind="wiki"]')).toBeInTheDocument()
  })

  it('retains the Host-qualified prefix on central Wiki navigation', () => {
    navigation.pathname = '/h/host-a/p/project-a/wiki/W0007'
    const project = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })
    render(<AppBar project={project} />)

    expect(screen.getByRole('tab', { name: /^Wiki 1$/ })).toHaveAttribute(
      'href',
      '/h/host-a/p/project-a/wiki',
    )
  })
})
