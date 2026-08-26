import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const TTYD_VERSION = '1.7.7'
export const MAX_TTYD_DOWNLOAD_BYTES = 32 * 1024 * 1024
export const MAX_TTYD_CHECKSUM_BYTES = 64 * 1024

const ARCH_TO_ASSET: Readonly<Record<string, string>> = {
  x64: 'x86_64',
  arm64: 'aarch64',
  arm: 'armhf',
  ia32: 'i686',
  mips: 'mips',
  mipsel: 'mipsel',
}

export interface BackendTerminalProbeResult {
  available: boolean
  version?: string
  source?: 'cached' | 'path'
  /** Internal executable path; lifecycle responses deliberately omit it. */
  path?: string
  downloadable?: boolean
  suggestion?: string
}

export interface BackendTerminalInstallResult {
  ok: true
  version: string
  /** Internal executable path; lifecycle responses deliberately omit it. */
  path: string
  alreadyPresent?: boolean
  durationMs: number
}

export type BackendTtydInstallErrorCode =
  | 'DOWNLOAD_FAILED'
  | 'INTEGRITY_FAILED'
  | 'NOT_AUTOFETCHABLE'
  | 'EXEC_FAILED'

export class BackendTtydInstallError extends Error {
  constructor(
    public readonly code: BackendTtydInstallErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'BackendTtydInstallError'
  }
}

function archAsset(): string | null {
  return ARCH_TO_ASSET[process.arch] ?? null
}

export function backendTtydCachePath(version = TTYD_VERSION): string | null {
  const asset = archAsset()
  return asset ? join(homedir(), '.cache', 'memon', 'bin', `ttyd-${version}-${asset}`) : null
}

function releaseUrl(version = TTYD_VERSION): string | null {
  const asset = archAsset()
  return asset ? `https://github.com/tsl0922/ttyd/releases/download/${version}/ttyd.${asset}` : null
}

function checksumUrl(version = TTYD_VERSION): string {
  return `https://github.com/tsl0922/ttyd/releases/download/${version}/SHA256SUMS`
}

async function readVersion(path: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(path, ['--version'], { timeout: 5_000 })
    return /ttyd version (\S+)/.exec(`${stdout || ''}${stderr || ''}`)?.[1] ?? null
  } catch {
    return null
  }
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path)
    return stat.isFile() && (stat.mode & 0o100) !== 0
  } catch {
    return false
  }
}

function versionMatchesPin(version: string | null): boolean {
  return version === TTYD_VERSION || version?.startsWith(`${TTYD_VERSION}-`) === true
}

async function whichTtyd(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', ['ttyd'], { timeout: 2_000 })
    return stdout.trim() || null
  } catch {
    return null
  }
}

export async function probeBackendTtyd(): Promise<BackendTerminalProbeResult> {
  const cached = backendTtydCachePath()
  if (cached && (await isExecutableFile(cached))) {
    const version = await readVersion(cached)
    if (versionMatchesPin(version)) {
      return { available: true, version: version!, source: 'cached', path: cached }
    }
  }
  const pathTtyd = await whichTtyd()
  if (pathTtyd) {
    const version = await readVersion(pathTtyd)
    if (version) return { available: true, version, source: 'path', path: pathTtyd }
  }
  if (process.platform === 'darwin') {
    return { available: false, downloadable: false, suggestion: 'brew install ttyd' }
  }
  if (archAsset()) {
    return {
      available: false,
      downloadable: true,
      suggestion: 'POST /api/terminal/install on the selected Host',
    }
  }
  return {
    available: false,
    downloadable: false,
    suggestion: `no upstream prebuilt for arch ${process.arch}; build ttyd from source`,
  }
}

let installInflight: Promise<BackendTerminalInstallResult> | null = null

export function installBackendTtyd(): Promise<BackendTerminalInstallResult> {
  if (installInflight) return installInflight
  installInflight = doInstall().finally(() => {
    installInflight = null
  })
  return installInflight
}

async function doInstall(): Promise<BackendTerminalInstallResult> {
  const startedAt = Date.now()
  if (process.platform === 'darwin') {
    throw new BackendTtydInstallError(
      'NOT_AUTOFETCHABLE',
      'Upstream ttyd has no prebuilt darwin binary; install it with brew',
    )
  }
  const url = releaseUrl()
  const target = backendTtydCachePath()
  if (!url || !target) {
    throw new BackendTtydInstallError(
      'NOT_AUTOFETCHABLE',
      `No prebuilt ttyd binary exists for ${process.arch}`,
    )
  }
  if (await isExecutableFile(target)) {
    const version = await readVersion(target)
    if (versionMatchesPin(version)) {
      return {
        ok: true,
        version: version!,
        path: target,
        alreadyPresent: true,
        durationMs: Date.now() - startedAt,
      }
    }
  }

  await fs.mkdir(join(target, '..'), { recursive: true })
  const expectedHash = await fetchBackendTtydChecksum(checksumUrl(), `ttyd.${archAsset()}`)
  const binary = await fetchBoundedBackendTtydBytes(url)
  const actualHash = createHash('sha256').update(binary).digest('hex')
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new BackendTtydInstallError('INTEGRITY_FAILED', 'Downloaded ttyd hash is invalid')
  }
  const temporary = `${target}.tmp.${randomSuffix()}`
  try {
    await fs.writeFile(temporary, binary, { mode: 0o700, flag: 'wx' })
    await fs.chmod(temporary, 0o755)
    await fs.rename(temporary, target)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  const version = await readVersion(target)
  if (!version) {
    throw new BackendTtydInstallError('EXEC_FAILED', 'Installed ttyd did not report a version')
  }
  return {
    ok: true,
    version,
    path: target,
    durationMs: Date.now() - startedAt,
  }
}

function randomSuffix(): string {
  return `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`
}

async function boundedResponseBytes(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Buffer> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new BackendTtydInstallError('DOWNLOAD_FAILED', `${label} exceeds the size limit`)
    }
  }
  if (!response.body) {
    throw new BackendTtydInstallError('DOWNLOAD_FAILED', `${label} response has no body`)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new BackendTtydInstallError('DOWNLOAD_FAILED', `${label} exceeds the size limit`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

export async function fetchBoundedBackendTtydBytes(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  let response: Response
  try {
    response = await fetchImpl(url, { redirect: 'follow' })
  } catch {
    throw new BackendTtydInstallError('DOWNLOAD_FAILED', 'Failed to download ttyd')
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new BackendTtydInstallError('DOWNLOAD_FAILED', 'ttyd download returned an error')
  }
  return boundedResponseBytes(response, MAX_TTYD_DOWNLOAD_BYTES, 'ttyd download')
}

export async function fetchBackendTtydChecksum(
  url: string,
  asset: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let response: Response
  try {
    response = await fetchImpl(url, { redirect: 'follow' })
  } catch {
    throw new BackendTtydInstallError('INTEGRITY_FAILED', 'Failed to download ttyd checksums')
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new BackendTtydInstallError('INTEGRITY_FAILED', 'ttyd checksums are unavailable')
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(
      await boundedResponseBytes(response, MAX_TTYD_CHECKSUM_BYTES, 'ttyd checksums'),
    )
  } catch {
    throw new BackendTtydInstallError('INTEGRITY_FAILED', 'ttyd checksums are invalid')
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+\*?([^\s]+)$/.exec(line.trim())
    if (match?.[2] === asset) return match[1]!.toLowerCase()
  }
  throw new BackendTtydInstallError(
    'INTEGRITY_FAILED',
    'ttyd checksum does not contain the selected asset',
  )
}
