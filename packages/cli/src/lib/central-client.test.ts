import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { captureCli } from '../test-support/results-project.js'
import {
  centralConfigPath,
  centralRequest,
  login,
  logout,
  resolveCentral,
} from './central-client.js'

let home: string
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'memon-central-client-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(home, { recursive: true, force: true })
})

const TOKEN = `mtk_${'a'.repeat(43)}`

function fetchAnswering(status: number, body: unknown = {}) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

it('prefers environment token, then the stored login, then legacy Basic credentials', async () => {
  const fetch = fetchAnswering(200)
  expect(
    await resolveCentral({
      fetch,
      home,
      env: { MEMON_CENTRAL_URL: 'https://c.example/', MEMON_CENTRAL_TOKEN: TOKEN },
    }),
  ).toEqual({ base: 'https://c.example', authorization: `Bearer ${TOKEN}` })

  await mkdir(path.dirname(centralConfigPath(home)), { recursive: true })
  await writeFile(
    centralConfigPath(home),
    JSON.stringify({ url: 'https://s.example', token: TOKEN }),
  )
  expect(await resolveCentral({ fetch, home, env: { MEMON_CENTRAL_AUTH: 'o:p' } })).toEqual({
    base: 'https://s.example',
    authorization: `Bearer ${TOKEN}`,
  })

  await rm(centralConfigPath(home))
  expect(await resolveCentral({ fetch, home, env: { MEMON_CENTRAL_AUTH: 'o:p' } })).toEqual({
    base: 'http://localhost:3737',
    authorization: `Basic ${Buffer.from('o:p').toString('base64')}`,
  })
  const missing = await captureCli(() => resolveCentral({ fetch, home, env: {} }))
  expect(missing.error?.code).toBe('BAD_REQUEST')
})

it('logs in only with a token central accepts, storing it owner-only', async () => {
  const fetch = fetchAnswering(200, { tokens: [] })
  const stored = await login({ fetch, home, env: {} }, 'https://c.example/', ` ${TOKEN}\n`)
  expect(stored.url).toBe('https://c.example')
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('https://c.example/api/tokens')
  expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`)
  expect(JSON.parse(await readFile(centralConfigPath(home), 'utf8'))).toEqual({
    url: 'https://c.example',
    token: TOKEN,
  })
  expect((await stat(centralConfigPath(home))).mode & 0o777).toBe(0o600)
  expect(await logout({ home })).toBe(true)
  expect(await logout({ home })).toBe(false)
})

it('writes nothing and never prints the token when central rejects it', async () => {
  const fetch = fetchAnswering(401, { error: { code: 'UNAUTHORIZED', message: 'bad token' } })
  const result = await captureCli(() => login({ fetch, home, env: {} }, 'https://c.example', TOKEN))
  expect(result.error?.code).toBe('FORBIDDEN')
  expect(`${result.stdout}${result.stderr}`).not.toContain(TOKEN)
  await expect(stat(centralConfigPath(home))).rejects.toMatchObject({ code: 'ENOENT' })
  const bad = await captureCli(() => login({ fetch, home, env: {} }, 'https://c.example', 'nope'))
  expect(bad.error?.code).toBe('BAD_REQUEST')
})

it('maps central statuses onto CLI error codes', async () => {
  const fetch = fetchAnswering(409, { error: { code: 'OWNER_MISMATCH', message: 'not yours' } })
  const result = await captureCli(() =>
    centralRequest(
      { fetch, home, env: { MEMON_CENTRAL_URL: 'https://c', MEMON_CENTRAL_TOKEN: TOKEN } },
      'GET',
      '/x',
    ),
  )
  expect(result.error?.code).toBe('CONFLICT')
  expect(result.error?.details).toEqual({ code: 'OWNER_MISMATCH' })
})
