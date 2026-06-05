// Unit tests for `memon notify` — fetch is mocked; no real network calls.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FOOTER_EMOJI } from '@memon/core'
import { runNotifySend, runNotifyTest } from './notify.js'

// ---------- shared harness ----------

class ExitCalled extends Error {
  constructor(public exitCode: number) {
    super(`process.exit(${exitCode})`)
  }
}

interface ExitSpy {
  restore: () => void
  readonly code: number | null
}

function spyExit(): ExitSpy {
  const real = process.exit
  let exitCode: number | null = null
  process.exit = ((code?: number) => {
    exitCode = code ?? 0
    throw new ExitCalled(exitCode)
  }) as typeof process.exit
  return {
    restore: () => {
      process.exit = real
    },
    get code() {
      return exitCode
    },
  }
}

interface CapturedStreams {
  stdout: string[]
  stderr: string[]
}

function spyStdio(): { restore: () => void; captured: CapturedStreams } {
  const captured: CapturedStreams = { stdout: [], stderr: [] }
  const realOut = process.stdout.write.bind(process.stdout)
  const realErr = process.stderr.write.bind(process.stderr)
  process.stdout.write = ((c: unknown) => {
    captured.stdout.push(String(c))
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((c: unknown) => {
    captured.stderr.push(String(c))
    return true
  }) as typeof process.stderr.write
  return {
    restore: () => {
      process.stdout.write = realOut
      process.stderr.write = realErr
    },
    captured,
  }
}

const BOT_TOKEN = 'TEST-TOKEN-deadbeef'
const CHAT_ID = '-100123456'

const VALID_CONFIG = `
projects:
  - { name: x, root: ./x }
telegram:
  bot_token: "${BOT_TOKEN}"
  chat_id: "${CHAT_ID}"
`

let dir: string
let exitSpy: ExitSpy
let stdio: ReturnType<typeof spyStdio>
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'memon-notify-'))
  await fs.writeFile(join(dir, 'config.yml'), VALID_CONFIG)
  exitSpy = spyExit()
  stdio = spyStdio()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  // Force unknown agent + no session by default so footer is deterministic.
  delete process.env.CLAUDECODE
  delete process.env.MEMON_TELEGRAM_BOT_TOKEN
  delete process.env.MEMON_TELEGRAM_CHAT_ID
})

afterEach(async () => {
  exitSpy.restore()
  stdio.restore()
  vi.unstubAllGlobals()
  await fs.rm(dir, { recursive: true, force: true })
})

// Standard happy-path fetch response factory.
function mockOk(messageId = 4242) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ ok: true, result: { message_id: messageId } }), {
      status: 200,
    }),
  )
}

function mockStatus(status: number, body: string) {
  fetchMock.mockResolvedValueOnce(new Response(body, { status }))
}

function capture(): { exit: number | null; out: string; err: string } {
  return {
    exit: exitSpy.code,
    out: stdio.captured.stdout.join(''),
    err: stdio.captured.stderr.join(''),
  }
}

async function runCatch(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    if (err instanceof ExitCalled) return
    throw err
  }
}

// Default input factory for runNotifySend
function input(over: Partial<Parameters<typeof runNotifySend>[0]> = {}) {
  return {
    severity: 'info',
    title: 'ping',
    context: [],
    soft: false,
    quiet: false,
    format: 'json' as const,
    cwd: dir,
    ...over,
  }
}

// ---------- happy path + JSON shape ----------

