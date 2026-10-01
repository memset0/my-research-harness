import { promises as fs } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActorContextSchema, type BackendCapabilities, projectFs } from '@memon/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import { __resetConditionalReadsForTests } from './conditional-read.js'
import { FilesystemDocumentService } from './document-service.js'
import { FilesystemProjectService } from './project-service.js'
import { dropProjectReadIndexes } from './read-index.js'
import { createBackendServer } from './server.js'

const TOKEN = 'c'.repeat(32)
const CAPABILITIES = {
  projects: true,
  mutations: false,
  events: false,
  logStreaming: false,
  reportAssets: false,
  wikiAssets: false,
  git: false,
  shares: false,
  slurm: false,
} satisfies BackendCapabilities

let root: string
let origin: string
let server: ReturnType<typeof createBackendServer>

const readme = (title: string) =>
  `---\nid: E0001-a\nslug: a\ntitle: ${title}\nstatus: OPEN\nruns: []\n---\n## Motivation\nx\n`

beforeEach(async () => {
  dropProjectReadIndexes()
  __resetConditionalReadsForTests()
  root = await fs.mkdtemp(join(tmpdir(), 'memon-conditional-'))
  await fs.mkdir(join(root, 'docs', 'experiments', 'E0001-a'), { recursive: true })
  await fs.writeFile(join(root, 'docs', 'experiments', 'E0001-a', 'README.md'), readme('First'))
  await fs.mkdir(join(root, 'docs', 'wiki', 'note'), { recursive: true })
  await fs.writeFile(
    join(root, 'docs', 'wiki', 'note', 'W0001-home.md'),
    '---\nid: W0001\nkind: note\ntitle: Home\n---\n# Home\n',
  )
  const projects = [{ name: 'p', root, include: [], exclude: [] }]
  server = createBackendServer({
    hostId: 'host-a',
    serviceTokens: { current: TOKEN },
    capabilities: CAPABILITIES,
    revision: 'r',
    projectService: new FilesystemProjectService(projects),
    documentService: new FilesystemDocumentService(projects),
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  vi.restoreAllMocks()
  await new Promise<void>((done) => server.close(() => done()))
  await fs.rm(root, { recursive: true, force: true })
})

function get(
  path: string,
  headers: Record<string, string> = {},
  role: 'owner' | 'viewer' = 'owner',
) {
  const actor =
    role === 'owner'
      ? ActorContextSchema.parse({ role })
      : ActorContextSchema.parse({ role, scopes: [{ host: 'host-a', project: 'other' }] })
  return fetch(`${origin}${path}`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      [BACKEND_ACTOR_CONTEXT_HEADER]: Buffer.from(JSON.stringify(actor)).toString('base64url'),
      ...headers,
    },
  })
}

describe('conditional list reads', () => {
  it('answers an unchanged list with 304 without reading any document', async () => {
    const first = await get('/api/backend/v1/experiments?project=p')
    expect(first.status).toBe(200)
    const etag = first.headers.get('etag')!
    expect(etag).toMatch(/^W\/"/)
    expect(first.headers.get('cache-control')).toBe('private, no-cache')

    const readFile = vi.spyOn(projectFs, 'readFile')
    const again = await get('/api/backend/v1/experiments?project=p', { 'if-none-match': etag })
    expect(again.status).toBe(304)
    expect(again.headers.get('etag')).toBe(etag)
    expect(await again.text()).toBe('')
    expect(readFile).not.toHaveBeenCalled()
  })

  it('answers 200 with a new validator when a source changed', async () => {
    const etag = (await get('/api/backend/v1/experiments?project=p')).headers.get('etag')!
    await fs.writeFile(join(root, 'docs', 'experiments', 'E0001-a', 'README.md'), readme('Second!'))
    const changed = await get('/api/backend/v1/experiments?project=p', { 'if-none-match': etag })
    expect(changed.status).toBe(200)
    expect(changed.headers.get('etag')).not.toBe(etag)
    expect(JSON.stringify(await changed.json())).toContain('Second!')
  })

  it('ignores unknown validators and validators of another route', async () => {
    const wiki = (await get('/api/backend/v1/wiki?project=p&inventory=1')).headers.get('etag')!
    expect(
      (await get('/api/backend/v1/wiki?project=p&inventory=1', { 'if-none-match': wiki })).status,
    ).toBe(304)
    for (const validator of ['W/"unknown"', wiki]) {
      const response = await get('/api/backend/v1/experiments?project=p', {
        'if-none-match': validator,
      })
      expect(response.status).toBe(200)
    }
  })

  it('authorizes before the conditional check', async () => {
    const etag = (await get('/api/backend/v1/experiments?project=p')).headers.get('etag')!
    const viewer = await get(
      '/api/backend/v1/experiments?project=p',
      { 'if-none-match': etag },
      'viewer',
    )
    expect(viewer.status).toBe(403)
  })

  it('makes the Journal count and hypotheses conditional', async () => {
    for (const path of [
      '/api/backend/v1/journal?project=p&countOnly=1',
      '/api/backend/v1/hypotheses?project=p',
      '/api/backend/v1/anomalies?project=p',
      '/api/backend/v1/wiki?project=p',
    ]) {
      const etag = (await get(path)).headers.get('etag')
      expect(etag, path).toBeTruthy()
      expect((await get(path, { 'if-none-match': etag! })).status, path).toBe(304)
    }
  })
})
