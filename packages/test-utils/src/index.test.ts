import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  actorHeader,
  commitAll,
  createBackendRequest,
  createTempProject,
  ExitCalled,
  git,
  initGitRepo,
  makeTempDir,
  paramsFor,
  removeTempDirs,
  spyExit,
  startBackend,
  useFixedClock,
} from './index.js'

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  )

afterEach(async () => {
  await removeTempDirs()
})

describe('temp fixtures', () => {
  it('writes runs, experiments, wiki pages and files, then removes them', async () => {
    const project = await createTempProject({
      runs: { 'runs/a-260101-000000': '---\nstatus: FINISHED\n---\n' },
      experiments: { 'E0001-a': { 'README.md': '# A\n', 'results.yaml': 'schema_version: 1\n' } },
      wiki: { 'finding/W0001-a.md': '---\nid: W0001\n---\n' },
      files: { 'docs/hypotheses.md': '# H\n' },
    })
    expect(await readFile(project.path('runs/a-260101-000000/README.md'), 'utf8')).toContain(
      'FINISHED',
    )
    expect(await exists(project.path('docs/experiments/E0001-a/results.yaml'))).toBe(true)
    expect(await exists(project.path('docs/wiki/finding/W0001-a.md'))).toBe(true)
    expect(await exists(project.path('docs/hypotheses.md'))).toBe(true)
    const other = await makeTempDir()
    await removeTempDirs()
    expect(await exists(project.root)).toBe(false)
    expect(await exists(other)).toBe(false)
  })
})

describe('useFixedClock', () => {
  it('freezes Date and restores it', () => {
    const restore = useFixedClock('2026-05-03T08:28:00+08:00')
    expect(new Date().toISOString()).toBe('2026-05-03T00:28:00.000Z')
    restore()
    expect(Date.now()).toBeGreaterThan(Date.parse('2026-05-03T00:28:01Z'))
  })
})

describe('http helpers', () => {
  it('encodes actors and sends token, actor and JSON body', async () => {
    const seen: Array<{ auth?: string; actor?: string; type?: string; body: string }> = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        seen.push({
          auth: req.headers.authorization,
          actor: req.headers['x-actor'] as string | undefined,
          type: req.headers['content-type'],
          body,
        })
        res.end('ok')
      })
    })
    const registry = new Set<typeof server>()
    const origin = await startBackend(server, registry)
    expect(registry.has(server)).toBe(true)
    const request = createBackendRequest({
      origin: () => origin,
      token: 't',
      actorHeaderName: 'x-actor',
    })
    await request('/a', { actor: { role: 'owner' }, method: 'POST', body: { x: 1 } })
    await request('/b', { service: false })
    server.close()
    expect(seen[0]).toEqual({
      auth: 'Bearer t',
      actor: actorHeader({ role: 'owner' }),
      type: 'application/json',
      body: '{"x":1}',
    })
    expect(seen[1]?.auth).toBeUndefined()
    expect(JSON.parse(Buffer.from(actorHeader({ a: 1 }), 'base64url').toString())).toEqual({ a: 1 })
  })

  it('builds Next route params', async () => {
    expect(await paramsFor('p').params).toEqual({ project: 'p' })
    expect(await paramsFor('p', { sha: 'abc' }).params).toEqual({ project: 'p', sha: 'abc' })
  })
})

describe('spyExit', () => {
  it('throws ExitCalled with the code and restores process.exit', () => {
    const real = process.exit
    const spy = spyExit()
    expect(() => process.exit(3)).toThrow(ExitCalled)
    expect(spy.code).toBe(3)
    spy.restore()
    expect(process.exit).toBe(real)
  })
})

describe('git fixture', () => {
  it('initialises a repository and commits', async () => {
    const dir = await makeTempDir()
    await initGitRepo(dir)
    const sha = await commitAll(dir, 'first')
    expect(sha).toMatch(/^[0-9a-f]{40}$/)
    expect(await git(dir, 'branch', '--show-current')).toBe('main')
    expect(await git(dir, 'log', '--format=%s')).toBe('first')
  })
})
