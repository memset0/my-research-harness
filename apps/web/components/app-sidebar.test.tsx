// @vitest-environment jsdom

import { ProjectRefSchema } from '@memon/core'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ApiModule from '../lib/api'
import { renderWithQuery } from '../test/utils'

let currentPathname = '/host-a/project-a'
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
    fetchExperimentDocs: vi.fn(),
    fetchReports: vi.fn(),
    fetchWiki: vi.fn(),
    fetchReportsInventory: vi.fn(),
    fetchWikiInventory: vi.fn(),
    fetchJournalCount: vi.fn(),
    fetchCodeReviewsInventory: vi.fn(),
    fetchSlurmStatus: vi.fn(),
    fetchGitStatus: vi.fn(),
    fetchGitStatusFiles: vi.fn(),
    fetchGitDiff: vi.fn(),
  }
})

import {
  fetchCodeReviewsInventory,
  fetchExperimentDocs,
  fetchExperimentsInventory,
  fetchGitStatus,
  fetchGitStatusFiles,
  fetchHosts,
  fetchJournalCount,
  fetchProjects,
  fetchReports,
  fetchReportsInventory,
  fetchSlurmStatus,
  fetchWiki,
  fetchWikiInventory,
} from '../lib/api'
import { AppSidebar, moveProject, orderProjects } from './app-sidebar'
import { type SessionInfo, SessionProvider } from './session-provider'
import { SidebarProvider } from './ui/sidebar'

const STORAGE_KEY = 'memon:sidebar:expanded'
const ORDER_KEY = 'memon:sidebar:project-order'
const ID_A = 'h:host-a/p:project-a'
const ID_B = 'h:host-a/p:project-b'
const PROJECT_A = { host: 'host-a', project: 'project-a' }
const PROJECT_B = { host: 'host-a', project: 'project-b' }

function makeInventoryItem(
  id: string,
): Awaited<ReturnType<typeof fetchExperimentsInventory>>['items'][number] {
  return {
    id,
    slug: id.replace(/^E\d+-/, ''),
    resource: `docs/experiments/${id}/README.md`,
  } as Awaited<ReturnType<typeof fetchExperimentsInventory>>['items'][number]
}

function makeSummary(
  id: string,
  status: ApiModule.ExperimentListRow['frontMatter']['status'],
  title: string,
  displayStatus?: ApiModule.ExperimentListRow['displayStatus'],
): ApiModule.ExperimentListRow {
  return {
    id,
    project: 'project-a',
    readmeMtime: 1,
    displayStatus,
    frontMatter: {
      id,
      slug: id,
      title,
      status,
      archived: false,
      tags: [],
      createdAt: '',
      updatedAt: '',
    },
    runCount: 1,
    hypothesisCount: 0,
    openWarningCount: 0,
    parseErrors: [],
    parseWarnings: [],
    effectiveCreatedAt: '',
    effectiveUpdatedAt: '',
  }
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

const GIT_ENABLED = {
  enabled: true as const,
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
}

function storedExpansion(): string[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[]
}

function projectRow(container: HTMLElement, identity: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(
    `[data-slot="sidebar-project"][data-project="${identity}"]`,
  )
  expect(row).not.toBeNull()
  return row!
}

function projectOrder(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-slot="sidebar-project"]'),
    (row) => row.dataset.project ?? '',
  )
}

function section(row: HTMLElement, key: string): HTMLElement {
  const node = row.querySelector<HTMLElement>(
    `[data-slot="sidebar-section"][data-section="${key}"]`,
  )
  expect(node).not.toBeNull()
  return node!
}

/** jsdom has no DataTransfer; the sidebar only needs these members. */
function dataTransfer() {
  const data = new Map<string, string>()
  return {
    effectAllowed: 'all',
    dropEffect: 'none',
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
  }
}

describe('orderProjects', () => {
  const identity = (project: { id: string }) => project.id

  it('puts projects in the saved order and appends unknown ones in API order', () => {
    const projects = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    expect(orderProjects(projects, identity, ['c', 'a']).map(identity)).toEqual([
      'c',
      'a',
      'b',
      'd',
    ])
  })

  it('ignores saved identities that no longer exist and keeps API order without a saved order', () => {
    const projects = [{ id: 'a' }, { id: 'b' }]
    expect(orderProjects(projects, identity, ['gone', 'b']).map(identity)).toEqual(['b', 'a'])
    expect(orderProjects(projects, identity, []).map(identity)).toEqual(['a', 'b'])
  })
})

