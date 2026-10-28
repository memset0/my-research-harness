import { ProjectRefSchema } from '@memon/core'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppBar } from './app-bar'

const navigation = vi.hoisted(() => ({ pathname: '/host-a/project-a/wiki' }))
const project = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}))
vi.mock('./manage-shares-dialog', () => ({
  ManageSharesDialog: () => <button type="button">Share</button>,
}))
vi.mock('./ui/sidebar', () => ({ SidebarTrigger: () => <button type="button">Sidebar</button> }))

function location() {
  return screen.getByRole('navigation', { name: 'Location' })
}

/** The breadcrumb's visible segments, separators dropped. */
function crumbs() {
  return Array.from(location().children, (node) => node.textContent ?? '').filter(
    (text) => text !== '/',
  )
}

describe('AppBar location', () => {
  beforeEach(() => {
    navigation.pathname = '/host-a/project-a/wiki'
  })

  it('shows host / project / Wiki on the Wiki list and no section tabs', () => {
    render(<AppBar project={project} />)
    expect(location()).toHaveAttribute('data-app-bar-location')
    expect(crumbs()).toEqual(['host-a', 'project-a', 'Wiki'])
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(within(location()).queryByRole('link')).toBeNull()
  })

  it('keeps Wiki as the section on a Wiki page', () => {
    navigation.pathname = '/host-a/project-a/w/7'
    render(<AppBar project={project} />)
    expect(crumbs()).toEqual(['host-a', 'project-a', 'Wiki'])
  })

  it.each([
    ['/host-a/project-a', 'Experiments'],
    ['/host-a/project-a/experiments', 'Experiments'],
    ['/host-a/project-a/e/3', 'Experiments'],
    ['/host-a/project-a/journal', 'Journal'],
    ['/host-a/project-a/reports', 'Reports'],
    ['/host-a/project-a/r/2', 'Reports'],
    ['/host-a/project-a/code-review', 'Code Review'],
  ])('names the current section of %s as %s', (pathname, name) => {
    navigation.pathname = pathname
    render(<AppBar project={project} />)
    expect(crumbs()).toEqual(['host-a', 'project-a', name])
  })

  it('omits the section on a path outside this project', () => {
    navigation.pathname = '/host-b/project-a/wiki'
    render(<AppBar project={project} />)
    expect(crumbs()).toEqual(['host-a', 'project-a'])
  })

  it('keeps the Share control', () => {
    render(<AppBar project={project} />)
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
    expect(location()).not.toContainElement(screen.getByRole('button', { name: 'Share' }))
  })
})
