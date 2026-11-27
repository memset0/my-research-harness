// How the CLI reaches memon central: one credential lookup and one request
// helper shared by `memon login` and the central-facing commands.
//
// Credential order:
//   1. MEMON_CENTRAL_URL + MEMON_CENTRAL_TOKEN (environment)
//   2. ~/.config/memon/central.json written by `memon login` ({url, token}, 0600)
//   3. legacy owner Basic credentials (MEMON_CENTRAL_AUTH or ~/.config/memon/central-auth)
//      against MEMON_CENTRAL_URL, default http://localhost:3737
// Credentials are never printed.

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { emitErrorAndExit } from './emit-error.js'
import { EXIT } from './exit-codes.js'

export interface CentralTarget {
  base: string
  authorization: string
}

export interface CentralClientDeps {
  fetch: typeof fetch
  env: NodeJS.ProcessEnv
  /** Home directory holding `.config/memon`; defaults to the user's. */
  home?: string
}

export const LEGACY_CENTRAL_URL = 'http://localhost:3737'

export function centralConfigPath(home = os.homedir()): string {
  return path.join(home, '.config', 'memon', 'central.json')
}

const trimBase = (url: string) => url.replace(/\/+$/, '')

export function normaliseCentralUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    emitErrorAndExit('BAD_REQUEST', `"${raw}" is not a URL`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    emitErrorAndExit('BAD_REQUEST', 'the central URL must be http(s)')
  if (url.username || url.password)
    emitErrorAndExit('BAD_REQUEST', 'put credentials in the token, not the URL')
  return trimBase(`${url.origin}${url.pathname}`)
}

export async function resolveCentral(deps: CentralClientDeps): Promise<CentralTarget> {
  const { env } = deps
  if (env.MEMON_CENTRAL_URL && env.MEMON_CENTRAL_TOKEN)
    return {
      base: trimBase(env.MEMON_CENTRAL_URL),
      authorization: `Bearer ${env.MEMON_CENTRAL_TOKEN.trim()}`,
    }
  const stored = await fs
    .readFile(centralConfigPath(deps.home), 'utf8')
    .then((text) => JSON.parse(text) as { url?: unknown; token?: unknown })
    .catch(() => null)
  if (stored && typeof stored.url === 'string' && typeof stored.token === 'string')
    return { base: trimBase(stored.url), authorization: `Bearer ${stored.token}` }
  const legacy =
    env.MEMON_CENTRAL_AUTH ??
    (
      await fs
        .readFile(path.join(deps.home ?? os.homedir(), '.config', 'memon', 'central-auth'), 'utf8')
        .catch(() => '')
    ).trim()
  if (legacy.includes(':'))
    return {
      base: trimBase(env.MEMON_CENTRAL_URL || LEGACY_CENTRAL_URL),
      authorization: `Basic ${Buffer.from(legacy).toString('base64')}`,
    }
  emitErrorAndExit(
    'BAD_REQUEST',
    'not logged in to memon central: run `memon login <central-url>` with an API token',
  )
}

const CODE_FOR_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'FORBIDDEN',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
}

/** One JSON request to central; errors map onto the CLI exit-code table and exit. */
export async function centralRequest(
  deps: CentralClientDeps,
  method: string,
  route: string,
  body?: unknown,
  target?: CentralTarget,
): Promise<unknown> {
  const { base, authorization } = target ?? (await resolveCentral(deps))
  let response: Response
  try {
    response = await deps.fetch(`${base}${route}`, {
      method,
      headers: {
        authorization,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (err) {
    emitErrorAndExit(
      'CENTRAL_UNAVAILABLE',
      `cannot reach memon central at ${base}: ${(err as Error).message}`,
      undefined,
      EXIT.GENERIC,
    )
  }
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string }
  }
  if (!response.ok) {
    const code = payload.error?.code ?? CODE_FOR_STATUS[response.status] ?? 'GENERIC'
    const mapped = CODE_FOR_STATUS[response.status]
    emitErrorAndExit(
      mapped ?? code,
      payload.error?.message ?? `central answered ${response.status}`,
      mapped && code !== mapped ? { code } : undefined,
    )
  }
  return payload
}

/** Verify a token against central, then store it (0600). Never echoes the token. */
export async function login(
  deps: CentralClientDeps,
  rawUrl: string,
  rawToken: string,
): Promise<{ url: string; file: string }> {
  const url = normaliseCentralUrl(rawUrl)
  const token = rawToken.trim()
  if (!/^mtk_\S+$/.test(token))
    emitErrorAndExit('BAD_REQUEST', 'expected an API token (mtk_…) on standard input')
  await centralRequest(deps, 'GET', '/api/tokens', undefined, {
    base: url,
    authorization: `Bearer ${token}`,
  })
  const file = centralConfigPath(deps.home)
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.tmp`
  await fs.writeFile(temp, `${JSON.stringify({ url, token }, null, 2)}\n`, { mode: 0o600 })
  await fs.chmod(temp, 0o600)
  await fs.rename(temp, file)
  return { url, file }
}

export async function logout(deps: Pick<CentralClientDeps, 'home'>): Promise<boolean> {
  return fs
    .rm(centralConfigPath(deps.home))
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false
      throw error
    })
}
