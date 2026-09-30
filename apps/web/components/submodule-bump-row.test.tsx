import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../test/utils'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  fetchGitRange: vi.fn(),
  fetchGitDiff: vi.fn(),
}))

import {
  fetchGitDiff,
  fetchGitRange,
  type GitDiffResponse,
  type GitRangeResponse,
} from '../lib/api'
import { SubmoduleBumpRow } from './submodule-bump-row'

const FROM = 'a'.repeat(40)
const TO = 'b'.repeat(40)

const RANGE: GitRangeResponse = {
  enabled: true,
  from: FROM,
  to: TO,
  submodule: 'vendor/foo',
  commits: [
    {
      sha: 'c'.repeat(40),
      shortSha: 'ccccccc',
      subject: 'first inside-submodule change',
      authorName: 'Alice',
      authorEmail: 'a@x',
      authorDate: '2026-05-14T10:00:00+08:00',
      parents: [FROM],
    },
    {
      sha: 'd'.repeat(40),
      shortSha: 'ddddddd',
      subject: 'second inside-submodule change',
      authorName: 'Bob',
      authorEmail: 'b@x',
      authorDate: '2026-05-15T10:00:00+08:00',
      parents: ['c'.repeat(40)],
    },
  ],
  files: [{ path: 'src/lib.ts', status: 'modified' }],
}

const DIFF: GitDiffResponse = {
  ok: true,
  filename: 'src/lib.ts',
  status: 'modified',
  oldContent: 'pre\n',
  newContent: 'post\n',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchGitRange).mockResolvedValue(RANGE)
  vi.mocked(fetchGitDiff).mockResolvedValue(DIFF)
})

describe('SubmoduleBumpRow', () => {
  it('header contains both short SHAs and the submodule path', () => {
    renderWithQuery(
      <SubmoduleBumpRow
        project="project-a"
        submodule="vendor/foo"
        path="vendor/foo"
        fromSha={FROM}
        toSha={TO}
      />,
    )
    expect(screen.getByText('vendor/foo')).toBeInTheDocument()
    expect(screen.getByText(/aaaaaaa → bbbbbbb/)).toBeInTheDocument()
  })

  it('default collapsed → no fetch fires', () => {
    renderWithQuery(
      <SubmoduleBumpRow
        project="project-a"
        submodule="vendor/foo"
        path="vendor/foo"
        fromSha={FROM}
        toSha={TO}
      />,
    )
    expect(fetchGitRange).not.toHaveBeenCalled()
  })

  it('expanding fires fetchGitRange exactly once', async () => {
    renderWithQuery(
      <SubmoduleBumpRow
        project="project-a"
        submodule="vendor/foo"
        path="vendor/foo"
        fromSha={FROM}
        toSha={TO}
      />,
    )
    await userEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(fetchGitRange).toHaveBeenCalledTimes(1))
    expect(fetchGitRange).toHaveBeenCalledWith('project-a', FROM, TO, 'vendor/foo')
  })

  it('expanded body renders commit summaries + files', async () => {
    renderWithQuery(
      <SubmoduleBumpRow
        project="project-a"
        submodule="vendor/foo"
        path="vendor/foo"
        fromSha={FROM}
        toSha={TO}
      />,
    )
    await userEvent.click(screen.getByRole('button'))
    await waitFor(() =>
      expect(screen.getByText(/first inside-submodule change/)).toBeInTheDocument(),
    )
    expect(screen.getByText(/second inside-submodule change/)).toBeInTheDocument()
    expect(screen.getByText('src/lib.ts')).toBeInTheDocument()
  })

  it('expanding an inner file row fires fetchGitDiff with side=range + from + to + submodule', async () => {
    renderWithQuery(
      <SubmoduleBumpRow
        project="project-a"
        submodule="vendor/foo"
        path="vendor/foo"
        fromSha={FROM}
        toSha={TO}
      />,
    )
    await userEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByText('src/lib.ts')).toBeInTheDocument())
    await userEvent.click(screen.getByText('src/lib.ts'))
    await waitFor(() => expect(fetchGitDiff).toHaveBeenCalledTimes(1))
    expect(fetchGitDiff).toHaveBeenCalledWith('project-a', 'src/lib.ts', 'range', {
      sha: undefined,
      submodule: 'vendor/foo',
      from: FROM,
      to: TO,
    })
  })

  it('renders the disabled state when the range query reports enabled=false', async () => {
    vi.mocked(fetchGitRange).mockResolvedValue({
      enabled: false,
      reason: 'error',
      message: 'boom',
    })
    renderWithQuery(
      <SubmoduleBumpRow
        project="project-a"
        submodule="vendor/foo"
        path="vendor/foo"
        fromSha={FROM}
        toSha={TO}
      />,
    )
    await userEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByText(/git: error/)).toBeInTheDocument())
  })
})
