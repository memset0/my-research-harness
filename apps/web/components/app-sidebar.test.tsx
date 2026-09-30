// @vitest-environment jsdom

import { ProjectRefSchema } from '@memon/core'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ApiModule from '../lib/api'
import { renderWithQuery } from '../test/utils'

let currentPathname = '/p/project-a'
vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return {
    ...actual,
    fetchHosts: vi.fn(),
    fetchProjects: vi.fn(),
    fetchExperimentsInventory: vi.fn(),
    fetchSlurmStatus: vi.fn(),
    fetchGitStatus: vi.fn(),
    fetchGitStatusFiles: vi.fn(),
    fetchGitDiff: vi.fn(),
  }
})

import {
  fetchExperimentsInventory,
  fetchGitStatus,
  fetchGitStatusFiles,
  fetchHosts,
  fetchProjects,
  fetchSlurmStatus,
} from '../lib/api'
import { AppSidebar } from './app-sidebar'
import { type SessionInfo, SessionProvider } from './session-provider'
import { SidebarProvider } from './ui/sidebar'

const STORAGE_KEY = 'memon:sidebar:expanded'

function makeInventoryItem(
  id: string,
): Awaited<ReturnType<typeof fetchExperimentsInventory>>['items'][number] {
  return {
    id,
    slug: id.replace(/^E\d+-/, ''),
    resource: `docs/experiments/${id}/README.md`,
  } as Awaited<ReturnType<typeof fetchExperimentsInventory>>['items'][number]
}

function makeHost(
  host: string,
  state: 'online' | 'offline' = 'online',
  label?: string,
): Awaited<ReturnType<typeof fetchHosts>>['hosts'][number] {
  return {
    host,
    ...(label ? { label } : {}),
    state,
    diagnostic: state === 'offline' ? 'Backend is unavailable' : null,
    lastSuccessfulCheckAt: state === 'online' ? '2026-08-26T17:00:00.000Z' : null,
    centralRelease: '6.0.0',
    backendRelease: state === 'online' ? '6.0.0' : null,
    backendRevision: state === 'online' ? '0123456789abcdef' : null,
    capabilities:
      state === 'online'
        ? {
            projects: true,
            mutations: true,
            events: true,
            logStreaming: true,
            reportAssets: true,
            wikiAssets: true,
            git: true,
            shares: true,
            slurm: false,
          }
        : null,
  } as Awaited<ReturnType<typeof fetchHosts>>['hosts'][number]
}

function centralProject(host: string, project: string) {
  return {
    mode: 'central' as const,
    ...ProjectRefSchema.parse({ host, project }),
    name: project,
  }
}

