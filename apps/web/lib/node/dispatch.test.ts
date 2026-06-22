// @vitest-environment node
//
// Proves the headless dispatch path: resolve -> import the real route module ->
// call the handler -> serialize. Runs against the repo's mock fixtures (same
// setup as test/integration/read-flow.test.ts).

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Point the runtime at the repo config.yml (lists ./mock/project-{a,b}) BEFORE
// dispatchRpc triggers the first getRuntime().
const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
process.env.MEMON_CONFIG_PATH = join(REPO_ROOT, 'config.yml')

const { dispatchRpc } = await import('./dispatch')

describe('dispatchRpc', () => {
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