describe('moveProject', () => {
  it('moves a project down to just after the target', () => {
    expect(moveProject(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves a project up to just before the target', () => {
    expect(moveProject(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
  })

  it('returns an unchanged copy for a self-drop or unknown identities', () => {
    const order = ['a', 'b']
    const same = moveProject(order, 'a', 'a')
    expect(same).toEqual(order)
    expect(same).not.toBe(order)
    expect(moveProject(order, 'x', 'a')).toEqual(order)
    expect(moveProject(order, 'a', 'x')).toEqual(order)
  })
})

describe('AppSidebar', () => {
  let revealed: Element[] = []

  beforeEach(() => {
    currentPathname = '/host-a/project-a'
    localStorage.clear()
    vi.clearAllMocks()
    revealed = []
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      revealed.push(this)
    })
    vi.mocked(fetchHosts).mockResolvedValue({ hosts: [makeHost('host-a')] })
    vi.mocked(fetchProjects).mockResolvedValue({
      projects: [centralProject('host-a', 'project-a'), centralProject('host-a', 'project-b')],
    })
    vi.mocked(fetchExperimentsInventory).mockResolvedValue({ items: [] })
    vi.mocked(fetchExperimentDocs).mockResolvedValue({ experiments: [] })
    vi.mocked(fetchReports).mockResolvedValue({ reports: [] })
    vi.mocked(fetchWiki).mockResolvedValue({ pages: [] } as never)
    vi.mocked(fetchReportsInventory).mockResolvedValue({ items: [] } as never)
    vi.mocked(fetchWikiInventory).mockResolvedValue({ pages: [] } as never)
    vi.mocked(fetchJournalCount).mockResolvedValue({ totalEvents: 0 } as never)
    vi.mocked(fetchCodeReviewsInventory).mockResolvedValue({ items: [] } as never)
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

  it('lists projects flat across Hosts, each with a host chip showing availability', async () => {
    vi.mocked(fetchHosts).mockResolvedValue({
      hosts: [makeHost('host-b', 'offline', 'Cluster B'), makeHost('host-a', 'online')],
    })
    vi.mocked(fetchProjects).mockResolvedValue({
      projects: [centralProject('host-a', 'project-a'), centralProject('host-b', 'project-c')],
    })
    const { container } = setup()
    await waitFor(() => expect(projectOrder(container)).toEqual([ID_A, 'h:host-b/p:project-c']))
    expect(container.querySelector('[data-slot="sidebar-host-group"]')).toBeNull()

    const rowA = projectRow(container, ID_A)
    const rowC = projectRow(container, 'h:host-b/p:project-c')
    expect(within(rowA).getByText('project-a')).toBeInTheDocument()
    expect(within(rowC).getByText('project-c')).toBeInTheDocument()
    const chipA = rowA.querySelector('[data-slot="sidebar-project-host"]')
    const chipC = rowC.querySelector('[data-slot="sidebar-project-host"]')
    expect(chipA).toHaveTextContent('host-a')
    expect(chipC).toHaveTextContent('host-b')
    await waitFor(() => {
      expect(chipA).toHaveAttribute('title', 'host-a: Online')
      expect(chipC).toHaveAttribute('title', 'host-b: Offline')
    })
  })

  it('orders projects by the saved project-order preference', async () => {
    localStorage.setItem(ORDER_KEY, JSON.stringify([ID_B, ID_A]))
    const { container } = setup()
    await waitFor(() => expect(projectOrder(container)).toEqual([ID_B, ID_A]))
  })

  it('reorders projects by dragging a row onto another and saves the order', async () => {
    const { container } = setup()
    await waitFor(() => expect(projectOrder(container)).toEqual([ID_A, ID_B]))

    const rowA = projectRow(container, ID_A)
    const rowB = projectRow(container, ID_B)
    const handle = rowA.querySelector<HTMLElement>('[draggable="true"]')
    expect(handle).not.toBeNull()

    const transfer = dataTransfer()
    fireEvent.dragStart(handle!, { dataTransfer: transfer })
    expect(transfer.getData('text/plain')).toBe(ID_A)
    fireEvent.dragEnter(rowB, { dataTransfer: transfer })
    fireEvent.dragOver(rowB, { dataTransfer: transfer })
    fireEvent.drop(rowB, { dataTransfer: transfer })
    fireEvent.dragEnd(handle!, { dataTransfer: transfer })

    await waitFor(() => expect(projectOrder(container)).toEqual([ID_B, ID_A]))
    expect(JSON.parse(localStorage.getItem(ORDER_KEY) ?? 'null')).toEqual([ID_B, ID_A])
  })

  it('does not offer dragging when only one project is listed', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({
      projects: [centralProject('host-a', 'project-a')],
    })
    const { container } = setup()
    await waitFor(() => expect(projectOrder(container)).toEqual([ID_A]))
    expect(projectRow(container, ID_A).querySelector('[draggable="true"]')).toBeNull()
  })

  it('keeps the active project open with its sections linking to their list pages', async () => {
    const { container } = setup()
    await waitFor(() => expect(projectOrder(container)).toHaveLength(2))
    const rowA = projectRow(container, ID_A)
    const sections = Array.from(rowA.querySelectorAll<HTMLElement>('[data-slot="sidebar-section"]'))
    expect(sections.map((node) => node.dataset.section)).toEqual([
      'experiments',
      'journal',
      'reports',
      'code-review',
      'wiki',
    ])
    const links = sections.map((node) => within(node).getByRole('link'))
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/host-a/project-a',
      '/host-a/project-a/journal',
      '/host-a/project-a/reports',
      '/host-a/project-a/code-review',
      '/host-a/project-a/wiki',
    ])
    expect(links.map((link) => link.textContent?.replace(/\d+$/, ''))).toEqual([
      'Experiments',
      'Journal',
      'Reports',
      'Code Review',
      'Wiki',
    ])
    // Each section shows its TabBadge count.
    for (const node of sections) expect(node.querySelector('[data-slot="count"]')).not.toBeNull()
    // The overview page is the Experiments section's own page.
    expect(links[0]).toHaveAttribute('aria-current', 'page')
    expect(links[2]).not.toHaveAttribute('aria-current')
    // Only list-backed sections can be expanded.
    expect(
      within(sections[0]!).getByRole('button', { name: 'Collapse Experiments' }),
    ).toHaveAttribute('aria-expanded', 'true')
    expect(within(sections[1]!).queryByRole('button')).toBeNull()
    expect(within(sections[2]!).getByRole('button', { name: 'Expand Reports' })).toBeInTheDocument()
    expect(within(sections[3]!).queryByRole('button')).toBeNull()
    expect(within(sections[4]!).getByRole('button', { name: 'Expand Wiki' })).toBeInTheDocument()
    // The other project starts closed and renders no sections.
    expect(projectRow(container, ID_B).querySelector('[data-slot="sidebar-section"]')).toBeNull()
    // Being always open is not a stored expansion.
    expect(storedExpansion()).not.toContain(ID_A)
  })

  it('clicking another project toggles its expansion and persists it', async () => {
    const { container } = setup()
    const projectB = await screen.findByText('project-b')
    await userEvent.click(projectB)
    await waitFor(() => expect(storedExpansion()).toContain(ID_B))
    expect(section(projectRow(container, ID_B), 'journal').querySelector('a')).toHaveAttribute(
      'href',
      '/host-a/project-b/journal',
    )
    await userEvent.click(projectB)
    await waitFor(() => expect(storedExpansion()).not.toContain(ID_B))
    expect(projectRow(container, ID_B).querySelector('[data-slot="sidebar-section"]')).toBeNull()
  })

  it('expands Reports and Wiki to list their items as links and persists the section', async () => {
    vi.mocked(fetchReports).mockResolvedValue({
      reports: [
        { id: 'R0001', slug: 'first-report', title: 'First report', mtime: 1 },
        { id: 'R0002', slug: 'second-report', title: null, mtime: 2 },
      ] as never,
    })
    vi.mocked(fetchWiki).mockResolvedValue({
      pages: [
        { id: 'W0003', slug: 'later', title: 'Later page' },
        { id: 'W0001', slug: 'first', title: 'First page' },
      ],
    } as never)
    const { container } = setup()
    await waitFor(() => expect(projectOrder(container)).toHaveLength(2))
    const rowA = projectRow(container, ID_A)

    await userEvent.click(within(rowA).getByRole('button', { name: 'Expand Reports' }))
    const reports = section(rowA, 'reports')
    await waitFor(() => expect(reports.querySelectorAll('[data-sidebar-item]')).toHaveLength(2))
    const reportLinks = Array.from(
      reports.querySelectorAll<HTMLAnchorElement>('[data-sidebar-item]'),
    )
    expect(reportLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/host-a/project-a/r/1',
      '/host-a/project-a/r/2',
    ])
    expect(reportLinks[0]).toHaveTextContent('First report')
    // An untitled Report falls back to its slug.
    expect(reportLinks[1]).toHaveTextContent('second-report')
    expect(fetchReports).toHaveBeenCalledWith(PROJECT_A)

    await userEvent.click(within(rowA).getByRole('button', { name: 'Expand Wiki' }))
    const wiki = section(rowA, 'wiki')
    await waitFor(() => expect(wiki.querySelectorAll('[data-sidebar-item]')).toHaveLength(2))
    // Wiki pages are listed in ID order.
    expect(
      Array.from(wiki.querySelectorAll('[data-sidebar-item]'), (link) => link.getAttribute('href')),
    ).toEqual(['/host-a/project-a/w/1', '/host-a/project-a/w/3'])

    await waitFor(() =>
      expect(storedExpansion()).toEqual(
        expect.arrayContaining([`${ID_A}#reports`, `${ID_A}#wiki`]),
      ),
    )
    await userEvent.click(within(rowA).getByRole('button', { name: 'Collapse Reports' }))
    expect(reports.querySelector('[data-sidebar-item]')).toBeNull()
    await waitFor(() => expect(storedExpansion()).not.toContain(`${ID_A}#reports`))
  })

  it('retains identity navigation in ID order when metadata is unavailable', async () => {
    vi.mocked(fetchExperimentsInventory).mockResolvedValue({
      items: [
        makeInventoryItem('E0003-charlie'),
        makeInventoryItem('E0001-alpha'),
        makeInventoryItem('E0002-bravo'),
      ],
    })

    const { container } = setup()
    // project-a is active on its overview, so its Experiments section is open.
    await waitFor(() => {
      expect(screen.getByText('E0002-bravo')).toBeInTheDocument()
      expect(screen.getByText('E0001-alpha')).toBeInTheDocument()
      expect(screen.getByText('E0003-charlie')).toBeInTheDocument()
    })

    const links = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href*="/host-a/project-a/e/"]'),
    )
    const ids = links.map((a) => within(a).getByText(/^E\d+-/).textContent)
    expect(ids).toEqual(['E0001-alpha', 'E0002-bravo', 'E0003-charlie'])
  })

  it('retains inventory links under unavailable status when summary requests fail', async () => {
    vi.mocked(fetchExperimentsInventory).mockResolvedValue({
      items: [makeInventoryItem('E0001-alpha')],
    })
    vi.mocked(fetchExperimentDocs).mockRejectedValue(new Error('Summary unavailable'))
    setup()
    expect(
      await screen.findByRole('button', { name: 'Status unavailable experiments (1)' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /E0001.*Unknown.*E0001-alpha/ })).toHaveAttribute(
      'href',
      '/host-a/project-a/e/1',
    )
    expect(screen.queryByRole('button', { name: 'Active experiments (1)' })).not.toBeInTheDocument()
  })

  it('opens the current retired group, reveals the active Experiment and keeps inventory-only entries', async () => {
    currentPathname = '/host-a/project-a/e/3'
    vi.mocked(fetchExperimentsInventory).mockResolvedValue({
      items: [makeInventoryItem('E0003-old'), makeInventoryItem('E0004-unreadable')],
    })
    vi.mocked(fetchExperimentDocs).mockResolvedValue({
      experiments: [
        makeSummary('E0001-completed', 'ACTIVE', 'Completed comparison', 'COMPLETED'),
        makeSummary('E0002-running', 'ACTIVE', 'Current comparison', 'RUNNING'),
        makeSummary(
          'E0003-old',
          'RETIRED',
          'Retired comparison with a readable long title',
          'RETIRED',
        ),
        makeSummary('E0005-archive', 'ARCHIVED', 'Archived comparison', 'ARCHIVED'),
      ],
    })
    const { container } = setup()
    const retired = await screen.findByRole('link', {
      name: /Retired comparison with a readable long title/,
    })
    expect(retired).toHaveAttribute('aria-current', 'page')
    expect(retired).toHaveAttribute(
      'title',
      'E0003-old · Retired comparison with a readable long title',
    )
    await waitFor(() => expect(revealed).toContain(retired))
    // On an Experiment page the section link itself is not the current page.
    expect(
      within(section(projectRow(container, ID_A), 'experiments')).getByRole('link', {
        name: /^Experiments/,
      }),
    ).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'Retired experiments (1)' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Archived experiments (1)' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getByText('E0004-unreadable')).toBeInTheDocument()
    const active = container.querySelector('[data-experiment-group="ACTIVE"]')!
    expect(
      within(active as HTMLElement)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/host-a/project-a/e/2', '/host-a/project-a/e/1'])
    await userEvent.click(screen.getByRole('button', { name: 'Archived experiments (1)' }))
    expect(screen.getByRole('link', { name: /Archived comparison/ })).toBeInTheDocument()
  })

  it('opens the active section on an item page and scrolls the active Wiki page into view', async () => {
    currentPathname = '/host-a/project-a/w/2'
    vi.mocked(fetchWiki).mockResolvedValue({
      pages: [
        { id: 'W0001', slug: 'first', title: 'First page' },
        { id: 'W0002', slug: 'second', title: 'Second page' },
      ],
    } as never)
    const { container } = setup()
    const current = await screen.findByRole('link', { name: /W0002.*Second page/ })
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).toHaveAttribute('href', '/host-a/project-a/w/2')
    expect(screen.getByRole('link', { name: /W0001.*First page/ })).not.toHaveAttribute(
      'aria-current',
    )
    await waitFor(() => expect(revealed).toEqual([current]))
    const wiki = section(projectRow(container, ID_A), 'wiki')
    expect(within(wiki).getByRole('button', { name: 'Collapse Wiki' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    // The active section is open without being written to storage.
    expect(storedExpansion()).not.toContain(`${ID_A}#wiki`)
  })

  it('renders a compact git pill per project row when git status is available', async () => {
    vi.mocked(fetchGitStatus).mockImplementation(async (project) => ({
      ...GIT_ENABLED,
      branch:
        (typeof project === 'string' ? project : project.project) === 'project-a'
          ? 'main'
          : 'feature/x',
    }))
    const { container } = setup()
    await waitFor(() => {
      const pills = container.querySelectorAll('[data-slot="git-status-pill-compact"]')
      expect(pills.length).toBe(2)
    })
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('feature/x')).toBeInTheDocument()
  })

  it('renders the git pill as a real button outside the project collapsible trigger', async () => {
    vi.mocked(fetchGitStatus).mockResolvedValue(GIT_ENABLED)
    const { container } = setup()
    const rowA = await waitFor(() => projectRow(container, ID_A))
    const trigger = await waitFor(() => {
      const t = rowA.querySelector<HTMLElement>('[data-slot="git-status-pill-trigger"]')
      expect(t).not.toBeNull()
      return t!
    })
    expect(trigger.tagName).toBe('BUTTON')
    expect(trigger).toHaveAccessibleName('View git diff for project-a')
    expect(trigger.querySelector('[data-slot="git-status-pill-compact"]')).not.toBeNull()
    const collapsibleTrigger = within(rowA).getByText('project-a').closest('button')!
    expect(collapsibleTrigger).not.toBe(trigger)
    expect(collapsibleTrigger.contains(trigger)).toBe(false)
    expect(trigger.contains(collapsibleTrigger)).toBe(false)
  })

  it('clicking a git pill opens the diff dialog without toggling the project', async () => {
    vi.mocked(fetchGitStatus).mockResolvedValue(GIT_ENABLED)
    const { container } = setup()
    const rowB = await waitFor(() => projectRow(container, ID_B))
    const trigger = await waitFor(() => {
      const t = rowB.querySelector<HTMLElement>('[data-slot="git-status-pill-trigger"]')
      expect(t).not.toBeNull()
      return t!
    })
    await userEvent.click(trigger)
    await waitFor(() => {
      expect(document.body.querySelector('[data-slot="git-diff-dialog"]')).not.toBeNull()
    })
    expect(vi.mocked(fetchGitStatusFiles).mock.calls[0]?.[0]).toEqual(PROJECT_B)
    // project-b stayed collapsed: the click did not reach its CollapsibleTrigger.
    expect(rowB.querySelector('[data-slot="sidebar-section"]')).toBeNull()
    expect(storedExpansion()).not.toContain(ID_B)
  })

  it('non-git project: sidebar pill renders bare (no click trigger wrapper)', async () => {
    // Default beforeEach mock returns enabled: false for all projects.
    const { container } = setup()
    await waitFor(() => expect(screen.getByText('project-a')).toBeInTheDocument())
    expect(container.querySelectorAll('[data-slot="git-status-pill-compact"]').length).toBe(0)
    expect(container.querySelectorAll('[data-slot="git-status-pill-trigger"]').length).toBe(0)
  })

  it('renders all 12 experiments (no "View more" cap)', async () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      makeInventoryItem(`E${String(i + 1).padStart(4, '0')}-x${i}`),
    )
    vi.mocked(fetchExperimentsInventory).mockResolvedValue({ items })
    const { container } = setup()
    await waitFor(() => {
      const links = container.querySelectorAll('a[href*="/host-a/project-a/e/"]')
      expect(links.length).toBe(12)
    })
    // Confirm no "View more" / "Show fewer" affordance in the DOM.
    expect(screen.queryByText(/View more/i)).toBeNull()
    expect(screen.queryByText(/Show fewer/i)).toBeNull()
  })

  it('off-project routes render restored expansion without reading project items', async () => {
    // Settings-style route: no project owns it, but storage says project-a and
    // all of its list sections were left open. Rendering the tree must not
    // read its items.
    currentPathname = '/manage/file-access'
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([ID_A, `${ID_A}#experiments`, `${ID_A}#reports`, `${ID_A}#wiki`]),
    )

    const { container } = setup()
    const rowA = await waitFor(() => {
      const row = projectRow(container, ID_A)
      expect(row.querySelector('[data-slot="sidebar-section"]')).not.toBeNull()
      return row
    })
    expect(
      within(section(rowA, 'experiments')).getByRole('button', { name: 'Collapse Experiments' }),
    ).toHaveAttribute('aria-expanded', 'true')
    expect(rowA.querySelector('[data-sidebar-item]')).toBeNull()
    expect(fetchExperimentDocs).not.toHaveBeenCalled()
    expect(fetchReports).not.toHaveBeenCalled()
    expect(fetchWiki).not.toHaveBeenCalled()

    // Opening a project in this session IS an explicit read intent.
    vi.mocked(fetchExperimentsInventory).mockResolvedValue({
      items: [makeInventoryItem('E0001-alpha')],
    })
    await userEvent.click(within(projectRow(container, ID_B)).getByText('project-b'))
    const rowB = projectRow(container, ID_B)
    await userEvent.click(within(rowB).getByRole('button', { name: 'Expand Experiments' }))
    await userEvent.click(within(rowB).getByRole('button', { name: 'Expand Reports' }))
    await waitFor(() => expect(within(rowB).getByText('E0001-alpha')).toBeInTheDocument())
    expect(fetchExperimentDocs).toHaveBeenCalledWith(PROJECT_B)
    expect(fetchReports).toHaveBeenCalledWith(PROJECT_B)
    expect(fetchExperimentDocs).not.toHaveBeenCalledWith(PROJECT_A)
    expect(fetchReports).not.toHaveBeenCalledWith(PROJECT_A)
    expect(fetchWiki).not.toHaveBeenCalled()
    expect(rowA.querySelector('[data-sidebar-item]')).toBeNull()
  })

  it('central: duplicate Project names retain Host-qualified persistence, fetches, and links', async () => {
    currentPathname = '/host-a/shared-project/e/1'
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
      const row = projectRow(container, 'h:host-a/p:shared-project')
      expect(within(row).getByText('E0001-alpha')).toBeInTheDocument()
      return row
    })
    const hostB = projectRow(container, 'h:host-b/p:shared-project')
    expect(hostA.querySelector('[data-slot="sidebar-project-host"]')).toHaveTextContent('host-a')
    expect(hostB.querySelector('[data-slot="sidebar-project-host"]')).toHaveTextContent('host-b')
    expect(hostB.querySelector('[data-slot="sidebar-section"]')).toBeNull()

    await userEvent.click(within(hostB).getByText('shared-project'))
    await userEvent.click(within(hostB).getByRole('button', { name: 'Expand Experiments' }))
    await waitFor(() => {
      expect(within(hostB).getByText('E0001-alpha')).toBeInTheDocument()
    })

    const hostALink = hostA.querySelector('a[href="/host-a/shared-project/e/1"]')
    const hostBLink = hostB.querySelector('a[href="/host-b/shared-project/e/1"]')
    expect(hostALink).toHaveAttribute('aria-current', 'page')
    expect(hostBLink).not.toHaveAttribute('aria-current')
    expect(section(hostB, 'journal').querySelector('a')).toHaveAttribute(
      'href',
      '/host-b/shared-project/journal',
    )
    expect(fetchExperimentsInventory).toHaveBeenCalledWith({
      host: 'host-a',
      project: 'shared-project',
    })
    expect(fetchExperimentsInventory).toHaveBeenCalledWith({
      host: 'host-b',
      project: 'shared-project',
    })
    expect(fetchExperimentDocs).toHaveBeenCalledWith({ host: 'host-a', project: 'shared-project' })
    expect(fetchExperimentDocs).toHaveBeenCalledWith({ host: 'host-b', project: 'shared-project' })
    expect(fetchGitStatus).toHaveBeenCalledWith({ host: 'host-a', project: 'shared-project' })
    expect(fetchGitStatus).toHaveBeenCalledWith({ host: 'host-b', project: 'shared-project' })
    await waitFor(() => {
      expect(storedExpansion()).toEqual(
        expect.arrayContaining([
          'h:host-b/p:shared-project',
          'h:host-b/p:shared-project#experiments',
        ]),
      )
    })
    expect(storedExpansion().some((key) => key.startsWith('h:host-a/'))).toBe(false)
  })

  it('central viewer: lists only Host-qualified scoped projects', async () => {
    currentPathname = '/'
    vi.mocked(fetchProjects).mockResolvedValue({
      projects: [
        centralProject('host-a', 'project-a'),
        centralProject('host-a', 'project-b'),
        centralProject('host-b', 'project-b'),
      ],
    })

    const { container } = setup({
      role: 'viewer',
      scopeProjects: ['project-a'],
      scopeProjectRefs: [ProjectRefSchema.parse({ host: 'host-b', project: 'project-b' })],
    })
    await waitFor(() => expect(projectOrder(container)).toEqual(['h:host-b/p:project-b']))
    // A bare scoped name never authorizes a central project.
    expect(screen.queryByText('project-a')).toBeNull()
    expect(screen.queryByRole('link', { name: 'File access' })).toBeNull()
  })

  it('central viewer: shows no projects when the project list is refused', async () => {
    currentPathname = '/'
    vi.mocked(fetchProjects).mockRejectedValue(
      new Error('403 Host-qualified viewer scope required'),
    )

    const { container } = setup({ role: 'viewer', scopeProjects: ['shared-project'] })
    await waitFor(() => expect(fetchProjects).toHaveBeenCalled())
    expect(projectOrder(container)).toEqual([])
    expect(screen.queryByText('shared-project')).toBeNull()
  })

  it('owner: lists every central project and the File access link', async () => {
    currentPathname = '/'
    vi.mocked(fetchProjects).mockResolvedValue({
      projects: [centralProject('host-a', 'project-a'), centralProject('host-b', 'project-b')],
    })
    const { container } = setup()
    await waitFor(() => expect(projectOrder(container)).toEqual([ID_A, 'h:host-b/p:project-b']))
    expect(screen.getByRole('link', { name: 'File access' })).toHaveAttribute(
      'href',
      '/manage/file-access',
    )
  })
})
