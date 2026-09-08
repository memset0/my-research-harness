import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileAccessSettingsPanel } from '../../components/file-access-settings-panel'
import { SessionProvider } from '../../components/session-provider'
import type { FileAccessOptionsDto, FileAccessSettings } from '../../lib/file-access-api'
import { renderWithQuery } from '../utils'

vi.mock('../../lib/file-access-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/file-access-api')>()
  return {
    ...actual,
    fetchFileAccessSettings: vi.fn(),
    saveFileAccessSettings: vi.fn(),
    requestFileAccessRestart: vi.fn(),
  }
})

import {
  fetchFileAccessSettings,
  requestFileAccessRestart,
  saveFileAccessSettings,
} from '../../lib/file-access-api'

const EFFECTIVE: FileAccessOptionsDto = {
  concurrency: 10,
  heartbeatMs: 4_000,
  leaseMs: 12_000,
  fileMinMs: 5_000,
  fileMaxMs: 30_000,
  directoryMinMs: 15_000,
  directoryMaxMs: 60_000,
  maintenanceMinMs: 300_000,
  maintenanceMaxMs: 900_000,
  failureMinMs: 15_000,
  failureMaxMs: 300_000,
  backoffFactor: 2,
  wikiTtlMs: 30_000,
  defaultTtlMs: 1_800_000,
}

function settings(overrides: Partial<FileAccessSettings> = {}): FileAccessSettings {
  return {
    effective: EFFECTIVE,
    pending: EFFECTIVE,
    revision: 'revision-aaaaaaaa',
    restartRequired: false,
    restartAvailable: true,
    cacheConfigured: true,
    metrics: null,
    ...overrides,
  }
}

function renderPanel(role: 'owner' | 'viewer' = 'owner') {
  return renderWithQuery(
    <SessionProvider value={{ role, scopeProjects: [] }}>
      <FileAccessSettingsPanel />
    </SessionProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('File access settings panel', () => {
  it('saves edited values against the loaded revision without restarting', async () => {
    vi.mocked(fetchFileAccessSettings).mockResolvedValue({ ok: true, data: settings() })
    vi.mocked(saveFileAccessSettings).mockResolvedValue({
      ok: true,
      data: settings({
        pending: { ...EFFECTIVE, concurrency: 4 },
        revision: 'revision-bbbbbbbb',
        restartRequired: true,
      }),
    })

    renderPanel()
    const concurrency = await screen.findByLabelText('Parallel operations')
    await userEvent.clear(concurrency)
    await userEvent.type(concurrency, '4')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(saveFileAccessSettings).toHaveBeenCalledWith({
        revision: 'revision-aaaaaaaa',
        settings: { ...EFFECTIVE, concurrency: 4 },
        windowMs: 300_000,
      }),
    )
    expect(requestFileAccessRestart).not.toHaveBeenCalled()
    // Effective still shows the running value; the saved one is called out.
    expect(await screen.findByText(/saved values not active/i)).toBeInTheDocument()
    expect(screen.getByText(/running 10/)).toBeInTheDocument()
  })

  it('rejects a non-positive value before it reaches the service', async () => {
    vi.mocked(fetchFileAccessSettings).mockResolvedValue({ ok: true, data: settings() })

    renderPanel()
    const heartbeat = await screen.findByLabelText(/Heartbeat/)
    await userEvent.clear(heartbeat)
    await userEvent.type(heartbeat, '0')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText(/Heartbeat must be a positive number/)).toBeInTheDocument()
    expect(saveFileAccessSettings).not.toHaveBeenCalled()
  })

  it('offers the on-disk values when another editor won the race', async () => {
    vi.mocked(fetchFileAccessSettings).mockResolvedValue({ ok: true, data: settings() })
    vi.mocked(saveFileAccessSettings).mockResolvedValue({
      ok: false,
      status: 409,
      code: 'REVISION_CONFLICT',
      message: 'The local config changed since this panel loaded.',
      revision: 'revision-cccccccc',
      pending: { ...EFFECTIVE, concurrency: 7 },
    })

    renderPanel()
    const concurrency = await screen.findByLabelText('Parallel operations')
    await userEvent.clear(concurrency)
    await userEvent.type(concurrency, '4')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    const load = await screen.findByRole('button', { name: 'Load saved values' })
    await userEvent.click(load)
    await waitFor(() => expect(screen.getByLabelText('Parallel operations')).toHaveValue('7'))
  })

  it('says restart must happen on the machine when no adapter exists', async () => {
    vi.mocked(fetchFileAccessSettings).mockResolvedValue({
      ok: true,
      data: settings({ restartRequired: true, restartAvailable: false }),
    })

    renderPanel()
    expect(await screen.findByText(/restart must be done on the machine/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restart service' })).toBeDisabled()
  })

  it('keeps settings and metrics away from viewers', async () => {
    renderPanel('viewer')
    expect(await screen.findByText(/owner account only/i)).toBeInTheDocument()
    expect(fetchFileAccessSettings).not.toHaveBeenCalled()
  })
})