describe('AppSidebar', () => {
  beforeEach(() => {
    currentPathname = '/p/project-a'
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(fetchHosts).mockRejectedValue(new Error('Host registry unavailable'))
    vi.mocked(fetchProjects).mockResolvedValue({
      projects: [
        {
          mode: 'standalone',
          host: null,
          project: 'project-a',
          name: 'project-a',
          root: '/p/a',
          exclude: [],
        },
        {
          mode: 'standalone',
          host: null,
          project: 'project-b',
          name: 'project-b',
          root: '/p/b',
          exclude: [],
        },
      ],
    })
    vi.mocked(fetchExperimentsInventory).mockResolvedValue({ items: [] })
    // SlurmStatusWidget + GitStatusPill render `null` when their query
    // returns `enabled: false`, so default both to that path to keep the
    // sidebar tests focused on project / experiment rendering.
    vi.mocked(fetchSlurmStatus).mockResolvedValue({ enabled: false })
    vi.mocked(fetchGitStatus).mockResolvedValue({
      enabled: false,
      reason: 'not-a-repo',
    })
    // Default git-status-files mock — used by the GitDiffDialog when the
    // sidebar pill-trigger tests open it.
    vi.mocked(fetchGitStatusFiles).mockResolvedValue({
      enabled: true,
      branch: 'main',
      detached: false,
      sha: '0123456',
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      untracked: [],
    })
  })

  function setup(session: SessionInfo = { role: 'owner', scopeProjects: [] }) {
    return renderWithQuery(
      <SessionProvider value={session}>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </SessionProvider>,
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

  it('renders experiment navigation in slug order', async () => {
    vi.mocked(fetchExperimentsInventory).mockResolvedValue({
      items: [
        makeInventoryItem('E0003-charlie'),
        makeInventoryItem('E0001-alpha'),
        makeInventoryItem('E0002-bravo'),
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
    expect(ids).toEqual(['E0001-alpha', 'E0002-bravo', 'E0003-charlie'])
  })

  it('renders a compact git pill per project row when git status is available', async () => {
    vi.mocked(fetchGitStatus).mockImplementation(async (project) => ({
      enabled: true,
      branch: project === 'project-a' ? 'main' : 'feature/x',
      detached: false,
      sha: '0123456',
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      dirty: false,
    }))
    const { container } = setup()
    await waitFor(() => {
      const pills = container.querySelectorAll('[data-slot="git-status-pill-compact"]')
      expect(pills.length).toBe(2)
    })
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('feature/x')).toBeInTheDocument()
  })

  it('renders the project row layout unchanged when git pill is disabled', async () => {
    // Default beforeEach mock returns enabled: false. Confirm no pill markup.
    const { container } = setup()
    await waitFor(() => expect(screen.getByText('project-a')).toBeInTheDocument())
    expect(container.querySelectorAll('[data-slot="git-status-pill-compact"]').length).toBe(0)
  })

  it('header has banner styling (bg + dividers), no chevron, name yields width to pill', async () => {
    vi.mocked(fetchGitStatus).mockResolvedValue({
      enabled: true,
      branch: 'main',
      detached: false,
      sha: '0123456',
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      dirty: false,
    })
    const { container } = setup()
    await waitFor(() => {
      expect(
        container.querySelectorAll('[data-slot="git-status-pill-compact"]').length,
      ).toBeGreaterThan(0)
    })

    // Find the project-a header trigger and walk its children.
    const headerNameSpan = await screen.findByText('project-a')
    const trigger = headerNameSpan.closest('[data-slot="sidebar-group-label"]')
    expect(trigger).not.toBeNull()
    const triggerEl = trigger as HTMLElement

    // Banner styling lives on the SidebarGroupLabel: tinted background +
    // top/bottom dividers. These are the affordances that replaced the
    // chevron indicator — assert they're present.
    expect(triggerEl.className).toMatch(/border-y/)
    expect(triggerEl.className).toMatch(/border-sidebar-border/)
    expect(triggerEl.className).toMatch(/bg-sidebar-accent/)

    // The trigger via asChild=Slot renders a single button child whose
    // own children are now exactly [name <span>, pill <span>] — no
    // chevron <svg>.
    const buttonChild = triggerEl.querySelector('button')
    const innerHost = buttonChild ?? triggerEl
    const innerChildren = Array.from(innerHost.children) as HTMLElement[]
    expect(innerChildren).toHaveLength(2)

    // Assert no chevron survives anywhere inside the header.
    expect(innerHost.querySelector('svg.lucide-chevron-down')).toBeNull()

    const [nameSpan, pillSlot] = innerChildren
    expect(nameSpan!.textContent).toBe('project-a')
    expect(nameSpan!.className).toMatch(/uppercase/)
    expect(nameSpan!.className).toMatch(/tracking-wider/)
    // Name yields width (min-w-0 flex-1) so the pill keeps its natural
    // size and the name truncates first when space runs out.
    expect(nameSpan!.className).toMatch(/min-w-0/)
    expect(nameSpan!.className).toMatch(/flex-1/)
    expect(nameSpan!.className).toMatch(/truncate/)
    // The second child is now either the bare pill (non-git project) or
    // the click-target wrapper around it (git project). In this test
    // the git query resolves to `enabled: true`, so we expect the
    // wrapper — verify that its inner pill still has the expected
    // data-slot and `shrink-0`.
    expect(pillSlot!.getAttribute('data-slot')).toBe('git-status-pill-trigger')
    const innerPill = pillSlot!.querySelector('[data-slot="git-status-pill-compact"]')
    expect(innerPill).not.toBeNull()
    expect(innerPill!.className).toMatch(/shrink-0/)
    expect(innerPill!.className).not.toMatch(/max-w-/)
    expect(innerPill!.className).not.toMatch(/overflow-hidden/)
  })

  it('project name span carries uppercase class and is NOT font-mono', async () => {
    setup()
    const headerNameSpan = await screen.findByText('project-a')
    expect(headerNameSpan.className).toMatch(/uppercase/)
    expect(headerNameSpan.className).not.toMatch(/font-mono/)
  })

  it('clicking the sidebar git pill opens the diff dialog AND does not toggle the section', async () => {
    vi.mocked(fetchGitStatus).mockResolvedValue({
      enabled: true,
      branch: 'main',
      detached: false,
      sha: '0123456',
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      dirty: false,
    })
    setup()
    const trigger = await waitFor(() => {
      const t = document.body.querySelector(
        '[data-slot="git-status-pill-trigger"]',
      ) as HTMLElement | null
      expect(t).not.toBeNull()
      return t as HTMLElement
    })
    // project-a is the default active project, so its section starts EXPANDED.
    // Click the pill → dialog opens. Section stays expanded (the click did
    // NOT bubble up to the CollapsibleTrigger).
    await userEvent.click(trigger)
    await waitFor(() => {
      expect(document.body.querySelector('[data-slot="git-diff-dialog"]')).not.toBeNull()
    })
    // Section still expanded: localStorage still contains project-a.
    const stored = localStorage.getItem(STORAGE_KEY) ?? '[]'
    expect(stored).toContain('project-a')
  })

  it('non-git project: sidebar pill renders bare (no click trigger wrapper)', async () => {
    // Default beforeEach mock returns enabled: false for all projects.
    const { container } = setup()
    await waitFor(() => expect(screen.getByText('project-a')).toBeInTheDocument())
    expect(container.querySelectorAll('[data-slot="git-status-pill-trigger"]').length).toBe(0)
  })

  it('renders all 12 experiments (no "View more" cap)', async () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      makeInventoryItem(`E${String(i + 1).padStart(4, '0')}-x${i}`),
    )
    vi.mocked(fetchExperimentsInventory).mockResolvedValue({ items })
    const { container } = setup()
    await waitFor(() => {
      const links = container.querySelectorAll('a[href*="/p/project-a/e/"]')
      expect(links.length).toBe(12)
    })
    // Confirm no "View more" / "Show fewer" affordance in the DOM.
    expect(screen.queryByText(/View more/i)).toBeNull()
    expect(screen.queryByText(/Show fewer/i)).toBeNull()
  })

  it('off-project routes do not read experiment inventories for persisted expanded sections', async () => {
    // Settings-style route: no project owns it, but storage says project-a's
    // section was left open. Rendering its chrome must not discover its docs.
    currentPathname = '/manage/file-access'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['project-a']))

    setup()
    await waitFor(() => expect(screen.getByText('project-a')).toBeInTheDocument())
    expect(fetchExperimentsInventory).not.toHaveBeenCalled()

    // Expanding a section in this session IS an explicit read intent.
    vi.mocked(fetchExperimentsInventory).mockResolvedValue({
      items: [makeInventoryItem('E0001-alpha')],
    })
    await userEvent.click(screen.getByText('project-b'))
    await waitFor(() => expect(fetchExperimentsInventory).toHaveBeenCalledWith('project-b'))
    expect(fetchExperimentsInventory).not.toHaveBeenCalledWith('project-a')
  })

  it('central: keeps configured Host order and shows offline Hosts without Projects', async () => {
    currentPathname = '/h/host-a/p/project-a'
    vi.mocked(fetchHosts).mockResolvedValue({
      hosts: [
        makeHost('host-b', 'offline', 'Cluster B'),
        makeHost('host-a', 'online', 'Cluster A'),
      ],
    })
    vi.mocked(fetchProjects).mockResolvedValue({
      projects: [centralProject('host-a', 'project-a')],
    })

    const { container } = setup()
    await waitFor(() => {
      expect(container.querySelectorAll('[data-slot="sidebar-host-group"]')).toHaveLength(2)
    })
    const groups = Array.from(
      container.querySelectorAll<HTMLElement>('[data-slot="sidebar-host-group"]'),
    )
    expect(groups.map((group) => group.dataset.host)).toEqual(['host-b', 'host-a'])
    expect(within(groups[0]!).getByText('Cluster B')).toBeInTheDocument()
    expect(within(groups[0]!).getByText('host-b')).toBeInTheDocument()
    expect(within(groups[0]!).getByText('Offline')).toHaveAttribute('data-usable', 'false')
    expect(within(groups[0]!).getByText('No projects available')).toBeInTheDocument()
    expect(within(groups[1]!).getByText('Online')).toHaveAttribute('data-usable', 'true')
  })

  it('central: duplicate Project names retain Host-qualified persistence, fetches, and links', async () => {
    currentPathname = '/h/host-a/p/shared-project/e/E0001-alpha'
    vi.mocked(fetchHosts).mockResolvedValue({
      hosts: [makeHost('host-a'), makeHost('host-b')],
    })
    vi.mocked(fetchProjects).mockResolvedValue({
      projects: [
        centralProject('host-a', 'shared-project'),
        centralProject('host-b', 'shared-project'),
      ],
    })
    vi.mocked(fetchExperimentsInventory).mockResolvedValue({
      items: [makeInventoryItem('E0001-alpha')],
    })

    const { container } = setup()
    const hostA = await waitFor(() => {
      const group = container.querySelector<HTMLElement>('[data-host="host-a"]')
      expect(group).not.toBeNull()
      expect(within(group!).getByText('E0001-alpha')).toBeInTheDocument()
      return group!
    })
    const hostB = container.querySelector<HTMLElement>('[data-host="host-b"]')!
    await userEvent.click(within(hostB).getByText('shared-project'))
    await waitFor(() => {
      expect(within(hostB).getByText('E0001-alpha')).toBeInTheDocument()
    })

    const hostALink = hostA.querySelector('a[href="/h/host-a/p/shared-project/e/E0001-alpha"]')
    const hostBLink = hostB.querySelector('a[href="/h/host-b/p/shared-project/e/E0001-alpha"]')
    expect(hostALink).toHaveAttribute('data-active', 'true')
    expect(hostBLink).toHaveAttribute('data-active', 'false')
    expect(fetchExperimentsInventory).toHaveBeenCalledWith({
      host: 'host-a',
      project: 'shared-project',
    })
    expect(fetchExperimentsInventory).toHaveBeenCalledWith({
      host: 'host-b',
      project: 'shared-project',
    })
    expect(fetchGitStatus).toHaveBeenCalledWith({ host: 'host-a', project: 'shared-project' })
    expect(fetchGitStatus).toHaveBeenCalledWith({ host: 'host-b', project: 'shared-project' })
    await waitFor(() => {
      const stored = localStorage.getItem(STORAGE_KEY) ?? ''
      expect(stored).toContain('h:host-a/p:shared-project')
      expect(stored).toContain('h:host-b/p:shared-project')
    })
  })

  it('central viewer: displays Host status but does not infer Project authorization by name', async () => {
    currentPathname = '/'
    vi.mocked(fetchHosts).mockResolvedValue({
      hosts: [makeHost('host-a', 'online', 'Cluster A')],
    })
    vi.mocked(fetchProjects).mockRejectedValue(
      new Error('403 Host-qualified viewer scope required'),
    )

    const { container } = setup({ role: 'viewer', scopeProjects: ['shared-project'] })
    const host = await waitFor(() => {
      const group = container.querySelector<HTMLElement>('[data-host="host-a"]')
      expect(group).not.toBeNull()
      return group!
    })
    expect(within(host).getByText('Cluster A')).toBeInTheDocument()
    expect(within(host).getByText('Online')).toBeInTheDocument()
    expect(within(host).getByText('No projects available')).toBeInTheDocument()
    expect(within(host).queryByText('shared-project')).toBeNull()
  })
})
