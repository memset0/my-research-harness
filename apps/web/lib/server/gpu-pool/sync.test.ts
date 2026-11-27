// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PULL_SCRIPT, PUSH_SCRIPT, parsePull, parsePush } from './sync'

const TICKET = 'tk_7h3q9m2xw4ra'
const OTHER = 'tk_0000000000zz'
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
}

let dir: string
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' }).trim()
const run = (script: string, ...args: string[]) => {
  const result = spawnSync('bash', ['-c', script, 'memon-test', ...args], {
    env: ENV,
    encoding: 'utf8',
  })
  return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
}
const runJson = (ticket: string | null) =>
  JSON.stringify({
    id: 'r',
    status: 'RUNNING',
    created_at: '2026-11-27T00:00:00+00:00',
    ...(ticket ? { resources: [{ ticket, cluster: 'cluster-a', node: 'node-01' }] } : {}),
  })

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'memon-sync-'))
  git(dir, 'init', '-q', '--bare', '-b', 'main', 'remote.git')
  git(dir, 'clone', '-q', 'remote.git', 'seed')
  const seed = join(dir, 'seed')
  await mkdir(join(seed, 'src'), { recursive: true })
  await writeFile(join(seed, 'src', 'model.py'), 'v1\n')
  await writeFile(join(seed, '.gitignore'), 'logs/**/raw/\n')
  git(seed, 'add', '.')
  git(seed, 'commit', '-q', '-m', 'init')
  git(seed, 'push', '-q', 'origin', 'HEAD:main')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('sync scripts against real Git', () => {
  it('clones a missing checkout, then pulls an existing one', async () => {
    const root = join(dir, 'cluster', 'project-a')
    const cloned = parsePull(run(PULL_SCRIPT, root, join(dir, 'remote.git')))
    expect(cloned.ok).toBe(true)
    expect(cloned.commit).toBe(git(root, 'rev-parse', 'HEAD'))

    await writeFile(join(dir, 'seed', 'src', 'model.py'), 'v2\n')
    git(join(dir, 'seed'), 'commit', '-q', '-am', 'v2')
    git(join(dir, 'seed'), 'push', '-q', 'origin', 'HEAD:main')
    const pulled = parsePull(run(PULL_SCRIPT, root, ''))
    expect(pulled.ok).toBe(true)
    expect(await readFile(join(root, 'src', 'model.py'), 'utf8')).toBe('v2\n')
  })

  it('reports a pull that conflicts with a local edit, and a missing root without origin', async () => {
    const root = join(dir, 'cluster', 'project-a')
    run(PULL_SCRIPT, root, join(dir, 'remote.git'))
    await writeFile(join(root, 'src', 'model.py'), 'local edit\n')
    await writeFile(join(dir, 'seed', 'src', 'model.py'), 'v2\n')
    git(join(dir, 'seed'), 'commit', '-q', '-am', 'v2')
    git(join(dir, 'seed'), 'push', '-q', 'origin', 'HEAD:main')
    const failed = parsePull(run(PULL_SCRIPT, root, ''))
    expect(failed.ok).toBe(false)
    expect(failed.output).toMatch(/model\.py/)

    const missing = parsePull(run(PULL_SCRIPT, join(dir, 'nowhere'), ''))
    expect(missing).toMatchObject({ ok: false, commit: null })
    expect(missing.output).toMatch(/origin is unknown/)
  })

  it('pushes only the Runs recording the ticket, leaving other changes local', async () => {
    const root = join(dir, 'cluster', 'project-a')
    run(PULL_SCRIPT, root, join(dir, 'remote.git'))
    const runDir = (name: string) => join(root, 'logs', 'E0001', 'V0001', name)
    for (const [name, ticket] of [
      ['r1', TICKET],
      ['r2', OTHER],
      ['r3', null],
    ] as const) {
      await mkdir(join(runDir(name), 'raw'), { recursive: true })
      await writeFile(join(runDir(name), 'run.json'), runJson(ticket))
      await writeFile(join(runDir(name), 'result.csv'), 'path,stat,value\n')
      await writeFile(join(runDir(name), 'raw', 'checkpoint.bin'), 'big')
    }
    await writeFile(join(root, 'src', 'model.py'), 'edited on the cluster\n')
    // A concurrent push from elsewhere forces the pull-and-retry path.
    await writeFile(join(dir, 'seed', 'notes.md'), 'elsewhere\n')
    git(join(dir, 'seed'), 'add', 'notes.md')
    git(join(dir, 'seed'), 'commit', '-q', '-m', 'elsewhere')
    git(join(dir, 'seed'), 'push', '-q', 'origin', 'HEAD:main')

    const pushed = parsePush(run(PUSH_SCRIPT, root, TICKET))
    expect(pushed.state).toBe('PUSHED')
    expect(pushed.unrecorded).toEqual(['logs/E0001/V0001/r3'])
    const files = git(
      join(dir, 'remote.git'),
      'show',
      '--name-only',
      '--format=',
      pushed.commit as string,
    )
    expect(files.split('\n').sort()).toEqual([
      'logs/E0001/V0001/r1/result.csv',
      'logs/E0001/V0001/r1/run.json',
    ])
    const status = git(root, 'status', '--porcelain', '-uall')
    expect(status).toContain('src/model.py')
    expect(status).toContain('logs/E0001/V0001/r2/run.json')
    expect(status).not.toContain('r1/')

    expect(parsePush(run(PUSH_SCRIPT, root, TICKET)).state).toBe('NOTHING_TO_PUSH')
  })
})
