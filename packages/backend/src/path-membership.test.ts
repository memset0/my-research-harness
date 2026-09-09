import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectFs, parseExperimentReadme } from '@memon/core'
import { FilesystemMutationService } from './mutation-service.js'
import { FilesystemProjectService } from './project-service.js'

const roots: string[] = []
const name = 'trial-260909-010000'
const experimentId = 'E0001-trial'

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'memon-path-api-'))
  roots.push(root)
  const directory = join(root, 'docs/experiments', experimentId)
  await fs.mkdir(directory, { recursive: true })
  await fs.mkdir(join(root, 'logs', name), { recursive: true })
  const experiment = join(directory, 'README.md')
  const run = join(root, 'logs', name, 'README.md')
  await fs.writeFile(experiment, `---\nid: ${experimentId}\nslug: trial\ntitle: Trial\nstatus: OPEN\nruns: []\ncreated_at: '2026-09-09T01:00:00Z'\nupdated_at: '2026-09-09T01:00:00Z'\n---\n`)
  await fs.writeFile(run, `---\nid: ${name}\nstatus: FINISHED\ncreated_at: '2026-09-09T01:00:00Z'\n---\nExecution notes\n`)
  const project = { root, name: 'research', include: [], exclude: [] }
  return { root, experiment, run, reads: new FilesystemProjectService([project]), writes: new FilesystemMutationService([project]) }
}

async function lock(path: string) {
  const content = await fs.readFile(path, 'utf8')
  return { content, mtime: (await fs.stat(path)).mtimeMs, hash: createHash('sha1').update(content).digest('hex') }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('Experiment-owned path membership API', () => {
  it('unlinks a unique legacy declaration without relying on a Run parent field', async () => {
    const { experiment, run, reads, writes } = await fixture()
    await fs.writeFile(experiment, (await fs.readFile(experiment, 'utf8')).replace('runs: []', `runs: [${name}]`))
    const before = await lock(run)
    expect((await reads.getRun('research', `logs/${name}`)).frontMatter.experiment).toBe(experimentId)
    const exp = await lock(experiment)
    await writes.bindExperiment('unlink', 'research', experimentId, { run: `logs/${name}`, expectedMtime: exp.mtime, expectedHash: exp.hash, expectedRunMtime: before.mtime, expectedRunHash: before.hash })
    expect(parseExperimentReadme(await fs.readFile(experiment, 'utf8'), experimentId).frontMatter.runs).toEqual([])
    expect(await lock(run)).toEqual(before)
  })

  it('links and unlinks canonical paths without changing Run bytes or mtime', async () => {
    const { experiment, run, reads, writes } = await fixture()
    const before = await lock(run)
    let exp = await lock(experiment)
    await writes.bindExperiment('link', 'research', experimentId, { run: `logs/${name}`, expectedMtime: exp.mtime, expectedHash: exp.hash, expectedRunMtime: before.mtime, expectedRunHash: before.hash })
    expect(await lock(run)).toEqual(before)
    expect(parseExperimentReadme(await fs.readFile(experiment, 'utf8'), experimentId).frontMatter.runs).toEqual([`logs/${name}`])
    const result = await reads.getRun('research', `logs/${name}`)
    expect(result.id).toBe(`logs/${name}`)
    expect(result.frontMatter.experiment).toBe(experimentId)
    exp = await lock(experiment)
    await writes.bindExperiment('unlink', 'research', experimentId, { run: `logs/${name}`, expectedMtime: exp.mtime, expectedHash: exp.hash, expectedRunMtime: before.mtime, expectedRunHash: before.hash })
    expect(await lock(run)).toEqual(before)
    expect((await reads.getRun('research', `logs/${name}`)).frontMatter.experiment).toBeNull()
  })

  it('reads a declared member without scanning Run roots or output trees', async () => {
    const { experiment, reads } = await fixture()
    await fs.writeFile(experiment, (await fs.readFile(experiment, 'utf8')).replace('runs: []', `runs: [logs/${name}]`))
    const scan = vi.spyOn(projectFs, 'readdir')
    await reads.getRun('research', `logs/${name}`)
    await reads.getExperiment('research', experimentId)
    expect(scan.mock.calls.map(([path]) => String(path)).filter((path) => /\/(logs|outputs)(\/|$)/.test(path))).toEqual([])
  })

  it('deletes the Experiment without rewriting or locking its member Run', async () => {
    const { experiment, run, writes } = await fixture()
    await fs.writeFile(experiment, (await fs.readFile(experiment, 'utf8')).replace('runs: []', `runs: [logs/${name}]`))
    const before = await lock(run)
    const exp = await lock(experiment)
    await writes.deleteExperiment('research', experimentId, { force: true, expectedMtime: exp.mtime, expectedHash: exp.hash, runLocks: [] })
    expect(await lock(run)).toEqual(before)
    await expect(fs.stat(experiment)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
