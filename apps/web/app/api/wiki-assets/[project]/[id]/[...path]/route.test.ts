// @vitest-environment node

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../../lib/runtime', () => ({ getRuntime: vi.fn() }))

import { getRuntime } from '../../../../../../lib/runtime'
import { GET, HEAD } from './route'

let root: string
let bundle: string

beforeAll(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-wiki-assets-route-'))
  bundle = join(root, 'docs', 'wiki', 'showcase', 'W0006-explorer')
  await fs.mkdir(join(bundle, 'views'), { recursive: true })
  await fs.mkdir(join(bundle, 'data'), { recursive: true })
  await fs.writeFile(join(bundle, 'README.md'), '# Explorer\n', 'utf8')
  await fs.writeFile(join(bundle, 'views', 'index.html'), '<h1>Explorer</h1>', 'utf8')
  await fs.writeFile(join(bundle, 'data', 'metrics.json'), '{"fid": 41.2}', 'utf8')
  await fs.writeFile(join(root, 'outside.json'), '{"secret": true}', 'utf8')
  await fs.symlink(join(root, 'outside.json'), join(bundle, 'leak.json'))
  vi.mocked(getRuntime).mockResolvedValue({
    config: {
      projects: [{ name: 'project-a', root, include: [], exclude: [] }],
      slurm: { totalNodes: -1 },
    },
  } as never)
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function request(path: string[], headers?: HeadersInit) {
  const url = `http://localhost/api/wiki-assets/project-a/W0006/${path.join('/')}`
  return GET(new NextRequest(url, { headers }), {
    params: Promise.resolve({ project: 'project-a', id: 'W0006', path }),
  })
}

function headRequest(path: string[]) {
  const url = `http://localhost/api/wiki-assets/project-a/W0006/${path.join('/')}`
  return HEAD(new NextRequest(url, { method: 'HEAD' }), {
    params: Promise.resolve({ project: 'project-a', id: 'W0006', path }),
  })
}

describe('GET|HEAD wiki bundle assets', () => {
  it('serves a shared SVG with CSP, validators, HEAD and range support', async () => {
    await fs.mkdir(join(root, 'docs/wiki/assets'), { recursive: true })
    await fs.writeFile(join(root, 'docs/wiki/assets/pipeline-overview.svg'), '<svg/>')
    const url = 'http://localhost/api/wiki-assets/project-a/shared/pipeline-overview.svg'
    const context = { params: Promise.resolve({ project: 'project-a', id: 'shared', path: ['pipeline-overview.svg'] }) }
    const response = await GET(new NextRequest(url), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/svg+xml')
    expect(response.headers.get('content-security-policy')).toContain("sandbox; default-src 'none'")
    expect(await response.text()).toBe('<svg/>')
    expect((await HEAD(new NextRequest(url, { method: 'HEAD' }), context)).status).toBe(200)
    const partial = await GET(new NextRequest(url, { headers: { range: 'bytes=0-3' } }), context)
    expect(partial.status).toBe(206)
    expect(await partial.text()).toBe('<svg')
    const cached = await GET(new NextRequest(url, { headers: { 'if-none-match': response.headers.get('etag')! } }), context)
    expect(cached.status).toBe(304)
  })
  it('serves nested assets with validators and byte ranges', async () => {
    const html = await request(['views', 'index.html'])
    expect(html.status).toBe(200)
    expect(html.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(html.headers.get('etag')).toMatch(/^W\/"[a-f0-9]{40}"$/)
    expect(await html.text()).toBe('<h1>Explorer</h1>')

    const partial = await request(['data', 'metrics.json'], { range: 'bytes=0-4' })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 0-4/13')
    expect(await partial.text()).toBe('{"fid')

    const head = await headRequest(['data', 'metrics.json'])
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    expect(head.headers.get('content-length')).toBe('13')
  })

  it('rejects traversal, escaping symlinks, README, and malformed ids', async () => {
    expect((await request(['%2e%2e', 'outside.json'])).status).toBe(400)
    expect((await request(['leak.json'])).status).toBe(403)
    expect((await request(['README.md'])).status).toBe(404)

    const invalid = await GET(
      new NextRequest('http://localhost/api/wiki-assets/project-a/R0006/views/index.html'),
      {
        params: Promise.resolve({
          project: 'project-a',
          id: 'R0006',
          path: ['views', 'index.html'],
        }),
      },
    )
    expect(invalid.status).toBe(403)
  })
})
