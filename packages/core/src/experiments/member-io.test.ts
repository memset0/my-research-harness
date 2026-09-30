// Bounded member I/O (experiment-run-path-resolution): reading an
// Experiment's declared members must not depend on how many unrelated Runs the
// project holds, with cold and warm project-file caches alike.
//
// The "member read" below composes exactly the primitives the Backend uses
// for an Experiment detail request and its member Run panels: read the
// Experiment bundle, restrict deprecation eligibility to the declared ids,
// then resolve and read each declared path.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../discovery/discover.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../discovery/discover.js')>()
  return { ...original, discoverRuns: vi.fn(original.discoverRuns) }
})
vi.mock('../cli/scan.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../cli/scan.js')>()
  return { ...original, scanProjectRoot: vi.fn(original.scanProjectRoot) }
})

import { scanProjectRoot } from '../cli/scan.js'
import { listDeprecatedRunIds } from '../discovery/deprecation.js'
import { discoverRuns } from '../discovery/discover.js'
import { readRunDir } from '../discovery/read.js'
import {
  getFileOperationMetrics,
  projectFs,
  withProjectFileContext,
} from '../project-file-store.js'
import { readExperimentDoc } from './discover.js'
import { resolveDeclaredRunPath } from './run-path.js'

const MEMBERS = [
  'logs/sweep/member-260901-010000',
  'logs/sweep/member-260901-020000',
  'outputs/eval/member-260901-030000',
]
const roots: string[] = []

function runReadme(id: string): string {
  return `---\nid: ${id}\nstatus: FINISHED\ncreated_at: '2026-09-01T10:00:00+08:00'\ncommand: bash run.sh\n---\n`
}

async function project(unrelated: number): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'memon-member-io-'))
  roots.push(root)
  const paths = [
    ...MEMBERS,
    // One unrelated Run shares a member's base name under another root.
    'outputs/other/member-260901-010000',
    ...Array.from(
      { length: unrelated - 1 },
      (_, index) => `logs/noise/noise${index}-260902-${String(index).padStart(6, '0')}`,
    ),
  ]
  for (const path of paths) {
    await fs.mkdir(join(root, path, 'checkpoints/step-1'), { recursive: true })
    await fs.writeFile(join(root, path, 'README.md'), runReadme(path.split('/').at(-1)!))
  }
  const bundle = join(root, 'docs/experiments/E0001-member')
  await fs.mkdir(bundle, { recursive: true })
  await fs.writeFile(
    join(bundle, 'README.md'),
    `---\nid: E0001-member\nslug: member\ntitle: Member\nstatus: OPEN\narchived: false\nruns: [${MEMBERS.join(', ')}]\ncreated_at: '2026-09-01T10:00:00+08:00'\nupdated_at: '2026-09-01T10:00:00+08:00'\n---\n`,
  )
  return root
}

async function readMembers(root: string): Promise<void> {
  const experiment = await readExperimentDoc(root, 'research', 'E0001-member')
  const runs = experiment!.frontMatter.runs
  await listDeprecatedRunIds(root, { projectName: 'research', ids: runs })
  for (const path of runs.filter((reference) => reference.includes('/')))
    await readRunDir(await resolveDeclaredRunPath(root, path), 'research')
}

interface Counts {
  discoverRuns: number
  scanProjectRoot: number
  runReadmeReads: number
  unrelatedReadmeReads: number
  runRootListings: number
  physicalOps: number
}

async function measure(root: string, storageGroup: string): Promise<Counts> {
  vi.mocked(discoverRuns).mockClear()
  vi.mocked(scanProjectRoot).mockClear()
  const read = vi.spyOn(projectFs, 'readFile')
  const list = vi.spyOn(projectFs, 'readdir')
  const physical = () =>
    getFileOperationMetrics()
      .series.filter((series) => series.storageGroup === storageGroup)
      .reduce((total, series) => total + series.samples, 0)
  const before = physical()
  await withProjectFileContext(
    { root, storageGroup, persistentCache: true, reason: 'manual', attentionId: 'member-io' },
    () => readMembers(root),
  )
  const readmes = read.mock.calls
    .map(([path]) => String(path))
    .filter((path) => /\/(logs|outputs)\/.+\/README\.md$/.test(path))
  const counts: Counts = {
    discoverRuns: vi.mocked(discoverRuns).mock.calls.length,
    scanProjectRoot: vi.mocked(scanProjectRoot).mock.calls.length,
    runReadmeReads: readmes.length,
    unrelatedReadmeReads: readmes.filter(
      (path) => !MEMBERS.some((member) => path === join(root, member, 'README.md')),
    ).length,
    runRootListings: list.mock.calls
      .map(([path]) => String(path))
      .filter((path) => /\/(logs|outputs)(\/|$)/.test(path)).length,
    physicalOps: physical() - before,
  }
  read.mockRestore()
  list.mockRestore()
  return counts
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('Experiment member reads have bounded filesystem scope', () => {
  it('does the same member I/O for 3 or 50 unrelated Runs, cold and warm', async () => {
    const results: Record<string, Counts> = {}
    for (const unrelated of [3, 50]) {
      const root = await project(unrelated)
      const group = `member-io-${unrelated}-${process.pid}`
      results[`N=${unrelated} cold`] = await measure(root, group)
      results[`N=${unrelated} warm`] = await measure(root, group)
    }
    console.info(`member I/O: ${JSON.stringify(results)}`)
    for (const counts of Object.values(results)) {
      expect(counts.discoverRuns).toBe(0)
      expect(counts.scanProjectRoot).toBe(0)
      expect(counts.unrelatedReadmeReads).toBe(0)
      expect(counts.runRootListings).toBe(0)
      expect(counts.runReadmeReads).toBe(2 * MEMBERS.length)
    }
    expect(results['N=50 cold']).toEqual(results['N=3 cold'])
    expect(results['N=50 warm']).toEqual(results['N=3 warm'])
  })

  it('contrast: legacy bare-id declarations pay a Run-root walk per reference', async () => {
    const results: Record<string, Counts> = {}
    for (const unrelated of [3, 50]) {
      const root = await project(unrelated)
      const readme = join(root, 'docs/experiments/E0001-member/README.md')
      // Bare ids for the two members whose base names are unique.
      await fs.writeFile(
        readme,
        (await fs.readFile(readme, 'utf8')).replace(
          `runs: [${MEMBERS.join(', ')}]`,
          'runs: [member-260901-020000, member-260901-030000]',
        ),
      )
      const group = `member-io-legacy-${unrelated}-${process.pid}`
      const cold = await measure(root, group)
      results[`N=${unrelated} cold`] = cold
      // readMembers resolves paths only, so exercise the bare-id reader path
      // (eligibility) that a legacy declaration triggers.
      expect(cold.discoverRuns).toBeGreaterThan(0)
    }
    console.info(`legacy bare-id I/O: ${JSON.stringify(results)}`)
    for (const counts of Object.values(results)) expect(counts.runRootListings).toBeGreaterThan(0)
    expect(results['N=50 cold']!.unrelatedReadmeReads).toBe(0)
  })
})
