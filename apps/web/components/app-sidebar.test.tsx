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

/** The retired persistence key: expansion must never be written there again. */
const LEGACY_EXPANDED_KEY = 'memon:sidebar:expanded'
const ORDER_KEY = 'memon:sidebar:project-order'
const ID_A = 'h:host-a/p:project-a'
const ID_B = 'h:host-a/p:project-b'
const PROJECT_A = { host: 'host-a', project: 'project-a' }
const PROJECT_B = { host: 'host-a', project: 'project-b' }

function makeSummary(
  id: string,
  status: ApiModule.ExperimentListRow['frontMatter']['status'],
  title: string,
  options: {
    effectiveUpdatedAt?: string
    readmeMtime?: number
    displayStatus?: ApiModule.ExperimentListRow['displayStatus']
    archived?: boolean
    parseErrors?: { message: string }[]
  } = {},
): ApiModule.ExperimentListRow {
  return {
    id,
    project: 'project-a',
    readmeMtime: options.readmeMtime ?? 1,
    displayStatus: options.displayStatus,
    frontMatter: {
      id,
      slug: id,
      title,
      status,
      archived: options.archived ?? false,
      tags: [],
      createdAt: '',
      updatedAt: '',
    },
    runCount: 1,
    hypothesisCount: 0,
    openWarningCount: 0,
    parseErrors: options.parseErrors ?? [],
    parseWarnings: [],
    effectiveCreatedAt: '',
    effectiveUpdatedAt: options.effectiveUpdatedAt ?? '',
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

function expectNoPersistedExpansion() {
  expect(localStorage.getItem(LEGACY_EXPANDED_KEY)).toBeNull()
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

function itemLinks(node: HTMLElement): HTMLAnchorElement[] {
  return Array.from(node.querySelectorAll<HTMLAnchorElement>('[data-sidebar-item]'))
}

function itemHrefs(node: HTMLElement): (string | null)[] {
  return itemLinks(node).map((link) => link.getAttribute('href'))
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
    // Count endpoints: the sidebar no longer reads them; the mocks stay so a
    // regression shows up as a call instead of a network error.
    vi.mocked(fetchReportsInventory).mockResolvedValue({ items: [] } as never)
    vi.mocked(fetchWikiInventory).mockResolvedValue({ pages: [] } as never)
    vi.mocked(fetchJournalCount).mockResolvedValue({ totalEvents: 0 } as never)
    vi.mocked(fetchCodeReviewsInventory).mockResolvedValue({ items: [] } as never)
    // SlurmStatusWidget + GitStatusPill render `null` when their query
    // returns `enabled: false`, so default both to that path to keep the
    // sidebar tests focused on project / item rendering.
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

  it('drags the whole project row (no grip) onto another row and saves the order', async () => {
    const { container } = setup()
    await waitFor(() => expect(projectOrder(container)).toEqual([ID_A, ID_B]))

    const rowA = projectRow(container, ID_A)
    const rowB = projectRow(container, ID_B)
    const draggables = rowA.querySelectorAll<HTMLElement>('[draggable="true"]')
    // Exactly one draggable element: the row itself, carrying the name, the
    // host chip and the toggle — not a separate grip handle.
    expect(draggables).toHaveLength(1)
    const dragRow = draggables[0]!
    expect(within(dragRow).getByText('project-a')).toBeInTheDocument()
    expect(dragRow.querySelector('[data-slot="sidebar-project-host"]')).not.toBeNull()
    expect(within(dragRow).getByText('project-a').closest('button')).not.toBeNull()
    expect(dragRow.querySelectorAll('svg')).toHaveLength(1) // only the expand chevron

    const transfer = dataTransfer()
    fireEvent.dragStart(dragRow, { dataTransfer: transfer })
    expect(transfer.getData('text/plain')).toBe(ID_A)
    expect(transfer.effectAllowed).toBe('move')
    // Dropping anywhere on the other row (here: its name) counts as a drop on it.
    const targetName = within(rowB).getByText('project-b')
    fireEvent.dragEnter(targetName, { dataTransfer: transfer })
    fireEvent.dragOver(targetName, { dataTransfer: transfer })
    expect(transfer.dropEffect).toBe('move')
    fireEvent.drop(targetName, { dataTransfer: transfer })
    fireEvent.dragEnd(dragRow, { dataTransfer: transfer })

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

  it('lists Wiki, Experiments, Reports, Code Review and Journal as links without counts', async () => {
    const { container } = setup()
    await waitFor(() => expect(projectOrder(container)).toHaveLength(2))
    const rowA = projectRow(container, ID_A)
    const sections = Array.from(rowA.querySelectorAll<HTMLElement>('[data-slot="sidebar-section"]'))
    expect(sections.map((node) => node.dataset.section)).toEqual([
      'wiki',
      'experiments',
      'reports',
      'code-review',
      'journal',
    ])
    const links = sections.map((node) => within(node).getAllByRole('link')[0]!)
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/host-a/project-a/wiki',
      '/host-a/project-a',
      '/host-a/project-a/reports',
      '/host-a/project-a/code-review',
      '/host-a/project-a/journal',
    ])
    expect(links.map((link) => link.textContent)).toEqual([
      'Wiki',
      'Experiments',
      'Reports',
      'Code Review',
      'Journal',
    ])
    // No counts: no TabBadge anywhere, and no count endpoint is read.
    expect(container.querySelector('[data-slot="count"]')).toBeNull()
    expect(container.querySelector('[data-slot="warnings"]')).toBeNull()
    expect(fetchJournalCount).not.toHaveBeenCalled()
    expect(fetchCodeReviewsInventory).not.toHaveBeenCalled()
    expect(fetchReportsInventory).not.toHaveBeenCalled()
    expect(fetchWikiInventory).not.toHaveBeenCalled()
    expect(fetchExperimentsInventory).not.toHaveBeenCalled()
    // The overview page is the Experiments section's own page.
    expect(links[1]).toHaveAttribute('aria-current', 'page')
    for (const index of [0, 2, 3, 4]) expect(links[index]).not.toHaveAttribute('aria-current')
    // Only Wiki, Experiments and Reports carry an expand chevron.
    expect(within(sections[0]!).getByRole('button', { name: 'Expand Wiki' })).toBeInTheDocument()
    expect(
      within(sections[1]!).getByRole('button', { name: 'Collapse Experiments' }),
    ).toHaveAttribute('aria-expanded', 'true')
    expect(within(sections[2]!).getByRole('button', { name: 'Expand Reports' })).toBeInTheDocument()
    expect(within(sections[3]!).queryByRole('button')).toBeNull()
    expect(within(sections[4]!).queryByRole('button')).toBeNull()
  })

  it('opens only the current project and its current section by default', async () => {
    const { container } = setup()
    await waitFor(() => expect(projectOrder(container)).toHaveLength(2))
    const rowA = projectRow(container, ID_A)
    // The current section (Experiments, for the overview) is open and read.
    await waitFor(() => expect(fetchExperimentDocs).toHaveBeenCalledWith(PROJECT_A))
    await screen.findByText('No active experiments')
    // Non-current sections start closed and read nothing.
    for (const name of ['Wiki', 'Reports']) {
      expect(within(rowA).getByRole('button', { name: `Expand ${name}` })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
    }
    expect(section(rowA, 'wiki').querySelector('[data-sidebar-item]')).toBeNull()
    expect(section(rowA, 'reports').querySelector('[data-sidebar-item]')).toBeNull()
    expect(fetchReports).not.toHaveBeenCalled()
    expect(fetchWiki).not.toHaveBeenCalled()
    // The other project starts closed and renders no sections.
    expect(projectRow(container, ID_B).querySelector('[data-slot="sidebar-section"]')).toBeNull()
    expectNoPersistedExpansion()
  })

  it('clicking another project toggles it for the session without persisting', async () => {
    const { container } = setup()
    const projectB = await screen.findByText('project-b')
    await userEvent.click(projectB)
    expect(section(projectRow(container, ID_B), 'journal').querySelector('a')).toHaveAttribute(
      'href',
      '/host-a/project-b/journal',
    )
    // Opening a project does not open any of its sections (none is current).
    for (const name of ['Wiki', 'Experiments', 'Reports']) {
      expect(
        within(projectRow(container, ID_B)).getByRole('button', { name: `Expand ${name}` }),
      ).toHaveAttribute('aria-expanded', 'false')
    }
    expectNoPersistedExpansion()
    await userEvent.click(projectB)
    await waitFor(() =>
      expect(projectRow(container, ID_B).querySelector('[data-slot="sidebar-section"]')).toBeNull(),
    )
    // The current project can be collapsed too.
    await userEvent.click(within(projectRow(container, ID_A)).getByText('project-a'))
    await waitFor(() =>
      expect(projectRow(container, ID_A).querySelector('[data-slot="sidebar-section"]')).toBeNull(),
    )
    expectNoPersistedExpansion()
  })

  it('section chevrons toggle for the session only; a remount starts from the defaults', async () => {
    vi.mocked(fetchReports).mockResolvedValue({
      reports: [{ id: 'R0001', slug: 'first-report', title: 'First report', mtime: 1 }] as never,
    })
    const first = setup()
    await waitFor(() => expect(projectOrder(first.container)).toHaveLength(2))
    const rowA = projectRow(first.container, ID_A)

    await userEvent.click(within(rowA).getByRole('button', { name: 'Expand Reports' }))
    await waitFor(() => expect(itemLinks(section(rowA, 'reports'))).toHaveLength(1))
    expect(within(rowA).getByRole('button', { name: 'Collapse Reports' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    // Collapsing the current section is also a session override.
    await userEvent.click(within(rowA).getByRole('button', { name: 'Collapse Experiments' }))
    expect(within(rowA).getByRole('button', { name: 'Expand Experiments' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expectNoPersistedExpansion()
    first.unmount()

    const second = setup()
    await waitFor(() => expect(projectOrder(second.container)).toHaveLength(2))
    const again = projectRow(second.container, ID_A)
    expect(within(again).getByRole('button', { name: 'Expand Reports' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(within(again).getByRole('button', { name: 'Collapse Experiments' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(section(again, 'reports').querySelector('[data-sidebar-item]')).toBeNull()
    expectNoPersistedExpansion()
  })

  it('lists Reports flat, newest first by updatedAt with mtime as fallback', async () => {
    vi.mocked(fetchReports).mockResolvedValue({
      reports: [
        // Declared update time wins over a newer file time.
        {
          id: 'R0001',
          slug: 'oldest',
          title: 'Oldest report',
          updatedAt: '2026-01-01T00:00:00+08:00',
          mtime: Date.parse('2026-12-01T00:00:00+08:00'),
        },
        // No declared time: falls back to mtime.
        {
          id: 'R0002',
          slug: 'untitled-report',
          title: null,
          updatedAt: null,
          mtime: Date.parse('2026-03-01T00:00:00+08:00'),
        },
        {
          id: 'R0003',
          slug: 'middle',
          title: 'Middle report',
          updatedAt: '2026-02-01T00:00:00+08:00',
          mtime: 1,
        },
      ] as never,
    })
    const { container } = setup()
    await waitFor(() => expect(projectOrder(container)).toHaveLength(2))
    const rowA = projectRow(container, ID_A)

    await userEvent.click(within(rowA).getByRole('button', { name: 'Expand Reports' }))
    const reports = section(rowA, 'reports')
    await waitFor(() => expect(itemLinks(reports)).toHaveLength(3))
    expect(itemHrefs(reports)).toEqual([
      '/host-a/project-a/r/2',
      '/host-a/project-a/r/3',
      '/host-a/project-a/r/1',
    ])
    const [untitled, middle, oldest] = itemLinks(reports)
    // Short id plus title; an untitled Report falls back to its slug.
    expect(within(untitled!).getByText('R2')).toBeInTheDocument()
    expect(untitled).toHaveTextContent('untitled-report')
    expect(untitled).toHaveAttribute('title', 'R0002 · untitled-report')
    expect(within(middle!).getByText('R3')).toBeInTheDocument()
    expect(middle).toHaveTextContent('Middle report')
    expect(oldest).toHaveTextContent('Oldest report')
    // Flat list: no group toggles inside the section.
    expect(within(reports).getAllByRole('button')).toHaveLength(1)
    expect(fetchReports).toHaveBeenCalledWith(PROJECT_A)

    await userEvent.click(within(rowA).getByRole('button', { name: 'Collapse Reports' }))
    expect(reports.querySelector('[data-sidebar-item]')).toBeNull()
  })

  it('lists Wiki pages flat, newest first by updatedAt with mtime as fallback', async () => {
    vi.mocked(fetchWiki).mockResolvedValue({
      pages: [
        { id: 'W0001', slug: 'first', title: 'First page', updatedAt: null, mtime: 1 },
        {
          id: 'W0002',
          slug: 'second',
          title: 'Second page',
          updatedAt: '2026-05-01T00:00:00+08:00',
          mtime: 2,
        },
        {
          id: 'W0010',
          slug: 'tenth',
          title: 'Tenth page',
          mtime: Date.parse('2026-06-01T00:00:00+08:00'),
        },
      ],
    } as never)
    const { container } = setup()
    await waitFor(() => expect(projectOrder(container)).toHaveLength(2))
    const rowA = projectRow(container, ID_A)

    await userEvent.click(within(rowA).getByRole('button', { name: 'Expand Wiki' }))
    const wiki = section(rowA, 'wiki')
    await waitFor(() => expect(itemLinks(wiki)).toHaveLength(3))
    expect(itemHrefs(wiki)).toEqual([
      '/host-a/project-a/w/10',
      '/host-a/project-a/w/2',
      '/host-a/project-a/w/1',
    ])
    expect(within(itemLinks(wiki)[0]!).getByText('W10')).toBeInTheDocument()
    expect(itemLinks(wiki)[0]).toHaveTextContent('Tenth page')
    expect(fetchWiki).toHaveBeenCalledWith(PROJECT_A)
  })

  it('lists only ACTIVE Experiments, flat and newest first, from fetchExperimentDocs', async () => {
    vi.mocked(fetchExperimentDocs).mockResolvedValue({
      experiments: [
        makeSummary('E0001-oldest', 'ACTIVE', 'Oldest active', {
          effectiveUpdatedAt: '2026-01-01T00:00:00+08:00',
          readmeMtime: Date.parse('2026-12-01T00:00:00+08:00'),
          displayStatus: 'COMPLETED',
        }),
        // No effective update time: falls back to the README mtime.
        makeSummary('E0002-running', 'ACTIVE', 'Newest active', {
          readmeMtime: Date.parse('2026-03-01T00:00:00+08:00'),
          displayStatus: 'RUNNING',
        }),
        makeSummary('E0003-paused', 'PAUSED', 'Paused work', {
          effectiveUpdatedAt: '2026-09-01T00:00:00+08:00',
        }),
        makeSummary('E0004-archived', 'ARCHIVED', 'Archived work', {
          effectiveUpdatedAt: '2026-09-01T00:00:00+08:00',
        }),
        makeSummary('E0005-retired', 'RETIRED', 'Retired work', {
          effectiveUpdatedAt: '2026-09-01T00:00:00+08:00',
        }),
        // Unreadable metadata is not ACTIVE even when the status says so.
        makeSummary('E0006-broken', 'ACTIVE', 'Broken work', {
          effectiveUpdatedAt: '2026-09-01T00:00:00+08:00',
          parseErrors: [{ message: 'bad front matter' }],
        }),
        makeSummary('E0007-legacy', 'OPEN' as never, 'Legacy work', {
          effectiveUpdatedAt: '2026-09-01T00:00:00+08:00',
        }),
        // Untitled: falls back to its id.
        makeSummary('E0008-untitled', 'ACTIVE', '', {
          effectiveUpdatedAt: '2026-02-01T00:00:00+08:00',
        }),
      ],
    })
    const { container } = setup()
    const experiments = section(await waitFor(() => projectRow(container, ID_A)), 'experiments')
    await waitFor(() => expect(itemLinks(experiments)).toHaveLength(3))
    expect(itemHrefs(experiments)).toEqual([
      '/host-a/project-a/e/2',
      '/host-a/project-a/e/8',
      '/host-a/project-a/e/1',
    ])
    const [newest, untitled, oldest] = itemLinks(experiments)
    expect(within(newest!).getByText('E2')).toBeInTheDocument()
    expect(newest).toHaveTextContent('Newest active')
    expect(newest).toHaveAttribute('title', 'E0002 · Newest active')
    expect(untitled).toHaveTextContent('E0008-untitled')
    expect(oldest).toHaveTextContent('Oldest active')
    for (const hidden of ['Paused work', 'Archived work', 'Retired work', 'Broken work']) {
      expect(screen.queryByText(hidden)).toBeNull()
    }
    expect(screen.queryByText('Legacy work')).toBeNull()
    // Flat: no status groups and no group toggles.
    expect(container.querySelector('[data-experiment-group]')).toBeNull()
    expect(screen.queryByRole('button', { name: /experiments \(\d+\)/i })).toBeNull()
    expect(within(experiments).getAllByRole('button')).toHaveLength(1)
    // Only the docs endpoint is read; the inventory is not.
    expect(fetchExperimentDocs).toHaveBeenCalledWith(PROJECT_A)
    expect(fetchExperimentsInventory).not.toHaveBeenCalled()
  })

  it('shows "No active experiments" when no row is ACTIVE', async () => {
    vi.mocked(fetchExperimentDocs).mockResolvedValue({
      experiments: [
        makeSummary('E0001-paused', 'PAUSED', 'Paused work'),
        makeSummary('E0002-retired', 'RETIRED', 'Retired work'),
      ],
    })
    const { container } = setup()
    expect(await screen.findByText('No active experiments')).toBeInTheDocument()
    expect(container.querySelector('[data-sidebar-item]')).toBeNull()
  })

  it('renders all 12 ACTIVE experiments (no "View more" cap)', async () => {
    vi.mocked(fetchExperimentDocs).mockResolvedValue({
      experiments: Array.from({ length: 12 }, (_, i) =>
        makeSummary(`E${String(i + 1).padStart(4, '0')}-x${i}`, 'ACTIVE', `Experiment ${i + 1}`, {
          readmeMtime: i + 1,
        }),
      ),
    })
    const { container } = setup()
    await waitFor(() => {
      const links = container.querySelectorAll('a[data-sidebar-item][href*="/host-a/project-a/e/"]')
      expect(links.length).toBe(12)
    })
    // Confirm no "View more" / "Show fewer" affordance in the DOM.
    expect(screen.queryByText(/View more/i)).toBeNull()
    expect(screen.queryByText(/Show fewer/i)).toBeNull()
  })

  it('marks and reveals the current Experiment on its page', async () => {
    currentPathname = '/host-a/project-a/e/3'
    vi.mocked(fetchExperimentDocs).mockResolvedValue({
      experiments: [
        makeSummary('E0002-other', 'ACTIVE', 'Other comparison', { readmeMtime: 5 }),
        makeSummary('E0003-current', 'ACTIVE', 'Current comparison with a readable long title', {
          readmeMtime: 2,
        }),
      ],
    })
    const { container } = setup()
    const current = await screen.findByRole('link', {
      name: /Current comparison with a readable long title/,
    })
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).toHaveAttribute('href', '/host-a/project-a/e/3')
    expect(current).toHaveAttribute(
      'title',
      'E0003 · Current comparison with a readable long title',
    )
    expect(screen.getByRole('link', { name: /Other comparison/ })).not.toHaveAttribute(
      'aria-current',
    )
    await waitFor(() => expect(revealed).toEqual([current]))
    const rowA = projectRow(container, ID_A)
    // On an Experiment page the section link itself is not the current page.
    expect(
      within(section(rowA, 'experiments')).getByRole('link', { name: /^Experiments$/ }),
    ).not.toHaveAttribute('aria-current')
    // Only the current section is open.
    expect(within(rowA).getByRole('button', { name: 'Expand Wiki' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(fetchWiki).not.toHaveBeenCalled()
    expect(fetchReports).not.toHaveBeenCalled()
  })

  it('opens the current section on an item page and reveals the current Wiki page', async () => {
    currentPathname = '/host-a/project-a/w/2'
    vi.mocked(fetchWiki).mockResolvedValue({
      pages: [
        { id: 'W0001', slug: 'first', title: 'First page', mtime: 1 },
        { id: 'W0002', slug: 'second', title: 'Second page', mtime: 2 },
      ],
    } as never)
    const { container } = setup()
    const current = await screen.findByRole('link', { name: /Second page/ })
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).toHaveAttribute('href', '/host-a/project-a/w/2')
    expect(screen.getByRole('link', { name: /First page/ })).not.toHaveAttribute('aria-current')
    await waitFor(() => expect(revealed).toEqual([current]))
    const rowA = projectRow(container, ID_A)
    expect(
      within(section(rowA, 'wiki')).getByRole('button', { name: 'Collapse Wiki' }),
    ).toHaveAttribute('aria-expanded', 'true')
    // Experiments is not the current section here, so it stays closed and unread.
    expect(within(rowA).getByRole('button', { name: 'Expand Experiments' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(fetchExperimentDocs).not.toHaveBeenCalled()
    expectNoPersistedExpansion()
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
  })

  it('non-git project: sidebar pill renders bare (no click trigger wrapper)', async () => {
    // Default beforeEach mock returns enabled: false for all projects.
    const { container } = setup()
    await waitFor(() => expect(screen.getByText('project-a')).toBeInTheDocument())
    expect(container.querySelectorAll('[data-slot="git-status-pill-compact"]').length).toBe(0)
    expect(container.querySelectorAll('[data-slot="git-status-pill-trigger"]').length).toBe(0)
  })

  it('closed projects read no item lists; opening one reads only its open sections', async () => {
    // Off-project route: nothing is current, so every project starts closed.
    currentPathname = '/manage/file-access'
    vi.mocked(fetchExperimentDocs).mockResolvedValue({
      experiments: [makeSummary('E0001-alpha', 'ACTIVE', 'Alpha')],
    })
    const { container } = setup()
    await waitFor(() => expect(projectOrder(container)).toEqual([ID_A, ID_B]))
    for (const identity of [ID_A, ID_B]) {
      expect(
        projectRow(container, identity).querySelector('[data-slot="sidebar-section"]'),
      ).toBeNull()
    }
    expect(fetchExperimentDocs).not.toHaveBeenCalled()
    expect(fetchReports).not.toHaveBeenCalled()
    expect(fetchWiki).not.toHaveBeenCalled()

    // Opening a project alone reads nothing: none of its sections is open.
    await userEvent.click(within(projectRow(container, ID_B)).getByText('project-b'))
    const rowB = projectRow(container, ID_B)
    expect(rowB.querySelector('[data-slot="sidebar-section"]')).not.toBeNull()
    expect(fetchExperimentDocs).not.toHaveBeenCalled()

    await userEvent.click(within(rowB).getByRole('button', { name: 'Expand Experiments' }))
    await userEvent.click(within(rowB).getByRole('button', { name: 'Expand Reports' }))
    await waitFor(() => expect(within(rowB).getByText('Alpha')).toBeInTheDocument())
    expect(fetchExperimentDocs).toHaveBeenCalledWith(PROJECT_B)
    expect(fetchReports).toHaveBeenCalledWith(PROJECT_B)
    expect(fetchExperimentDocs).not.toHaveBeenCalledWith(PROJECT_A)
    expect(fetchReports).not.toHaveBeenCalledWith(PROJECT_A)
    expect(fetchWiki).not.toHaveBeenCalled()
    expect(projectRow(container, ID_A).querySelector('[data-sidebar-item]')).toBeNull()

    // Closing the project hides its items again.
    await userEvent.click(within(rowB).getByText('project-b'))
    await waitFor(() => expect(rowB.querySelector('[data-sidebar-item]')).toBeNull())
    expectNoPersistedExpansion()
  })

  it('on a project page, the other closed project issues no item reads', async () => {
    currentPathname = '/host-a/project-a/r/1'
    vi.mocked(fetchReports).mockResolvedValue({
      reports: [{ id: 'R0001', slug: 'one', title: 'One', mtime: 1 }] as never,
    })
    setup()
    await screen.findByRole('link', { name: /One/ })
    expect(fetchReports).toHaveBeenCalledTimes(1)
    expect(fetchReports).toHaveBeenCalledWith(PROJECT_A)
    expect(fetchExperimentDocs).not.toHaveBeenCalled()
    expect(fetchWiki).not.toHaveBeenCalled()
  })

  it('central: duplicate Project names retain Host-qualified identities, fetches, and links', async () => {
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
    vi.mocked(fetchExperimentDocs).mockResolvedValue({
      experiments: [makeSummary('E0001-alpha', 'ACTIVE', 'Alpha')],
    })

    const { container } = setup()
    const hostA = await waitFor(() => {
      const row = projectRow(container, 'h:host-a/p:shared-project')
      expect(within(row).getByText('Alpha')).toBeInTheDocument()
      return row
    })
    const hostB = projectRow(container, 'h:host-b/p:shared-project')
    expect(hostA.querySelector('[data-slot="sidebar-project-host"]')).toHaveTextContent('host-a')
    expect(hostB.querySelector('[data-slot="sidebar-project-host"]')).toHaveTextContent('host-b')
    expect(hostB.querySelector('[data-slot="sidebar-section"]')).toBeNull()
    expect(fetchExperimentDocs).not.toHaveBeenCalledWith({
      host: 'host-b',
      project: 'shared-project',
    })

    await userEvent.click(within(hostB).getByText('shared-project'))
    // The same Experiment number on host-b is not current, so its section starts closed.
    await userEvent.click(within(hostB).getByRole('button', { name: 'Expand Experiments' }))
    await waitFor(() => {
      expect(within(hostB).getByText('Alpha')).toBeInTheDocument()
    })

    const hostALink = hostA.querySelector('a[href="/host-a/shared-project/e/1"]')
    const hostBLink = hostB.querySelector('a[href="/host-b/shared-project/e/1"]')
    expect(hostALink).toHaveAttribute('aria-current', 'page')
    expect(hostBLink).not.toHaveAttribute('aria-current')
    expect(section(hostB, 'journal').querySelector('a')).toHaveAttribute(
      'href',
      '/host-b/shared-project/journal',
    )
    expect(fetchExperimentDocs).toHaveBeenCalledWith({ host: 'host-a', project: 'shared-project' })
    expect(fetchExperimentDocs).toHaveBeenCalledWith({ host: 'host-b', project: 'shared-project' })
    expect(fetchExperimentsInventory).not.toHaveBeenCalled()
    expect(fetchGitStatus).toHaveBeenCalledWith({ host: 'host-a', project: 'shared-project' })
    expect(fetchGitStatus).toHaveBeenCalledWith({ host: 'host-b', project: 'shared-project' })
    expectNoPersistedExpansion()
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