describe('runNotifySend — happy path', () => {
  it('POSTs to Telegram and emits json with sent: true', async () => {
    mockOk(7777)
    await runNotifySend(input({ severity: 'error', title: 'crash', agent: 'claude', session: 'telegram-notify' }))
    const c = capture()
    expect(c.exit).toBeNull() // success exits via natural return, not throw
    const parsed = JSON.parse(c.out)
    expect(parsed).toEqual({
      sent: true,
      severity: 'error',
      title: 'crash',
      agent: 'claude',
      session: 'telegram-notify',
      telegram_chat_id: CHAT_ID,
      telegram_message_id: 7777,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`)
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.chat_id).toBe(CHAT_ID)
    expect(body.parse_mode).toBe('MarkdownV2')
    expect(body.disable_notification).toBe(false)
    // Header: emoji + bold title on a single line (no "ERROR" tag).
    expect(body.text).toContain('🔥 *crash*')
    expect(body.text).not.toMatch(/\bERROR\b/)
    // Footer: dash-emoji bullet list, each value escaped.
    expect(body.text).toContain(`${FOOTER_EMOJI.agent} claude`)
    expect(body.text).toContain(`${FOOTER_EMOJI.session} telegram\\-notify`)
  })

  it('session: null in json output when --session absent', async () => {
    mockOk()
    await runNotifySend(input({}))
    const parsed = JSON.parse(capture().out)
    expect(parsed.session).toBeNull()
  })

  it('--quiet sets disable_notification: true', async () => {
    mockOk()
    await runNotifySend(input({ quiet: true }))
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))
    expect(body.disable_notification).toBe(true)
  })
})

// ---------- validation ----------

describe('runNotifySend — input validation', () => {
  it('unknown severity → BAD_REQUEST exit 2, no network', async () => {
    await runCatch(() => runNotifySend(input({ severity: 'oops' })))
    expect(exitSpy.code).toBe(2)
    expect(stdio.captured.stderr.join('')).toContain('BAD_REQUEST')
    expect(stdio.captured.stderr.join('')).toMatch(/info, warn, error, question, done/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('title > 200 chars → BAD_REQUEST exit 2', async () => {
    await runCatch(() => runNotifySend(input({ title: 'x'.repeat(201) })))
    expect(exitSpy.code).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('empty title → BAD_REQUEST exit 2', async () => {
    await runCatch(() => runNotifySend(input({ title: '' })))
    expect(exitSpy.code).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('> 10 --context entries → BAD_REQUEST exit 2', async () => {
    const ctx = Array.from({ length: 11 }, (_, i) => [`k${i}`, `v${i}`] as const)
    await runCatch(() => runNotifySend(input({ context: ctx as Array<readonly [string, string]> })))
    expect(exitSpy.code).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reserved --context key (host) → BAD_REQUEST exit 2', async () => {
    await runCatch(() =>
      runNotifySend(input({ context: [['host', 'foo']] as Array<readonly [string, string]> })),
    )
    expect(exitSpy.code).toBe(2)
    expect(stdio.captured.stderr.join('')).toContain('reserved')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('--link without https:// → BAD_REQUEST exit 2', async () => {
    await runCatch(() => runNotifySend(input({ link: 'http://example.com' })))
    expect(exitSpy.code).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('malformed --agent → BAD_REQUEST exit 2', async () => {
    await runCatch(() => runNotifySend(input({ agent: 'MyShell!' })))
    expect(exitSpy.code).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('--session > 80 chars → BAD_REQUEST exit 2', async () => {
    await runCatch(() => runNotifySend(input({ session: 'x'.repeat(81) })))
    expect(exitSpy.code).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('well-formed unknown agent literal passes through', async () => {
    mockOk()
    await runNotifySend(input({ agent: 'my-experimental-shell' }))
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))
    expect(body.text).toContain(`${FOOTER_EMOJI.agent} my\\-experimental\\-shell`)
    const parsed = JSON.parse(stdio.captured.stdout.join(''))
    expect(parsed.agent).toBe('my-experimental-shell')
  })

  it('CLAUDECODE=1 env, no --agent → footer reads claude', async () => {
    process.env.CLAUDECODE = '1'
    mockOk()
    try {
      await runNotifySend(input({}))
    } finally {
      delete process.env.CLAUDECODE
    }
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))
    expect(body.text).toContain(`${FOOTER_EMOJI.agent} claude`)
  })
})

// ---------- details from file / stdin ----------

describe('runNotifySend — details from file / stdin', () => {
  it('reads --details-file from disk and renders markdown', async () => {
    const p = join(dir, 'note.md')
    await fs.writeFile(p, 'multi-line\n*markdown* here\n')
    mockOk()
    await runNotifySend(input({ detailsFile: p }))
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))
    expect(body.text).toContain('multi\\-line')
    // `*markdown*` is CommonMark italic → rendered as Telegram italic `_…_`.
    expect(body.text).toContain('_markdown_ here')
  })

  it('NOT_FOUND when --details-file path does not exist', async () => {
    await runCatch(() => runNotifySend(input({ detailsFile: '/this/does/not/exist-9z9z.md' })))
    expect(exitSpy.code).toBe(4)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects --details AND --details-file together', async () => {
    await runCatch(() => runNotifySend(input({ details: 'x', detailsFile: '-' })))
    expect(exitSpy.code).toBe(2)
    expect(stdio.captured.stderr.join('')).toContain('mutually exclusive')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads --details-file - from stdin', async () => {
    const realStdin = process.stdin
    const fake = Readable.from(['hello\nfrom stdin\n']) as unknown as NodeJS.ReadStream
    Object.defineProperty(fake, 'isTTY', { value: false, configurable: true })
    Object.defineProperty(process, 'stdin', { value: fake, configurable: true })
    try {
      mockOk()
      await runNotifySend(input({ detailsFile: '-' }))
      const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))
      expect(body.text).toContain('hello')
      expect(body.text).toContain('from stdin')
    } finally {
      Object.defineProperty(process, 'stdin', { value: realStdin, configurable: true })
    }
  })

  it('empty stdin treated as absent details', async () => {
    const realStdin = process.stdin
    const fake = Readable.from([]) as unknown as NodeJS.ReadStream
    Object.defineProperty(fake, 'isTTY', { value: false, configurable: true })
    Object.defineProperty(process, 'stdin', { value: fake, configurable: true })
    try {
      mockOk()
      await runNotifySend(input({ detailsFile: '-' }))
      const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))
      // No "details" content — but the title and footer are still there.
      expect(body.text).toContain('*ping*')
      expect(body.text).not.toContain('hello')
    } finally {
      Object.defineProperty(process, 'stdin', { value: realStdin, configurable: true })
    }
  })
})

// ---------- credentials resolution ----------

describe('runNotifySend — credentials', () => {
  it('env vars win over config.yml', async () => {
    process.env.MEMON_TELEGRAM_BOT_TOKEN = 'ENV-TOKEN'
    process.env.MEMON_TELEGRAM_CHAT_ID = '-999'
    try {
      mockOk()
      await runNotifySend(input({}))
      const [url] = fetchMock.mock.calls[0]!
      expect(String(url)).toContain('ENV-TOKEN')
      const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))
      expect(body.chat_id).toBe('-999')
    } finally {
      delete process.env.MEMON_TELEGRAM_BOT_TOKEN
      delete process.env.MEMON_TELEGRAM_CHAT_ID
    }
  })

  it('partial env vars warn and fall back to config.yml', async () => {
    process.env.MEMON_TELEGRAM_BOT_TOKEN = 'ENV-ONLY'
    try {
      mockOk()
      await runNotifySend(input({}))
      const [url] = fetchMock.mock.calls[0]!
      expect(String(url)).toContain(BOT_TOKEN) // config wins
      expect(stdio.captured.stderr.join('')).toContain('only one of MEMON_TELEGRAM_BOT_TOKEN')
    } finally {
      delete process.env.MEMON_TELEGRAM_BOT_TOKEN
    }
  })

  it('neither env nor config.yml → BAD_REQUEST naming both sources', async () => {
    const noCfgDir = await fs.mkdtemp(join(tmpdir(), 'memon-notify-empty-'))
    try {
      await runCatch(() => runNotifySend(input({ cwd: noCfgDir })))
      expect(exitSpy.code).toBe(2)
      const err = stdio.captured.stderr.join('')
      expect(err).toContain('MEMON_TELEGRAM_BOT_TOKEN')
      expect(err).toContain('MEMON_TELEGRAM_CHAT_ID')
      expect(err).toContain('telegram:')
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      await fs.rm(noCfgDir, { recursive: true, force: true })
    }
  })
})

// ---------- error paths ----------

describe('runNotifySend — error paths', () => {
  it('401 → stderr says token rejected, exit 1, token redacted', async () => {
    mockStatus(401, JSON.stringify({ description: BOT_TOKEN }))
    await runCatch(() => runNotifySend(input({})))
    expect(exitSpy.code).toBe(1)
    const err = stdio.captured.stderr.join('')
    expect(err).toContain('401 Unauthorized')
    // Critical security check: token MUST NOT appear in any stream.
    expect(stdio.captured.stdout.join('') + err).not.toContain(BOT_TOKEN)
  })

  it('500 → exit 1, no token in any stream', async () => {
    mockStatus(500, `oops ${BOT_TOKEN} bad`)
    await runCatch(() => runNotifySend(input({})))
    expect(exitSpy.code).toBe(1)
    expect(stdio.captured.stdout.join('') + stdio.captured.stderr.join('')).not.toContain(BOT_TOKEN)
  })

  it('--soft on 500 → exit 0, stderr still has envelope', async () => {
    mockStatus(500, 'down')
    await runNotifySend(input({ soft: true }))
    expect(exitSpy.code).toBeNull()
    expect(stdio.captured.stderr.join('')).toContain('"error"')
    const parsed = JSON.parse(stdio.captured.stdout.join(''))
    expect(parsed.sent).toBe(false)
  })

  it('network error (rejected fetch) → exit 1 without token leak', async () => {
    fetchMock.mockRejectedValueOnce(new Error(`ENOTFOUND ${BOT_TOKEN}`))
    await runCatch(() => runNotifySend(input({})))
    expect(exitSpy.code).toBe(1)
    expect(stdio.captured.stdout.join('') + stdio.captured.stderr.join('')).not.toContain(BOT_TOKEN)
  })
})

// ---------- notify test ----------

describe('runNotifyTest', () => {
  it('happy path: sends a fixed canary, exits 0, JSON sent: true', async () => {
    mockOk(1)
    await runNotifyTest({ format: 'json', cwd: dir })
    expect(exitSpy.code).toBeNull()
    const parsed = JSON.parse(stdio.captured.stdout.join(''))
    expect(parsed.sent).toBe(true)
    expect(parsed.title).toBe('memon notify self-test')
  })

  it('no creds → BAD_REQUEST exit 2 (ignores any soft intent)', async () => {
    const noCfgDir = await fs.mkdtemp(join(tmpdir(), 'memon-notify-test-empty-'))
    try {
      await runCatch(() => runNotifyTest({ format: 'json', cwd: noCfgDir }))
      expect(exitSpy.code).toBe(2)
    } finally {
      await fs.rm(noCfgDir, { recursive: true, force: true })
    }
  })

  it('500 from telegram → exit 1 (NOT soft-swallowed)', async () => {
    mockStatus(500, 'down')
    await runCatch(() => runNotifyTest({ format: 'json', cwd: dir }))
    expect(exitSpy.code).toBe(1)
  })
})

// ---------- footer + git probe ----------

describe('runNotifySend — footer', () => {
  it('outside a git repo, branch line omitted', async () => {
    // dir is a fresh tmpdir; no git init done — probe returns undefined.
    mockOk()
    await runNotifySend(input({}))
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))
    expect(body.text).not.toContain(FOOTER_EMOJI.branch)
    expect(body.text).toContain(FOOTER_EMOJI.host)
    expect(body.text).toContain(FOOTER_EMOJI.agent)
    expect(body.text).toContain(FOOTER_EMOJI.cwd)
    expect(body.text).toContain(FOOTER_EMOJI.ts)
  })

  it('agent falls back to unknown when no flag + no CLAUDECODE', async () => {
    mockOk()
    await runNotifySend(input({}))
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))
    expect(body.text).toContain(`${FOOTER_EMOJI.agent} unknown`)
  })
})
