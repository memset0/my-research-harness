// ttyd binary self-management — no root, no apt/brew on the runtime side.
//
// Strategy:
//   1. Pin a known-good upstream version (`TTYD_VERSION`).
//   2. Detect via cache (`~/.cache/memon/bin/ttyd-<v>-<arch>`) → fall back to PATH.
//   3. If absent on a downloadable arch, expose `installTtyd()` that fetches
//      the prebuilt static binary from GitHub Releases, sha256-verifies it,
//      and atomic-renames into the cache. Concurrent installs are serialized
//      via an in-process mutex.
//
// macOS has no upstream prebuilt — `installTtyd()` rejects with a hint to
// `brew install ttyd`; users on darwin can also drop their own binary into
// PATH and `probeTtyd()` will pick it up.

import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Readable } from 'node:stream'

const execFileAsync = promisify(execFile)

export const TTYD_VERSION = '1.7.7'

/** Map Node `process.arch` to the ttyd release asset suffix. */
const ARCH_TO_ASSET: Readonly<Record<string, string>> = {
  x64: 'x86_64',
  arm64: 'aarch64',
  arm: 'armhf',
  ia32: 'i686',
  mips: 'mips',
  mipsel: 'mipsel',
}

export interface ProbeResult {
  available: boolean
  version?: string
  source?: 'cached' | 'path'
  /** Absolute path to the ttyd binary that should be exec'd. */
  path?: string
  /** Linux + supported arch + no binary present yet → user can hit /api/terminal/install. */
  downloadable?: boolean
  suggestion?: string
}

export interface InstallResult {
  ok: true
  version: string
  path: string
  alreadyPresent?: boolean
  durationMs: number
}

export class TtydInstallError extends Error {
  constructor(
    public code:
      | 'DOWNLOAD_FAILED'
      | 'INTEGRITY_FAILED'
      | 'NOT_AUTOFETCHABLE'
      | 'EXEC_FAILED',
    message: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'TtydInstallError'
  }
}

function archAsset(): string | null {
  return ARCH_TO_ASSET[process.arch] ?? null
}

export function cachePath(version = TTYD_VERSION): string | null {
  const asset = archAsset()
  if (!asset) return null
  return join(homedir(), '.cache', 'memon', 'bin', `ttyd-${version}-${asset}`)
}

function releaseUrl(version = TTYD_VERSION): string | null {
  const asset = archAsset()
  if (!asset) return null
  return `https://github.com/tsl0922/ttyd/releases/download/${version}/ttyd.${asset}`
}

/** Run `<path> --version` and return the version string, or null on failure. */
async function readVersion(path: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(path, ['--version'], {
      timeout: 5000,
    })
    // ttyd prints "ttyd version 1.7.7" — sometimes on stderr depending on version
    const text = (stdout || '') + (stderr || '')
    const m = /ttyd version (\S+)/.exec(text)
    return m ? m[1]! : null
  } catch {
    return null
  }
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path)
    if (!stat.isFile()) return false
    // Check user-execute bit (mask 0o100)
    return (stat.mode & 0o100) !== 0
  } catch {
    return false
  }
}

/**
 * Returns true when an actual `ttyd --version` output starts with our pinned
 * version. Upstream embeds the git short-hash, so `1.7.7-40e79c7` should be
 * treated as a 1.7.7 build (we don't fail on the suffix).
 */
function versionMatchesPin(actual: string | null): boolean {
  if (!actual) return false
  return actual === TTYD_VERSION || actual.startsWith(`${TTYD_VERSION}-`)
}

/** First positive hit wins: cache → PATH. */
export async function probeTtyd(): Promise<ProbeResult> {
  const cached = cachePath()
  if (cached && (await isExecutableFile(cached))) {
    const version = await readVersion(cached)
    if (versionMatchesPin(version)) {
      return {
        available: true,
        version: version!,
        source: 'cached',
        path: cached,
      }
    }
  }

  // Fallback: user installed ttyd manually (PATH lookup)
  const pathTtyd = await whichTtyd()
  if (pathTtyd) {
    const version = await readVersion(pathTtyd)
    if (version) {
      return { available: true, version, source: 'path', path: pathTtyd }
    }
  }

  // Not available — describe how to get it
  if (process.platform === 'darwin') {
    return {
      available: false,
      downloadable: false,
      suggestion: 'brew install ttyd',
    }
  }
  if (archAsset()) {
    return {
      available: false,
      downloadable: true,
      suggestion: 'POST /api/terminal/install',
    }
  }
  return {
    available: false,
    downloadable: false,
    suggestion: `no upstream prebuilt for arch ${process.arch}; build ttyd from source`,
  }
}

