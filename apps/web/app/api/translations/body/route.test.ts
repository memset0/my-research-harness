// @vitest-environment node

import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { createTranslationManifest } from '../../../../lib/translation/manifest'

const mocks = vi.hoisted(() => ({
  document: vi.fn(),
  invoke: vi.fn(),
  cache: new Map<string, unknown>(),
}))
vi.mock('../../../../lib/runtime', () => ({
  getRuntime: async () => ({
    configPath: './mock/config.yml',
    config: { projects: [{ name: 'project-a' }] },
  }),
}))
vi.mock('../../../../lib/translation/cache', () => ({
  getTranslationCache: () => ({
    get: async (key: string) => mocks.cache.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      mocks.cache.set(key, value)
    },
  }),
}))
vi.mock('../../../../lib/server/standalone-services', () => ({
  standaloneServices: () => ({ documents: { getWiki: mocks.document } }),
}))
vi.mock('../../../../lib/central/direct-runtime', () => ({ directCentralRuntime: vi.fn() }))
vi.mock('../../../../lib/central/fleet-runtime', () => ({ getCentralFleet: vi.fn() }))
vi.mock('../../../../lib/central/backend-proxy', () => ({ proxyCentralApiRequest: vi.fn() }))
vi.mock('../../../../lib/translation/codex', async (original) => ({
  ...(await original<object>()),
  runCodexTranslation: mocks.invoke,
}))

import { translationCacheKey } from '../../../../lib/translation/http'
import { GET as status } from '../status/route'
import { GET, POST } from './route'

