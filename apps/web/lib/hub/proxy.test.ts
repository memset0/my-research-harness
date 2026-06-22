import { describe, expect, it } from 'vitest'
import { makeSocketPair } from '../hub-node/connection'
import type { NodeHello } from '../hub-node/protocol'
import { NodeLink } from '../node/node-link'
import {
  forwardRequest,
  isForwardable,
  isHubLocal,
  projectFromRequest,
} from './proxy'
import { NodeRegistry } from './registry'

async function attachNode(
  reg: NodeRegistry,
  name: string,
  projects: string[],
  dispatch: (req: { path: string; query?: Record<string, string>; method: string }) => Promise<{
    status: number
    body: string
  }>,
) {
  const [hubSock, nodeSock] = makeSocketPair()
  const hello: NodeHello = { kind: 'hello', name, capabilities: { tmux: true, projects: true }, projects }
  // eslint-disable-next-line no-new
  new NodeLink(nodeSock, { hello, dispatch: async (req) => dispatch(req) })
  return reg.attach(hubSock)
}

describe('hub proxy routing', () => {
  it('classifies hub-local vs forwardable paths', () => {
    expect(isHubLocal('/api/auth/login')).toBe(true)
    expect(isHubLocal('/api/events')).toBe(true)
    expect(isHubLocal('/api/terminal/proxy/x')).toBe(true)
    expect(isForwardable('/api/runs')).toBe(true)
    expect(isForwardable('/api/auth/login')).toBe(false)
    expect(isForwardable('/p/project-a')).toBe(false)
  })

  it('extracts the project from query or path', () => {
    expect(projectFromRequest('/api/runs', { project: 'a' })).toBe('a')
    expect(projectFromRequest('/api/projects/proj-b/git-status')).toBe('proj-b')
    expect(projectFromRequest('/api/runs/some-id')).toBeNull()
  })

  it('routes a project-scoped request to the owning node', async () => {
    const reg = new NodeRegistry()
    await attachNode(reg, 'm2', ['project-a'], async (req) => ({ status: 200, body: JSON.stringify({ node: 'm2', path: req.path }) }))
    await attachNode(reg, 'nvl72', ['project-b'], async (req) => ({ status: 200, body: JSON.stringify({ node: 'nvl72', path: req.path }) }))
    const res = await forwardRequest(reg, { method: 'GET', path: '/api/runs', query: { project: 'project-b' } })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body).node).toBe('nvl72')
  })

  it('fans out + merges /api/projects, tagging each by node', async () => {
    const reg = new NodeRegistry()
    await attachNode(reg, 'm2', ['project-a'], async () => ({ status: 200, body: JSON.stringify({ projects: [{ name: 'project-a' }] }) }))
    await attachNode(reg, 'nvl72', ['project-b'], async () => ({ status: 200, body: JSON.stringify({ projects: [{ name: 'project-b' }] }) }))
    const res = await forwardRequest(reg, { method: 'GET', path: '/api/projects' })
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body) as { projects: Array<{ name: string; node: string }> }
    expect(body.projects).toHaveLength(2)
    expect(body.projects.map((p) => `${p.node}:${p.name}`).sort()).toEqual(['m2:project-a', 'nvl72:project-b'])
  })

  it('503s when no connected node serves the project', async () => {
    const reg = new NodeRegistry()
    await attachNode(reg, 'm2', ['project-a'], async () => ({ status: 200, body: '{}' }))
    const res = await forwardRequest(reg, { method: 'GET', path: '/api/runs', query: { project: 'nope' } })
    expect(res.status).toBe(503)
  })

  it('a single node handles an id-only route (no project scope)', async () => {
    const reg = new NodeRegistry()
    await attachNode(reg, 'm2', ['project-a'], async (req) => ({ status: 200, body: JSON.stringify({ path: req.path }) }))
    const res = await forwardRequest(reg, { method: 'GET', path: '/api/runs/some-id' })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body).path).toBe('/api/runs/some-id')
  })
})
