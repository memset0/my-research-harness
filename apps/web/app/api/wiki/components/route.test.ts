// @vitest-environment node

import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { GET as getComponent } from './[name]/route'
import { POST as lint } from './lint/route'
import { POST as migrate } from './migrate/route'
import { GET as listRoute } from './route'

function post(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3737/api/wiki/components/${path}`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const RAGGED = [
  '```memon-data@1',
  'script: x',
  'captured_at: 2026-05-04T13:00:00+08:00',
  'captured_commit: null',
  'columns: [a, b]',
  'rows: [[1]]',
  '```',
].join('\n')

describe('GET /api/wiki/components', () => {
  it('serves a JSON-safe descriptor for every registered version', async () => {
    const payload = await (await listRoute()).json()
    expect(payload.components.map((entry: { pinned: string }) => entry.pinned).sort()).toEqual([
      'checklist@1',
      'figure@1',
      'html-embed@1',
      'memon-data@1',
    ])
    for (const entry of payload.components) {
      expect(entry.args.length).toBeGreaterThan(0)
      expect(entry.example).toContain('```')
      expect(entry.invalidExamples.length).toBeGreaterThan(0)
    }
  })
})

describe('GET /api/wiki/components/[name]', () => {
  it('resolves an unpinned and a pinned reference to the same descriptor', async () => {
    for (const name of ['memon-data', 'memon-data@1']) {
      const response = await getComponent(new Request('http://localhost:3737/'), {
        params: Promise.resolve({ name }),
      })
      expect(response.status, name).toBe(200)
      expect((await response.json()).pinned, name).toBe('memon-data@1')
    }
  })

  it('404s an unknown component and names what is registered', async () => {
    const response = await getComponent(new Request('http://localhost:3737/'), {
      params: Promise.resolve({ name: 'vega-lite@1' }),
    })
    expect(response.status).toBe(404)
    const payload = await response.json()
    expect(payload.error.code).toBe('NOT_FOUND')
    expect(payload.error.message).toContain('memon-data@1')
  })
})

describe('POST /api/wiki/components/lint', () => {
  it('reports payload diagnostics with their block line and the resolved blocks', async () => {
    const response = await lint(post('lint', { content: `# Page\n\n${RAGGED}\n` }))
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.diagnostics).toEqual([
      {
        code: 'WIKI_DATA_BLOCK_INVALID',
        severity: 'error',
        message: expect.stringContaining('memon-data@1 block 0 field `rows`'),
        line: 3,
      },
    ])
    expect(payload.components).toEqual([
      { index: 0, name: 'memon-data', version: 1, line: 3, outdated: false },
    ])
  })

  it('checks a `data` reference only when the caller sends the bundle listing', async () => {
    const content = [
      '```memon-data@1',
      'script: x',
      'captured_at: 2026-05-04T13:00:00+08:00',
      'captured_commit: null',
      'data: ./data/fid.csv',
      '```',
    ].join('\n')
    expect((await (await lint(post('lint', { content }))).json()).diagnostics).toEqual([])
    const probed = await (await lint(post('lint', { content, files: ['data/other.csv'] }))).json()
    expect(probed.diagnostics[0].code).toBe('WIKI_DATA_BLOCK_INVALID')
    expect(probed.diagnostics[0].message).toContain('`data/fid.csv` does not exist')
  })

  it('rejects a malformed body', async () => {
    expect((await lint(post('lint', 'not json'))).status).toBe(400)
    expect((await lint(post('lint', { body: 'x' }))).status).toBe(400)
  })
})

describe('POST /api/wiki/components/migrate', () => {
  it('pins an unpinned block and leaves the rest of the body byte-identical', async () => {
    const content = '# Page\n\n```html-embed height=240\n<div/>\n```\n\nAfter.\n'
    const payload = await (await migrate(post('migrate', { content }))).json()
    expect(payload.content).toBe('# Page\n\n```html-embed@1 height=240\n<div/>\n```\n\nAfter.\n')
  })

  it('returns an already-pinned body unchanged so the caller writes nothing', async () => {
    const content = '```html-embed@1\n<div/>\n```\n'
    const payload = await (await migrate(post('migrate', { content }))).json()
    expect(payload).toEqual({ content })
  })

  it('rejects a body without content', async () => {
    expect((await migrate(post('migrate', {}))).status).toBe(400)
  })
})
