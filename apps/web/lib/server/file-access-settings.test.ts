import { promises as fs } from 'node:fs'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseDocument } from 'yaml'

// The Store's compiled-in defaults are the only thing this module needs from
// core; stubbing them keeps the settings tests hermetic.
vi.mock('@memon/core', () => ({
  DEFAULT_FILE_ACCESS_OPTIONS: {
    concurrency: 10,
    heartbeatMs: 4000,
    leaseMs: 12000,
    fileMinMs: 5000,
    fileMaxMs: 30000,
    directoryMinMs: 15000,
    directoryMaxMs: 60000,
    maintenanceMinMs: 300000,
    maintenanceMaxMs: 900000,
    failureMinMs: 15000,
    failureMaxMs: 300000,
    backoffFactor: 2,
  },
}))

import {
  FileAccessSettingsError,
  fileAccessOptionsEqual,
  parseMetricsWindow,
  readPendingFileAccessSettings,
  resetRestartScheduleForTests,
  resolveFileAccessOptions,
  resolveRestartAdapter,
  saveFileAccessSettings,
  scheduleFileAccessRestart,
  validateFileAccessSettings,
} from './file-access-settings'

const VALID_SETTINGS = {
  concurrency: 6,
  heartbeatMs: 4000,
  leaseMs: 12000,
  fileMinMs: 5000,
  fileMaxMs: 30000,
  directoryMinMs: 15000,
  directoryMaxMs: 60000,
  maintenanceMinMs: 300000,
  maintenanceMaxMs: 900000,
  failureMinMs: 15000,
  failureMaxMs: 300000,
  backoffFactor: 2,
  wikiTtlMs: 30_000,
  defaultTtlMs: 1_800_000,
}

const CONFIG_WITH_COMMENTS = `# instance config — hand written, comments matter
projects:
  # the first project
  - name: project-a
    root: ./mock/project-a

auth:
  username: "admin"
  password: "s3cret-not-a-real-value"

fileAccess:
  # keep concurrency modest on shared storage
  concurrency: 4
  heartbeatMs: 4000

poll:
  min_ms: 1000 # trailing comment
`

let dir: string
let configPath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'memon-file-access-'))
  configPath = join(dir, 'config.yml')
  resetRestartScheduleForTests()
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

async function writeConfig(text: string, mode = 0o600): Promise<void> {
  await fs.writeFile(configPath, text, { mode })
  await fs.chmod(configPath, mode)
}