const manifest = createTranslationManifest([{ format: 'markdown', text: 'Hello world' }])
const body = {
  document: { project: 'project-a', kind: 'wiki', id: 'W0001' },
  revision: manifest.revision,
  targetLanguage: 'zh-CN',
  segments: manifest.segments.map(({ id, sourceHash }) => ({ id, sourceHash })),
}
function request(role: string, value: unknown = body, headers = {}) {
  return new NextRequest('http://localhost/api/translations/body', {
    method: 'POST',
    headers: {
      'x-memon-role': role,
      'content-type': 'application/json',
      origin: 'http://localhost',
      ...headers,
    },
    body: JSON.stringify(value),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.cache.clear()
  process.env.MEMON_TRANSLATION_ENABLED = '1'
  delete (globalThis as Record<string, unknown>).__memonBodyTranslation
  mocks.document.mockResolvedValue({ content: 'Hello world' })
  mocks.invoke.mockResolvedValue(
    JSON.stringify(manifest.segments.map(({ id }) => ({ id, text: '你好世界' }))),
  )
})

it.each(['anon', 'viewer'])('denies %s before document or provider access', async (role) => {
  expect((await POST(request(role))).status).toBe(401)
  expect((await GET(request(role))).status).toBe(401)
  expect((await status(request(role))).status).toBe(401)
  expect(mocks.document).not.toHaveBeenCalled()
  expect(mocks.invoke).not.toHaveBeenCalled()
})

it('rejects cross-origin, traversal, stale and forged requests', async () => {
  expect((await POST(request('owner', body, { origin: 'https://example.com' }))).status).toBe(403)
  expect(
    (
      await POST(
        request('owner', { ...body, document: { ...body.document, project: '../project-a' } }),
      )
    ).status,
  ).toBe(400)
  expect((await POST(request('owner', { ...body, revision: '0'.repeat(64) }))).status).toBe(409)
  expect(
    (await POST(request('owner', { ...body, segments: [{ id: 'forged', sourceHash: 'forged' }] })))
      .status,
  ).toBe(409)
  expect((await POST(request('owner', { ...body, model: 'other' }))).status).toBe(400)
  expect(mocks.invoke).not.toHaveBeenCalled()
})

it('bounds HTTP input, rejects disabled use and keeps exact cache namespaces', async () => {
  expect((await POST(request('owner', { extra: 'a'.repeat(33 * 1024) }))).status).toBe(413)
  process.env.MEMON_TRANSLATION_ENABLED = '0'
  expect((await POST(request('owner'))).status).toBe(503)
  expect(mocks.invoke).not.toHaveBeenCalled()
  const document = { project: 'project-a', kind: 'wiki' as const, id: 'W0001' }
  const keys = [
    translationCacheKey(document, 'one', 'zh-CN'),
    translationCacheKey({ ...document, host: 'host-a' }, 'one', 'zh-CN'),
    translationCacheKey({ ...document, project: 'project-b' }, 'one', 'zh-CN'),
    translationCacheKey(document, 'two', 'zh-CN'),
    translationCacheKey(document, 'one', 'en'),
  ]
  expect(new Set(keys).size).toBe(5)
})

it('keeps each translation direction on its own cache namespace and rejects unknown ones', async () => {
  expect((await POST(request('owner'))).status).toBe(200)
  const english = await POST(request('owner', { ...body, targetLanguage: 'en' }))
  expect(english.status).toBe(200)
  expect(mocks.invoke).toHaveBeenCalledTimes(2)
  expect(mocks.invoke.mock.calls.map((call) => call[1].target)).toEqual(['zh-CN', 'en'])
  expect(mocks.invoke.mock.calls[1]![1].prompt).toContain('into English.')
  expect((await POST(request('owner'))).status).toBe(200)
  expect((await POST(request('owner', { ...body, targetLanguage: 'en' }))).status).toBe(200)
  expect(mocks.invoke).toHaveBeenCalledTimes(2)
  expect((await POST(request('owner', { ...body, targetLanguage: 'fr' }))).status).toBe(400)
  expect(
    (
      await GET(
        new NextRequest(
          `http://localhost/api/translations/body?project=project-a&kind=wiki&id=W0001&targetLanguage=fr&revision=${manifest.revision}`,
          { headers: { 'x-memon-role': 'owner' } },
        ),
      )
    ).status,
  ).toBe(400)
  expect(mocks.invoke).toHaveBeenCalledTimes(2)
})

it('serves matching manifests and rechecks revision before returning paid results', async () => {
  const response = await GET(
    new NextRequest(
      `http://localhost/api/translations/body?project=project-a&kind=wiki&id=W0001&revision=${manifest.revision}`,
      { headers: { 'x-memon-role': 'owner' } },
    ),
  )
  expect(response.status).toBe(200)
  expect((await response.json()).segments[0].tokens).toBeUndefined()
  const success = await POST(request('owner'))
  expect(success.status).toBe(200)
  expect((await success.json()).results[0].text).toBe('你好世界')
  expect(success.headers.get('cache-control')).toBe('no-store')
  mocks.document
    .mockResolvedValueOnce({ content: 'Hello world' })
    .mockResolvedValueOnce({ content: 'Changed text' })
  expect((await POST(request('owner'))).status).toBe(409)
  expect(mocks.invoke).toHaveBeenCalledTimes(1)
})

it('returns exact cached results with the manifest without calling Codex', async () => {
  const document = { project: 'project-a', kind: 'wiki' as const, id: 'W0001' }
  const segment = manifest.segments[0]!
  const cached = { id: segment.id, sourceHash: segment.sourceHash, text: '你好世界' }
  mocks.cache.set(
    JSON.stringify([
      translationCacheKey(document, manifest.revision, 'zh-CN'),
      segment.id,
      segment.sourceHash,
    ]),
    cached,
  )
  const response = await GET(
    new NextRequest(
      `http://localhost/api/translations/body?project=project-a&kind=wiki&id=W0001&revision=${manifest.revision}`,
      { headers: { 'x-memon-role': 'owner' } },
    ),
  )
  expect(response.status).toBe(200)
  expect((await response.json()).cachedResults).toEqual([cached])
  expect(mocks.invoke).not.toHaveBeenCalled()
})
