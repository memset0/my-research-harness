// @vitest-environment node

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../../lib/runtime', () => ({ getRuntime: vi.fn() }))

import { getRuntime } from '../../../../../../lib/runtime'
import { GET } from './route'

let root: string
let reportsDir: string

beforeAll(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-report-assets-route-'))
  reportsDir = join(root, 'docs', 'reports')
  const bundle = join(reportsDir, 'R0002-rich')
  await fs.mkdir(join(bundle, 'data'), { recursive: true })
  await fs.writeFile(join(bundle, 'README.md'), '# Rich report\n', 'utf8')
  await fs.writeFile(
    join(bundle, 'chart.html'),
    '<script type="module">fetch("./data/metrics.json")</script>',
    'utf8',
  )
  await fs.writeFile(join(bundle, 'data', 'metrics.json'), '{"loss": 1}', 'utf8')
  await fs.writeFile(join(root, 'outside.json'), '{"secret": true}', 'utf8')
  await fs.symlink(join(root, 'outside.json'), join(bundle, 'leak.json'))
  vi.mocked(getRuntime).mockResolvedValue({
    reportsDir: (project: string) => (project === 'research' ? reportsDir : null),
  } as never)
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function request(path: string[]) {
  const url = `http://localhost/api/report-assets/research/R0002/${path.join('/')}`
  return GET(new NextRequest(url), {
    params: Promise.resolve({ project: 'research', id: 'R0002', path }),
  })
}

describe('GET directory Report assets', () => {
  it('serves full-permission HTML and lets its relative JSON URL hit the same route', async () => {
    const html = await request(['chart.html'])
    expect(html.status).toBe(200)
    expect(html.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(html.headers.get('content-security-policy')).toBeNull()
    expect(await html.text()).toContain('fetch("./data/metrics.json")')

    const relative = new URL(
      './data/metrics.json',
      'http://localhost/api/report-assets/research/R0002/chart.html',
    )
    expect(relative.pathname).toBe('/api/report-assets/research/R0002/data/metrics.json')
    const json = await request(['data', 'metrics.json'])
    expect(json.status).toBe(200)
    expect(json.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(await json.json()).toEqual({ loss: 1 })
  })

  it('rejects encoded traversal, escaping symlinks, directory roots, and README-as-asset', async () => {
    expect((await request(['%2e%2e', 'outside.json'])).status).toBe(400)
    expect((await request(['leak.json'])).status).toBe(403)
    expect((await request([])).status).toBe(400)
    expect((await request(['README.md'])).status).toBe(404)
  })
})
