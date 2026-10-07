// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Config, DEFAULT_GIT_STATUS, DEFAULT_SLURM } from '@memon/core'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../lib/server/runtime', () => ({ getRuntime: vi.fn() }))

import { getRuntime } from '../../../../lib/server/runtime'
import { GET, PUT } from './route'

const content = `---\nid: W0001\nkind: finding\ntitle: Finding\ncreated_at: 2026-05-01T10:00:00+08:00\nupdated_at: 2026-05-01T10:00:00+08:00\n---\n\n\`\`\`yaml datatable@1 #metrics\ncolumns: [step, loss]\ndata: [[1]]\n\`\`\`\n`
let filename: string
beforeEach(async () => {
  const { root } = await createTempProject({
    files: { 'docs/wiki/finding/W0001-finding.md': content },
  })
  filename = join(root, 'docs/wiki/finding/W0001-finding.md')
  const config: Config = {
    projects: [{ name: 'project-a', root, storage: 'local', include: [], exclude: [] }],
    poll: { minIntervalMs: 1000, maxIntervalMs: 300_000, backoffFactor: 2 },
    slurm: { ...DEFAULT_SLURM },
    gitStatus: { ...DEFAULT_GIT_STATUS },
  }
  vi.mocked(getRuntime).mockResolvedValue({ config } as never)
})
afterEach(removeTempDirs)
const request = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/wiki/W0001?project=project-a', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const context = (id = 'W0001') => ({ params: Promise.resolve({ id }) })
const lock = async () => ({
  expectedMtime: (await stat(filename)).mtimeMs,
  expectedHash: createHash('sha1')
    .update(await readFile(filename))
    .digest('hex'),
})

describe('Wiki routes over shared document primitives', () => {
  it('projects registry components and their diagnostics', async () => {
    const response = await GET(request('GET'), context())
    expect(response.status).toBe(200)
    const page = await response.json()
    expect(page.path).toBe('docs/wiki/finding/W0001-finding.md')
    expect(page.components).toContainEqual(
      expect.objectContaining({ type: 'datatable', version: 1, id: 'metrics' }),
    )
    expect(page.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'WIKI_COMPONENT_INVALID' }),
    )
  })
  it('keeps invalid component diagnostics without resolving an unknown version', async () => {
    await writeFile(filename, content.replace('datatable@1', 'datatable@999'))
    const response = await GET(request('GET'), context())
    const page = await response.json()
    expect(page.components).toEqual([])
    expect(page.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'WIKI_COMPONENT_INVALID' }),
    )
  })
  it('rejects malformed and missing identities', async () => {
    expect((await GET(request('GET'), context('R0001'))).status).toBe(400)
    expect((await GET(request('GET'), context('W9999'))).status).toBe(404)
  })
  it('rejects an identity change and preserves source bytes', async () => {
    const response = await PUT(
      request('PUT', { content: content.replace('id: W0001', 'id: W0002'), ...(await lock()) }),
      context(),
    )
    expect(response.status).toBe(400)
    expect(await readFile(filename, 'utf8')).toBe(content)
  })
  it('returns a real conflict, then re-baselines a successful write and records it', async () => {
    const previous = await lock()
    await writeFile(filename, content + '\nExternal edit\n')
    expect((await PUT(request('PUT', { content, ...previous }), context())).status).toBe(409)
    const response = await PUT(
      request('PUT', { content: content + '\nUpdated\n', ...(await lock()) }),
      context(),
    )
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.page.id).toBe('W0001')
    expect(result.finalContent).toBe(await readFile(filename, 'utf8'))
    expect(result.hash).toBe(createHash('sha1').update(result.finalContent).digest('hex'))
  })
})