async function whichTtyd(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', ['ttyd'], { timeout: 2000 })
    const path = stdout.trim()
    return path || null
  } catch {
    return null
  }
}

// In-process mutex: never run two installs at once.
let installInflight: Promise<InstallResult> | null = null

export function installTtyd(): Promise<InstallResult> {
  if (installInflight) return installInflight
  installInflight = doInstall().finally(() => {
    installInflight = null
  })
  return installInflight
}

async function doInstall(): Promise<InstallResult> {
  const start = Date.now()

  if (process.platform === 'darwin') {
    throw new TtydInstallError(
      'NOT_AUTOFETCHABLE',
      'Upstream ttyd does not publish prebuilt darwin binaries — install via `brew install ttyd`',
    )
  }
  const url = releaseUrl()
  const target = cachePath()
  if (!url || !target) {
    throw new TtydInstallError(
      'NOT_AUTOFETCHABLE',
      `No prebuilt binary for arch=${process.arch}`,
    )
  }

  // Cache hit — short-circuit
  if (await isExecutableFile(target)) {
    const v = await readVersion(target)
    if (versionMatchesPin(v)) {
      return {
        ok: true,
        version: v!,
        path: target,
        alreadyPresent: true,
        durationMs: Date.now() - start,
      }
    }
  }

  await fs.mkdir(join(target, '..'), { recursive: true })

  // Download binary + sha256 sidecar in parallel
  const [binBuf, expectedSha] = await Promise.all([
    fetchBytes(url),
    fetchOptionalSha(`${url}.sha256`),
  ])

  if (expectedSha) {
    const actual = createHash('sha256').update(binBuf).digest('hex')
    if (actual.toLowerCase() !== expectedSha.toLowerCase()) {
      throw new TtydInstallError(
        'INTEGRITY_FAILED',
        `sha256 mismatch: expected ${expectedSha}, got ${actual}`,
      )
    }
  }

  // Atomic write: tmp file → chmod → rename
  const tmpPath = `${target}.tmp.${Math.random().toString(36).slice(2)}`
  await fs.writeFile(tmpPath, binBuf)
  await fs.chmod(tmpPath, 0o755)
  await fs.rename(tmpPath, target)

  const v = await readVersion(target)
  if (!v) {
    throw new TtydInstallError(
      'EXEC_FAILED',
      `ttyd binary at ${target} did not respond to --version`,
    )
  }

  return {
    ok: true,
    version: v,
    path: target,
    durationMs: Date.now() - start,
  }
}

async function fetchBytes(url: string): Promise<Buffer> {
  let res: Response
  try {
    res = await fetch(url, { redirect: 'follow' })
  } catch (err) {
    throw new TtydInstallError(
      'DOWNLOAD_FAILED',
      `network error fetching ${url}: ${(err as Error).message}`,
      err,
    )
  }
  if (!res.ok) {
    throw new TtydInstallError(
      'DOWNLOAD_FAILED',
      `${url} returned HTTP ${res.status}`,
    )
  }
  if (!res.body) {
    throw new TtydInstallError('DOWNLOAD_FAILED', `${url} returned empty body`)
  }
  const chunks: Uint8Array[] = []
  // node fetch returns a web stream; pipe via Readable.fromWeb for buffering
  const node = Readable.fromWeb(res.body as never)
  for await (const chunk of node) {
    chunks.push(chunk as Uint8Array)
  }
  return Buffer.concat(chunks)
}

async function fetchOptionalSha(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) return null
    const text = await res.text()
    // sha256 files are typically "<hash>  <filename>"; first token is the hash
    const m = /^([0-9a-fA-F]{64})\b/.exec(text.trim())
    return m ? m[1]! : null
  } catch {
    return null
  }
}
