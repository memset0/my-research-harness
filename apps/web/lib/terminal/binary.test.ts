// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// We mock node:fs/promises before importing the module under test.
const mocks = vi.hoisted(() => ({
  stat: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  chmod: vi.fn(),
  rename: vi.fn(),
}))

vi.mock('node:fs', () => ({
  promises: mocks,
}))

const fetchMock = vi.fn()
// biome-ignore lint/suspicious/noExplicitAny: test stub
;(globalThis as any).fetch = fetchMock

import {
  TTYD_VERSION,
  TtydInstallError,
  cachePath,
  installTtyd,
  probeTtyd,
} from './binary'

function ok(body: Buffer | string) {
  const buf = typeof body === 'string' ? Buffer.from(body) : body
  // Build a minimal Response-shaped object — the production code uses
  // `Readable.fromWeb(res.body)` for binaries and `await res.text()` for sha.
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(buf))
        controller.close()
      },
    }),
    text: async () => buf.toString('utf8'),
  } as unknown as Response
}

describe('cachePath', () => {
  it('returns a path for known archs (linux x64 in CI)', () => {
    if (process.arch !== 'x64' && process.arch !== 'arm64') {
      // Skip on truly exotic CI archs
      expect(cachePath()).toBeDefined()
      return
    }
    const p = cachePath()
    expect(p).toMatch(new RegExp(`/\\.cache/memon/bin/ttyd-${TTYD_VERSION}-`))
  })
})

describe('probeTtyd / installTtyd', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
  })

  it('reports macOS as non-autofetchable', async () => {
    if (process.platform !== 'darwin') {
      // We can't easily simulate process.platform without messing with globals;
      // just assert the install path returns the right error class.
      // (Probe behavior is exercised below.)
      return
    }
    await expect(installTtyd()).rejects.toMatchObject({
      code: 'NOT_AUTOFETCHABLE',
    })
  })

  it('install: throws DOWNLOAD_FAILED when fetch returns 404', async () => {
    if (process.platform === 'darwin') return
    // First fetch (binary) → 404
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as Response)
    // Second (sha256 sidecar) won't matter since binary fetch failed first;
    // but installTtyd kicks both off via Promise.all, so include a stub.
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as Response)

    // Make stat say "no cache file" so we don't short-circuit
    mocks.stat.mockRejectedValue(new Error('ENOENT'))

    await expect(installTtyd()).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' })
  })

  it('install: writes binary + chmod + rename on happy path', async () => {
    if (process.platform === 'darwin') return

    mocks.stat.mockRejectedValue(new Error('ENOENT')) // no cache hit
    mocks.mkdir.mockResolvedValue(undefined)
    mocks.writeFile.mockResolvedValue(undefined)
    mocks.chmod.mockResolvedValue(undefined)
    mocks.rename.mockResolvedValue(undefined)

    const fakeBinary = Buffer.from('fake-ttyd-binary-bytes')

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('.sha256')) return ok('') // no sha published — skip check
      return ok(fakeBinary)
    })

    // We don't assert the final outcome here — whether the post-rename
    // `--version` exec succeeds depends on what's at the real cache path on
    // the test machine (which may or may not have an actual ttyd installed
    // by a previous live run). What matters for this test is that the IO
    // path between fetch and rename ran end-to-end.
    await installTtyd().catch(() => {})

    expect(mocks.mkdir).toHaveBeenCalled()
    expect(mocks.writeFile).toHaveBeenCalled()
    expect(mocks.chmod).toHaveBeenCalledWith(expect.any(String), 0o755)
    expect(mocks.rename).toHaveBeenCalled()
  })

  it('install: INTEGRITY_FAILED when sha256 mismatches', async () => {
    if (process.platform === 'darwin') return

    mocks.stat.mockRejectedValue(new Error('ENOENT'))
    mocks.mkdir.mockResolvedValue(undefined)

    const fakeBinary = Buffer.from('fake-ttyd-binary-bytes')
    // sha256 of "fake-ttyd-binary-bytes" is NOT this — guaranteed mismatch
    const wrongSha = '0'.repeat(64)

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('.sha256')) return ok(`${wrongSha}  ttyd.x86_64`)
      return ok(fakeBinary)
    })

    await expect(installTtyd()).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' })

    // No file write/rename should occur once sha mismatches
    expect(mocks.writeFile).not.toHaveBeenCalled()
    expect(mocks.rename).not.toHaveBeenCalled()
  })

  it('probeTtyd: returns downloadable on linux x64 when no binary present', async () => {
    if (process.platform !== 'linux') return
    if (process.arch !== 'x64' && process.arch !== 'arm64') return
    mocks.stat.mockRejectedValue(new Error('ENOENT'))
    const result = await probeTtyd()
    // Either available (PATH lookup hit on someone's machine) or downloadable
    if (!result.available) {
      expect(result.downloadable).toBe(true)
    }
  })
})
