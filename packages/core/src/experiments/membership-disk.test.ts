// `bounded-run-discovery` R3: PHANTOM_RUN_REF for project-relative
// declarations is decided by the declared path on disk, not by the walk.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverRuns } from '../discovery/discover.js'
import { readRunDir } from '../discovery/read.js'
import type { Experiment, Run } from '../types.js'
import { discoverExperiments } from './discover.js'
import { computeMembership, computeMembershipFromDisk, resolveDeclaredRuns } from './membership.js'

let root: string

const RUN_README = (id: string) =>
  `---\nid: ${id}\nname: x\nstatus: FINISHED\ncreated_at: '2026-09-01T09:00:00+08:00'\nupdated_at: '2026-09-01T09:00:00+08:00'\n---\n`

async function run(path: string, readme = true) {
  await fs.mkdir(join(root, path), { recursive: true })
  if (readme) await fs.writeFile(join(root, path, 'README.md'), RUN_README(path.split('/').pop()!))
}

async function experiment(id: string, runs: string[]) {
  await fs.mkdir(join(root, 'docs/experiments', id), { recursive: true })
  await fs.writeFile(
    join(root, 'docs/experiments', id, 'README.md'),
    `---\nid: ${id}\nslug: ${id.slice(6)}\nruns: [${runs.join(', ')}]\n---\n`,
  )
}

async function load(exclude: string[] = []): Promise<{ experiments: Experiment[]; runs: Run[] }> {
  const project = { name: 'p', root, include: [], exclude }
  const runs = await Promise.all((await discoverRuns(project)).map((dir) => readRunDir(dir, 'p')))
  const { experiments } = await discoverExperiments(root, 'p')
  return { experiments, runs }
}

const phantoms = (anomalies: { code: string; runId: string | null }[]) =>
  anomalies.filter((a) => a.code === 'PHANTOM_RUN_REF').map((a) => a.runId)

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-membership-disk-'))
  await run('logs/sweep-260901-090000')
  await run('outputs/old/sweep-260901-100000')
  await run('logs/sweep-260901-110000', false)
  await experiment('E0001-sweep', [
    'logs/sweep-260901-090000',
    'outputs/old/sweep-260901-100000',
    'logs/sweep-260901-110000',
    'logs/sweep-260901-120000',
  ])
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('direct-path PHANTOM_RUN_REF classification', () => {
  it('ignores walk pruning: excluded but existing paths are members, missing ones are phantoms', async () => {
    const { experiments, runs } = await load(['outputs'])
    // The old walk-based rule reports the excluded path as a phantom.
    const before = computeMembership({ experiments, runs, project: 'p', projectRoot: root })
    expect(phantoms(before.anomalies)).toContain('outputs/old/sweep-260901-100000')

    const after = await computeMembershipFromDisk({
      experiments,
      runs,
      project: 'p',
      projectRoot: root,
    })
    expect(phantoms(after.anomalies)).toEqual(['logs/sweep-260901-120000'])
    expect(after.confirmedMembers.get('E0001-sweep')).toEqual([
      'logs/sweep-260901-090000',
      'outputs/old/sweep-260901-100000',
      'logs/sweep-260901-110000',
    ])
  })

  it('keeps a README-less declared directory as a member with hasReadme false', async () => {
    const { experiments } = await load()
    const declared = await resolveDeclaredRuns({ projectRoot: root, project: 'p', experiments })
    expect(declared.get('logs/sweep-260901-110000')?.hasReadme).toBe(false)
    expect(declared.get('outputs/old/sweep-260901-100000')?.hasReadme).toBe(true)
    expect(declared.get('logs/sweep-260901-120000')).toBeNull()
  })

  it('treats a path escaping the project as a phantom', async () => {
    const outside = await fs.mkdtemp(join(tmpdir(), 'memon-outside-'))
    try {
      await fs.symlink(outside, join(root, 'logs/link-260901-090000'))
      const { experiments } = await load()
      const target = { ...experiments[0]!, frontMatter: { ...experiments[0]!.frontMatter } }
      target.frontMatter.runs = ['logs/link-260901-090000']
      const declared = await resolveDeclaredRuns({
        projectRoot: root,
        project: 'p',
        experiments: [target],
      })
      expect(declared.get('logs/link-260901-090000')).toBeNull()
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('reuses loaded Run records and treats a vanished indexed path as a phantom', async () => {
    const { experiments, runs } = await load()
    const declared = await resolveDeclaredRuns({
      projectRoot: root,
      project: 'p',
      experiments,
      runs,
    })
    expect(declared.get('logs/sweep-260901-090000')).toBe(
      runs.find((r) => r.id === 'sweep-260901-090000'),
    )
    await fs.rm(join(root, 'logs/sweep-260901-090000'), { recursive: true })
    const after = await computeMembershipFromDisk({
      experiments,
      runs,
      project: 'p',
      projectRoot: root,
    })
    expect(phantoms(after.anomalies)).toContain('logs/sweep-260901-090000')
  })

  it('still resolves legacy base-name references through the loaded Runs', async () => {
    await experiment('E0002-sweep-legacy', ['sweep-260901-090000', 'gone-260901-090000'])
    const { experiments, runs } = await load()
    const result = await computeMembershipFromDisk({
      experiments,
      runs,
      project: 'p',
      projectRoot: root,
    })
    const legacy = result.anomalies.filter((a) => a.experimentId === 'E0002-sweep-legacy')
    expect(phantoms(legacy)).toEqual(['gone-260901-090000'])
  })
})
