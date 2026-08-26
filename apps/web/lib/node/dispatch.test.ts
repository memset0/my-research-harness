// @vitest-environment node
//
// Proves the headless dispatch path: resolve -> import the real route module ->
// call the handler -> serialize. Runs against the repo's mock fixtures (same
// setup as test/integration/read-flow.test.ts).

import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

// Use the committed, fully initialised test instance config rather than a
// developer's gitignored repo-root config.yml.
process.env.MEMON_CONFIG_PATH = join(
  __dirname,
  '..',
  '..',
  'test',
  'fixtures',
  'runtime-config.yml',
)

const { dispatchRpc } = await import('./dispatch')

describe('dispatchRpc', () => {
  // Warm the runtime once (it discovers the mock fixtures — slow, and slower
  // still under full-suite CPU contention) so the per-test timeout covers only
  // the dispatch call, not the cold warmup.
  beforeAll(async () => {
    await dispatchRpc({ kind: 'req', id: 0, method: 'GET', path: '/api/projects' })
  }, 30_000)

  it('runs GET /api/projects through the real handler', async () => {
    const res = await dispatchRpc({ kind: 'req', id: 1, method: 'GET', path: '/api/projects' })
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body.projects)).toBe(true)
  })

  it('threads query params (GET /api/runs?project=...)', async () => {
    const res = await dispatchRpc({
      kind: 'req',
      id: 2,
      method: 'GET',
      path: '/api/runs',
      query: { project: 'project-a' },
    })
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body.experiments)).toBe(true)
  })

  it('404s an unknown route', async () => {
    const res = await dispatchRpc({ kind: 'req', id: 3, method: 'GET', path: '/api/nope-xyz-123' })
    expect(res.status).toBe(404)
  })

  it('405s an unsupported method on a known route', async () => {
    const res = await dispatchRpc({ kind: 'req', id: 4, method: 'DELETE', path: '/api/projects' })
    expect(res.status).toBe(405)
  })
})
