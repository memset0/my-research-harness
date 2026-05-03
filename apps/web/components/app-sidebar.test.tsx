import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithQuery } from '../test/utils'

vi.mock('next/navigation', () => ({
  usePathname: () => '/p/project-a',
}))

vi.mock('../lib/api', () => ({
  fetchProjects: vi.fn(),
  fetchExperiments: vi.fn(),
}))

import { fetchProjects, fetchExperiments } from '../lib/api'
import { AppSidebar } from './app-sidebar'
import { SidebarProvider } from './ui/sidebar'

const STORAGE_KEY = 'memon:sidebar:expanded'

describe('AppSidebar', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(fetchProjects).mockResolvedValue({
      projects: [
        { name: 'project-a', root: '/p/a', exclude: [] },
        { name: 'project-b', root: '/p/b', exclude: [] },
      ],
    })
    vi.mocked(fetchExperiments).mockResolvedValue({ experiments: [] })
  })

  function setup() {
    return renderWithQuery(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>,
    )
  }

  it('active project is open by default (SSR-friendly)', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('project-a')).toBeInTheDocument())
    // After hydration, useEffect adds activeProject to expanded set even when
    // localStorage was empty — confirm via stored snapshot.
    await waitFor(() => {
      const stored = localStorage.getItem(STORAGE_KEY)
      expect(stored).toContain('project-a')
    })
  })

  it('clicking another project group toggles its expansion + persists', async () => {
    setup()
    const projectBHeader = await screen.findByText('project-b')
    await userEvent.click(projectBHeader)
    await waitFor(() => {
      const stored = localStorage.getItem(STORAGE_KEY)
      expect(stored).toContain('project-b')
    })
    // Toggle off — project-b should disappear from storage
    await userEvent.click(projectBHeader)
    await waitFor(() => {
      const stored = localStorage.getItem(STORAGE_KEY) ?? '[]'
      expect(stored).not.toContain('project-b')
    })
  })
})
