import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithQuery } from '../test/utils'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../lib/api', () => ({
  ApiError: class extends Error {},
  checkTerminal: vi.fn(),
  installTerminal: vi.fn(),
  startTerminal: vi.fn(),
  stopTerminal: vi.fn(),
}))

import { checkTerminal, installTerminal } from '../lib/api'
import { TerminalButton } from './terminal-button'

describe('TerminalButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('available: renders enabled "Open in browser" button', async () => {
    vi.mocked(checkTerminal).mockResolvedValue({
      available: true,
      version: '1.7.7',
      source: 'cached',
    })
    renderWithQuery(<TerminalButton experimentId="foo" projectName="a" />)
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /open in browser/i })
      expect(btn).not.toBeDisabled()
    })
  })

  it('downloadable: renders "Install ttyd" button + invokes installTerminal on click', async () => {
    vi.mocked(checkTerminal).mockResolvedValue({
      available: false,
      downloadable: true,
      suggestion: 'POST /api/terminal/install',
    })
    vi.mocked(installTerminal).mockResolvedValue({
      ok: true,
      version: '1.7.7',
      path: '/c/ttyd',
      durationMs: 800,
    })

    renderWithQuery(<TerminalButton experimentId="foo" projectName="a" />)
    const btn = await screen.findByRole('button', { name: /install ttyd/i })
    await userEvent.click(btn)
    await waitFor(() => expect(installTerminal).toHaveBeenCalled())
  })

  it('non-downloadable: button disabled with manual suggestion in tooltip', async () => {
    vi.mocked(checkTerminal).mockResolvedValue({
      available: false,
      downloadable: false,
      suggestion: 'brew install ttyd',
    })
    renderWithQuery(<TerminalButton experimentId="foo" projectName="a" />)
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /open in browser/i })
      expect(btn).toBeDisabled()
    })
  })
})
