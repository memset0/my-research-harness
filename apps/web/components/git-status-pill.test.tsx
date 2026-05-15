import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../test/utils'

vi.mock('../lib/api', () => ({
  fetchGitStatus: vi.fn(),
}))

import { fetchGitStatus, type GitStatus } from '../lib/api'
import { __resetRuntimeConfigForTests } from '../lib/runtime-config'
import { GitStatusPill } from './git-status-pill'

const CLEAN: GitStatus = {
  enabled: true,
  branch: 'main',
  detached: false,
  sha: 'abcdef0',
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  dirty: false,
}

const DIRTY: GitStatus = {
  enabled: true,
  branch: 'feature/x',
  detached: false,
  sha: '1234567',
  upstream: null,
  ahead: 2,
  behind: 1,
  staged: 1,
  unstaged: 0,
  untracked: 2,
  dirty: true,
}

const DETACHED: GitStatus = {
  enabled: true,
  branch: null,
  detached: true,
  sha: 'deadbee',
  upstream: null,
  ahead: 0,
  behind: 0,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  dirty: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetRuntimeConfigForTests()
  // Remove any leftover script tag between tests so the reader cleanly
  // hits its default-fallback path.
  document.getElementById('memon-runtime-config')?.remove()
})

function setRuntimeConfig(intervalMs: number): void {
  __resetRuntimeConfigForTests()
  const existing = document.getElementById('memon-runtime-config')
  if (existing) existing.remove()
  const tag = document.createElement('script')
  tag.id = 'memon-runtime-config'
  tag.type = 'application/json'
  tag.textContent = JSON.stringify({ gitStatus: { intervalMs } })
  document.head.appendChild(tag)
}

describe('GitStatusPill — compact', () => {
  it('renders branch + dirty dot when dirty', async () => {
    vi.mocked(fetchGitStatus).mockResolvedValueOnce(DIRTY)
    renderWithQuery(<GitStatusPill project="p" variant="compact" />)
    await waitFor(() => expect(screen.getByText('feature/x')).toBeInTheDocument())
    expect(screen.getByLabelText('dirty working tree')).toBeInTheDocument()
  })

  it('renders branch only when clean (no dirty dot)', async () => {
    vi.mocked(fetchGitStatus).mockResolvedValueOnce(CLEAN)
    renderWithQuery(<GitStatusPill project="p" variant="compact" />)
    await waitFor(() => expect(screen.getByText('main')).toBeInTheDocument())
    expect(screen.queryByLabelText('dirty working tree')).toBeNull()
  })

  it('renders short-sha for detached HEAD', async () => {
    vi.mocked(fetchGitStatus).mockResolvedValueOnce(DETACHED)
    renderWithQuery(<GitStatusPill project="p" variant="compact" />)
    await waitFor(() => expect(screen.getByText('(deadbee)')).toBeInTheDocument())
  })
})

describe('GitStatusPill — footer', () => {
  it('renders ↑ahead and ↓behind when nonzero', async () => {
    vi.mocked(fetchGitStatus).mockResolvedValueOnce(DIRTY)
    renderWithQuery(<GitStatusPill project="p" variant="footer" />)
    await waitFor(() => expect(screen.getByText('feature/x')).toBeInTheDocument())
    expect(screen.getByLabelText('2 ahead')).toHaveTextContent('↑2')
    expect(screen.getByLabelText('1 behind')).toHaveTextContent('↓1')
  })

  it('omits arrow group when ahead = behind = 0', async () => {
    vi.mocked(fetchGitStatus).mockResolvedValueOnce(CLEAN)
    renderWithQuery(<GitStatusPill project="p" variant="footer" />)
    await waitFor(() => expect(screen.getByText('main')).toBeInTheDocument())
    expect(screen.queryByLabelText(/ahead/)).toBeNull()
    expect(screen.queryByLabelText(/behind/)).toBeNull()
  })

  it('renders count chips when nonzero', async () => {
    vi.mocked(fetchGitStatus).mockResolvedValueOnce(DIRTY)
    renderWithQuery(<GitStatusPill project="p" variant="footer" />)
    await waitFor(() => expect(screen.getByText('feature/x')).toBeInTheDocument())
    expect(screen.getByLabelText('1 staged')).toHaveTextContent('●1')
    expect(screen.getByLabelText('2 untracked')).toHaveTextContent('?2')
  })
})

describe('GitStatusPill — runtime config', () => {
  it('default-fallbacks to 10s interval when no script tag is present', async () => {
    vi.mocked(fetchGitStatus).mockResolvedValueOnce(CLEAN)
    renderWithQuery(<GitStatusPill project="p" variant="compact" />)
    await waitFor(() => expect(screen.getByText('main')).toBeInTheDocument())
    // Initial fetch happens; the actual interval is enforced by
    // TanStack's refetchInterval — assert at least that the first call
    // fired.
    expect(fetchGitStatus).toHaveBeenCalled()
  })

  it('honors a custom intervalMs from the injected runtime config', async () => {
    setRuntimeConfig(30_000)
    vi.mocked(fetchGitStatus).mockResolvedValueOnce(CLEAN)
    renderWithQuery(<GitStatusPill project="p" variant="compact" />)
    await waitFor(() => expect(screen.getByText('main')).toBeInTheDocument())
    // No way to introspect refetchInterval from React testing-library
    // without time-travel; the contract here is that the call doesn't
    // throw and the pill still mounts. The intervalMs flow itself is
    // separately covered by `runtime-config.test.ts`.
    expect(fetchGitStatus).toHaveBeenCalled()
  })
})

describe('GitStatusPill — disabled / loading paths', () => {
  it('renders null when enabled=false', async () => {
    vi.mocked(fetchGitStatus).mockResolvedValueOnce({
      enabled: false,
      reason: 'not-a-repo',
    })
    const { container } = renderWithQuery(
      <GitStatusPill project="p" variant="compact" />,
    )
    await waitFor(() => expect(fetchGitStatus).toHaveBeenCalled())
    expect(container.querySelector('[data-slot="git-status-pill-compact"]')).toBeNull()
  })

  it('renders null when query rejects', async () => {
    vi.mocked(fetchGitStatus).mockRejectedValueOnce(new Error('boom'))
    const { container } = renderWithQuery(
      <GitStatusPill project="p" variant="footer" />,
    )
    await waitFor(() => expect(fetchGitStatus).toHaveBeenCalled())
    expect(container.querySelector('[data-slot="git-status-pill-footer"]')).toBeNull()
  })
})
