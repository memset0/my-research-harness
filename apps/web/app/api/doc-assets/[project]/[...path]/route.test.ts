// @vitest-environment node

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../lib/runtime', () => ({ getRuntime: vi.fn() }))

import { getRuntime } from '../../../../../lib/runtime'
import { GET, HEAD } from './route'

let root: string
let other: string
const CACHE = 'docs/wiki/note/W0004-x__assets/fid.json'

beforeAll(async () => {
  root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'memon-doc-assets-')))
  other = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'memon-doc-assets-other-')))
  await fs.mkdir(join(root, 'docs/wiki/note/W0004-x__assets'), { recursive: true })
  await fs.writeFile(join(root, CACHE), '{"__component_id": "fid"}\n', 'utf8')
  await fs.writeFile(join(root, 'docs/wiki/note/diagram.svg'), '<svg/>', 'utf8')
  await fs.writeFile(join(root, 'docs/wiki/note/W0004-x__assets/rollout.mp4'), Buffer.alloc(4096, 7))
  await fs.writeFile(join(root, 'config.yml'), 'secret: true\n', 'utf8')
  await fs.writeFile(join(other, 'elsewhere.json'), '{"secret": true}', 'utf8')
  await fs.symlink(join(other, 'elsewhere.json'), join(root, 'docs/wiki/note/leak.json'))
  vi.mocked(getRuntime).mockResolvedValue({
    config: {
      projects: [
        { name: 'project-a', root, include: [], exclude: [] },
        { name: 'project-b', root: other, include: [], exclude: [] },
      ],
    },
  } as never)
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(other, { recursive: true, force: true })
})

function get(path: string, project = 'project-a', headers?: HeadersInit) {
  const segments = path.split('/')
  const url = `http://localhost/api/doc-assets/${project}/${path}`
  return GET(new NextRequest(url, { ...(headers ? { headers } : {}) }), {
    params: Promise.resolve({ project, path: segments }),
  })
}

describe('GET|HEAD document assets', () => {
  it('serves a cache file as uncacheable JSON with validators and HEAD', async () => {
    const response = await get(CACHE)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('etag')).toMatch(/^W\/"[a-f0-9]{40}"$/)
    expect(response.headers.get('last-modified')).toBeTruthy()
    expect(await response.text()).toBe('{"__component_id": "fid"}\n')

    const cached = await get(CACHE, 'project-a', {
      'if-none-match': response.headers.get('etag') as string,
    })
    expect(cached.status).toBe(304)

    const head = await HEAD(
      new NextRequest(`http://localhost/api/doc-assets/project-a/${CACHE}`, { method: 'HEAD' }),
      { params: Promise.resolve({ project: 'project-a', path: CACHE.split('/') }) },
    )
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    expect(head.headers.get('content-length')).toBe('26')
  })

  it('serves a document-relative SVG with a restrictive CSP', async () => {
    const response = await get('docs/wiki/note/diagram.svg')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/svg+xml')
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    )
    expect(await response.text()).toBe('<svg/>')
  })

  it('refuses traversal, encoded separators, and NUL before reading the file', async () => {
    for (const path of [
      'docs/wiki/note/W0004-x/../../../../config.yml',
      '%2e%2e/config.yml',
      'docs%2fwiki%2fnote%2fdiagram.svg',
      'docs/wiki/note/diagram.svg%00.png',
      '..',
      './config.yml',
    ]) {
      const response = await get(path)
      expect(response.status, path).toBe(400)
      expect((await response.json()).error.code).toBe('BAD_REQUEST')
    }
  })

  it('refuses a symlink that leaves the addressed project root', async () => {
    const response = await get('docs/wiki/note/leak.json')
    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('escapes the project root')
  })

  it('404s a missing file, an unserved type, and an unknown project', async () => {
    expect((await get('docs/wiki/note/W0004-x__assets/absent.json')).status).toBe(404)
    expect((await get('config.yml')).status).toBe(404)
    expect((await get(CACHE, 'project-z')).status).toBe(404)
  })

  it('serves byte ranges', async () => {
    const partial = await get(CACHE, 'project-a', { range: 'bytes=0-3' })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 0-3/26')
    expect(await partial.text()).toBe('{"__')
  })

  it('serves a figure video as video/mp4 with byte ranges for metadata reads', async () => {
    const partial = await get('docs/wiki/note/W0004-x__assets/rollout.mp4', 'project-a', { range: 'bytes=0-1023' })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-type')).toBe('video/mp4')
    expect(partial.headers.get('content-range')).toBe('bytes 0-1023/4096')
    expect((await partial.arrayBuffer()).byteLength).toBe(1024)
  })
})
