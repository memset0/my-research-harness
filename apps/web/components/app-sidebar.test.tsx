import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithQuery } from '../test/utils'

vi.mock('next/navigation', () => ({
  usePathname: () => '/p/project-a',
}))

vi.mock('../lib/api', () => ({
  fetchProjects: vi.fn(),
  fetchExperimentDocs: vi.fn(),
}))

import { fetchProjects, fetchExperimentDocs } from '../lib/api'
import { AppSidebar } from './app-sidebar'
import { SidebarProvider } from './ui/sidebar'

const STORAGE_KEY = 'memon:sidebar:expanded'

function makeExpDoc(id: string, effectiveUpdatedAt: string) {
  return {
    id,
    project: 'project-a',
    path: `/p/a/docs/experiments/${id}.md`,
    mtime: 0,
    frontMatter: {
      id,
      slug: id.replace(/^E\d+-/, ''),
      title: id,
      runs: [],
      hypotheses: [],
      tags: [],
      createdAt: effectiveUpdatedAt,
      updatedAt: effectiveUpdatedAt,
    },
    sections: { motivation: null, method: null, plan: null, conclusion: null, caveats: null },
    warningsRaw: null,
    parseErrors: [],
    parseWarnings: [],
    effectiveCreatedAt: effectiveUpdatedAt,
    effectiveUpdatedAt,
    memberRuns: [],
  }
}

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
    vi.mocked(fetchExperimentDocs).mockResolvedValue({ experiments: [] })
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

  it('renders experiment rows in effectiveUpdatedAt-descending order', async () => {
    // Three exps deliberately served out of order; the sidebar must sort
    // by effectiveUpdatedAt desc so B (newest) renders first, then C, then A.
    vi.mocked(fetchExperimentDocs).mockResolvedValue({
      experiments: [
        makeExpDoc('E0001-alpha', '2026-05-04T10:00:00+08:00'),
        makeExpDoc('E0002-bravo', '2026-05-06T08:00:00+08:00'),
        makeExpDoc('E0003-charlie', '2026-05-05T15:00:00+08:00'),
      ],
    })

    const { container } = setup()
    // project-a is the active project, so its group is expanded by default.
    // Wait for the rows to appear.
    await waitFor(() => {
      expect(screen.getByText('E0002-bravo')).toBeInTheDocument()
      expect(screen.getByText('E0001-alpha')).toBeInTheDocument()
      expect(screen.getByText('E0003-charlie')).toBeInTheDocument()
    })

    const links = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href*="/p/project-a/e/"]'),
    )
    const ids = links.map((a) => within(a).getByText(/^E\d+-/).textContent)
    expect(ids).toEqual(['E0002-bravo', 'E0003-charlie', 'E0001-alpha'])
  })
})
