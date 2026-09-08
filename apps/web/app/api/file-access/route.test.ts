// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const METRICS_SNAPSHOT = { epoch: 'epoch-1', windowMs: 300_000, overall: { samples: 3 } }

vi.mock('@/lib/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('@memon/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@memon/core')>()),
  getFileOperationMetrics: vi.fn(() => METRICS_SNAPSHOT),
}))

import { getRuntime, type Runtime } from '@/lib/runtime'
import { resetRestartScheduleForTests } from '@/lib/server/file-access-settings'
import { POST } from './restart/route'
import { GET, PUT } from './route'

const CONFIG_TEXT = `# operator notes stay put
projects: []

fileAccess:
  # deliberately low
  concurrency: 4
`

const VALID_SETTINGS = {
  concurrency: 6,
  heartbeatMs: 30000,
  leaseMs: 90000,
  fileMinMs: 5000,
  fileMaxMs: 30000,
  directoryMinMs: 15000,
  directoryMaxMs: 60000,
  maintenanceMinMs: 300000,
  maintenanceMaxMs: 900000,
  failureMinMs: 15000,
  failureMaxMs: 300000,
  backoffFactor: 2,
  wikiTtlMs: 30000,
  defaultTtlMs: 1800000,
}

let directory: string
let configPath: string

function mockRuntime(config: Record<string, unknown>): void {
  vi.mocked(getRuntime).mockResolvedValue({ config, configPath } as unknown as Runtime)
}

function request(
  method: 'GET' | 'PUT' | 'POST',
  options: { role?: 'owner' | 'viewer' | 'anon'; body?: unknown; query?: string } = {},
): NextRequest {
  const role = options.role ?? 'owner'
  const url = `http://localhost/api/file-access${options.query ?? ''}`
  return new NextRequest(url, {
    method,
    headers: {
      'x-memon-role': role,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.useRealTimers()
  resetRestartScheduleForTests()
  directory = await mkdtemp(join(tmpdir(), 'memon-file-access-route-'))
  configPath = join(directory, 'config.yml')
  await writeFile(configPath, CONFIG_TEXT, { mode: 0o600 })
  mockRuntime({ projects: [], fileAccess: { concurrency: 4 } })
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(directory, { recursive: true, force: true })
})

describe('GET /api/file-access', () => {
  it('rejects a viewer', async () => {
    const response = await GET(request('GET', { role: 'viewer' }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })

  it('returns effective, pending, revision and metrics verbatim for the owner', async () => {
    const response = await GET(request('GET'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.effective.concurrency).toBe(4)
    expect(body.pending.concurrency).toBe(4)
    expect(typeof body.revision).toBe('string')
    expect(body.restartRequired).toBe(false)
    expect(body.restartAvailable).toBe(false)
    expect(body.metrics).toEqual(METRICS_SNAPSHOT)
  })

  it('reports an unsupported metrics window', async () => {
    const response = await GET(request('GET', { query: '?windowMs=5' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_WINDOW' } })
  })
})

describe('PUT /api/file-access', () => {
  it('rejects a viewer without touching the config', async () => {
    const response = await PUT(
      request('PUT', {
        role: 'viewer',
        body: { revision: 'anything', settings: VALID_SETTINGS },
      }),
    )
    expect(response.status).toBe(403)
    expect(await readFile(configPath, 'utf8')).toBe(CONFIG_TEXT)
  })

  it('saves pending values without changing effective values', async () => {
    const loaded = await (await GET(request('GET'))).json()

    const response = await PUT(
      request('PUT', { body: { revision: loaded.revision, settings: VALID_SETTINGS } }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.pending).toEqual(VALID_SETTINGS)
    expect(body.effective.concurrency).toBe(4)
    expect(body.restartRequired).toBe(true)
    expect(body.restartAvailable).toBe(false)
    expect(body.revision).not.toBe(loaded.revision)

    const text = await readFile(configPath, 'utf8')
    expect(text).toContain('# operator notes stay put')
    expect(text).toContain('# deliberately low')
    expect(text).toContain('concurrency: 6')
  })

  it('returns a conflict with the current values when the config moved on', async () => {
    const loaded = await (await GET(request('GET'))).json()
    await writeFile(configPath, `${CONFIG_TEXT}extra: 1\n`, { mode: 0o600 })

    const response = await PUT(
      request('PUT', { body: { revision: loaded.revision, settings: VALID_SETTINGS } }),
    )
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error.code).toBe('REVISION_CONFLICT')
    expect(body.pending.concurrency).toBe(4)
    expect(body.revision).not.toBe(loaded.revision)
    expect(await readFile(configPath, 'utf8')).toContain('extra: 1')
  })

  it('lists every failed relationship for invalid settings', async () => {
    const loaded = await (await GET(request('GET'))).json()
    const response = await PUT(
      request('PUT', {
        body: {
          revision: loaded.revision,
          settings: { ...VALID_SETTINGS, leaseMs: 9000, fileMaxMs: 1000 },
        },
      }),
    )
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe('INVALID_SETTINGS')
    expect(body.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('fileMinMs'),
        expect.stringContaining('leaseMs'),
      ]),
    )
    expect(await readFile(configPath, 'utf8')).toBe(CONFIG_TEXT)
  })

  it('rejects a malformed body', async () => {
    const response = await PUT(request('PUT', { body: { settings: VALID_SETTINGS } }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_BODY' } })
  })
})

describe('POST /api/file-access/restart', () => {
  it('rejects a viewer', async () => {
    const response = await POST(request('POST', { role: 'viewer' }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })

  it('reports restart_required when no local adapter is configured', async () => {
    const response = await POST(request('POST'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: false,
      code: 'RESTART_REQUIRED',
      restartAvailable: false,
    })
  })

  it('schedules the configured adapter without echoing its argv', async () => {
    vi.useFakeTimers()
    mockRuntime({
      projects: [],
      fileAccess: { concurrency: 4 },
      fileAccessRestart: ['/bin/true', '--memon-candidate'],
    })

    const response = await POST(request('POST'))
    expect(response.status).toBe(200)
    const raw = await response.text()
    expect(JSON.parse(raw)).toMatchObject({
      ok: true,
      code: 'RESTART_SCHEDULED',
      restartAvailable: true,
    })
    // The machine-local command never travels to the browser.
    expect(raw).not.toContain('/bin/true')
    expect(raw).not.toContain('--memon-candidate')

    // Ignoring a browser-supplied command is the whole point: the second call
    // reports the already-scheduled restart rather than starting another.
    const again = await POST(request('POST', { body: { argv: ['/bin/false', '--not-allowed'] } }))
    expect(await again.json()).toMatchObject({ ok: true, code: 'RESTART_ALREADY_SCHEDULED' })
  })
})