describe('saveFileAccessSettings', () => {
  it('writes the new values while preserving unrelated keys, comments and file mode', async () => {
    await writeConfig(CONFIG_WITH_COMMENTS)
    const before = await readPendingFileAccessSettings(configPath)
    expect(before.pending.concurrency).toBe(4)

    const saved = await saveFileAccessSettings({
      configPath,
      revision: before.revision,
      settings: VALID_SETTINGS,
    })

    const text = await fs.readFile(configPath, 'utf8')
    expect(text).toContain('# instance config — hand written, comments matter')
    expect(text).toContain('# the first project')
    expect(text).toContain('# keep concurrency modest on shared storage')
    expect(text).toContain('# trailing comment')
    expect(text).toContain('password: "s3cret-not-a-real-value"')
    expect(text).toContain('min_ms: 1000')
    expect(text).toContain('concurrency: 6')
    expect(text).toContain('maintenanceMaxMs: 900000')

    expect(saved.pending).toEqual(VALID_SETTINGS)
    expect(saved.revision).not.toBe(before.revision)
    expect((await stat(configPath)).mode & 0o777).toBe(0o600)
  })

  it('saves cache periods beside the existing dump settings without hot-applying or mixing scheduler keys', async () => {
    await writeConfig(`${CONFIG_WITH_COMMENTS}\nfile_cache:\n  dump_path: ./.memon-cache/files.dump\n  dump_interval_seconds: 15\n  wiki_ttl_seconds: 30\n  default_ttl_seconds: 1800\n`)
    const before = await readPendingFileAccessSettings(configPath)
    const startup = {
      fileCache: {
        dumpPath: join(dir, '.memon-cache', 'files.dump'),
        dumpIntervalMs: 15_000,
        wikiTtlMs: 30_000,
        defaultTtlMs: 1_800_000,
      },
    }
    const saved = await saveFileAccessSettings({
      configPath,
      revision: before.revision,
      settings: { ...VALID_SETTINGS, wikiTtlMs: 60_000, defaultTtlMs: 3_600_000 },
    })
    const document = parseDocument(await fs.readFile(configPath, 'utf8')).toJS()
    expect(document.file_cache).toEqual({
      dump_path: './.memon-cache/files.dump',
      dump_interval_seconds: 15,
      wiki_ttl_seconds: 60,
      default_ttl_seconds: 3600,
    })
    expect(document.fileAccess).not.toHaveProperty('wikiTtlMs')
    expect(fileAccessOptionsEqual(resolveFileAccessOptions(startup), saved.pending)).toBe(false)
    expect((await readPendingFileAccessSettings(configPath)).pending.defaultTtlMs).toBe(3_600_000)
  })

  it('refuses cache-period edits without an operator-configured dump path', async () => {
    await writeConfig(CONFIG_WITH_COMMENTS)
    const before = await readPendingFileAccessSettings(configPath)
    await expect(saveFileAccessSettings({
      configPath,
      revision: before.revision,
      settings: { ...VALID_SETTINGS, wikiTtlMs: 60_000 },
    })).rejects.toMatchObject({ code: 'CONFIG_SHAPE' })
    expect(await fs.readFile(configPath, 'utf8')).toBe(CONFIG_WITH_COMMENTS)
  })

  it('creates the block when the config has no fileAccess key yet', async () => {
    await writeConfig('# top comment\nprojects: []\n')
    const before = await readPendingFileAccessSettings(configPath)

    await saveFileAccessSettings({
      configPath,
      revision: before.revision,
      settings: VALID_SETTINGS,
    })

    const text = await fs.readFile(configPath, 'utf8')
    expect(text).toContain('# top comment')
    expect(text).toContain('projects: []')
    expect(text).toMatch(/fileAccess:\n {2}concurrency: 6/)
    expect((await readPendingFileAccessSettings(configPath)).pending).toEqual(VALID_SETTINGS)
  })

  it('leaves the running (effective) values untouched — only the file changes', async () => {
    await writeConfig(CONFIG_WITH_COMMENTS)
    // The startup config object the running process holds.
    const startupConfig = { fileAccess: { concurrency: 4, heartbeatMs: 4000 } }
    const effectiveBefore = resolveFileAccessOptions(startupConfig)

    const before = await readPendingFileAccessSettings(configPath)
    const saved = await saveFileAccessSettings({
      configPath,
      revision: before.revision,
      settings: VALID_SETTINGS,
    })

    expect(resolveFileAccessOptions(startupConfig)).toEqual(effectiveBefore)
    expect(fileAccessOptionsEqual(effectiveBefore, saved.pending)).toBe(false)
  })

  it('reports a conflict without overwriting a concurrent edit', async () => {
    await writeConfig(CONFIG_WITH_COMMENTS)
    const before = await readPendingFileAccessSettings(configPath)

    const concurrent = `${CONFIG_WITH_COMMENTS}\n# another editor appended this\nextra: 1\n`
    await writeConfig(concurrent)

    const error = await saveFileAccessSettings({
      configPath,
      revision: before.revision,
      settings: VALID_SETTINGS,
    }).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(FileAccessSettingsError)
    expect((error as FileAccessSettingsError).code).toBe('REVISION_CONFLICT')
    expect((error as FileAccessSettingsError).current?.pending.concurrency).toBe(4)
    expect(await fs.readFile(configPath, 'utf8')).toBe(concurrent)
  })

  it('refuses a config whose fileAccess key is not a mapping', async () => {
    await writeConfig('fileAccess: 5\n')
    const before = await readPendingFileAccessSettings(configPath)
    await expect(
      saveFileAccessSettings({ configPath, revision: before.revision, settings: VALID_SETTINGS }),
    ).rejects.toMatchObject({ code: 'CONFIG_SHAPE' })
  })

  it('refuses to write the source-controlled template', async () => {
    await expect(
      saveFileAccessSettings({
        configPath: join(dir, 'config.example.yml'),
        revision: 'whatever',
        settings: VALID_SETTINGS,
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_NOT_WRITABLE' })
  })

  it('reports an unreadable config instead of inventing defaults', async () => {
    await expect(readPendingFileAccessSettings(join(dir, 'missing.yml'))).rejects.toMatchObject({
      code: 'CONFIG_UNAVAILABLE',
    })
  })
})

describe('validateFileAccessSettings', () => {
  it('accepts a valid set', () => {
    expect(validateFileAccessSettings(VALID_SETTINGS)).toEqual({
      ok: true,
      settings: VALID_SETTINGS,
    })
  })

  it('rejects non-finite, non-positive and non-integer values', () => {
    const result = validateFileAccessSettings({
      ...VALID_SETTINGS,
      concurrency: 0,
      fileMinMs: Number.POSITIVE_INFINITY,
      directoryMinMs: 1500.5,
    })
    expect(result.ok).toBe(false)
    const issues = result.ok ? [] : result.issues
    expect(issues.some((issue) => issue.startsWith('concurrency:'))).toBe(true)
    expect(issues.some((issue) => issue.startsWith('fileMinMs:'))).toBe(true)
    expect(issues.some((issue) => issue.startsWith('directoryMinMs:'))).toBe(true)
  })

  it('accepts a 30s heartbeat beside a 5s active-file period', () => {
    const settings = { ...VALID_SETTINGS, heartbeatMs: 30_000, leaseMs: 90_000 }
    expect(validateFileAccessSettings(settings)).toEqual({ ok: true, settings })
  })

  it('still requires a lease that survives a missed heartbeat', () => {
    const result = validateFileAccessSettings({
      ...VALID_SETTINGS,
      heartbeatMs: 30_000,
      leaseMs: 60_000,
    })
    expect(result.ok).toBe(false)
    const issues = result.ok ? [] : result.issues
    expect(issues.join('\n')).toContain('leaseMs must be at least 3x heartbeatMs')
  })

  it('rejects unknown and missing keys', () => {
    const extra = validateFileAccessSettings({ ...VALID_SETTINGS, nope: 1 })
    expect(extra.ok).toBe(false)
    const { concurrency: _omitted, ...withoutConcurrency } = VALID_SETTINGS
    expect(validateFileAccessSettings(withoutConcurrency).ok).toBe(false)
  })
})

describe('restart adapter', () => {
  it('is missing when the config does not configure one', () => {
    expect(resolveRestartAdapter({}).status).toBe('missing')
    expect(resolveRestartAdapter({ fileAccessRestart: null }).status).toBe('missing')
  })

  it('is invalid for empty or non-string argv', () => {
    expect(resolveRestartAdapter({ fileAccessRestart: [] })).toMatchObject({ status: 'invalid' })
    expect(resolveRestartAdapter({ fileAccessRestart: 'restart me' })).toMatchObject({
      status: 'invalid',
    })
    expect(resolveRestartAdapter({ fileAccessRestart: ['ok', ''] })).toMatchObject({
      status: 'invalid',
    })
  })

  it('reports restart_required and spawns nothing without an adapter', () => {
    const spawnImpl = vi.fn()
    const outcome = scheduleFileAccessRestart(resolveRestartAdapter({}), {
      configPath,
      spawnImpl,
    })
    expect(outcome).toMatchObject({ ok: false, code: 'RESTART_REQUIRED' })
    expect(spawnImpl).not.toHaveBeenCalled()
  })

  it('schedules the configured argv once, after the response delay', () => {
    vi.useFakeTimers()
    const spawnImpl = vi.fn()
    const adapter = resolveRestartAdapter({ fileAccessRestart: ['/bin/true', '--restart'] })

    const first = scheduleFileAccessRestart(adapter, { configPath, delayMs: 250, spawnImpl })
    expect(first).toMatchObject({ ok: true, code: 'RESTART_SCHEDULED', delayMs: 250 })
    expect(spawnImpl).not.toHaveBeenCalled()

    const second = scheduleFileAccessRestart(adapter, { configPath, delayMs: 250, spawnImpl })
    expect(second).toMatchObject({ ok: true, code: 'RESTART_ALREADY_SCHEDULED' })

    vi.advanceTimersByTime(250)
    expect(spawnImpl).toHaveBeenCalledTimes(1)
    expect(spawnImpl).toHaveBeenCalledWith(['/bin/true', '--restart'], dir)
  })
})

describe('parseMetricsWindow', () => {
  it('defaults to five minutes and rejects out-of-range windows', () => {
    expect(parseMetricsWindow(null)).toEqual({ ok: true, windowMs: 300_000 })
    expect(parseMetricsWindow('60000')).toEqual({ ok: true, windowMs: 60_000 })
    expect(parseMetricsWindow('999')).toMatchObject({ ok: false })
    expect(parseMetricsWindow('900001')).toMatchObject({ ok: false })
    expect(parseMetricsWindow('abc')).toMatchObject({ ok: false })
  })
})
