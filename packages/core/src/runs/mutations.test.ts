import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readRunDir } from '../discovery/read.js'
import { createExperiment, linkExperimentRun, nodeMutationFs } from '../experiments/mutations.js'
import { formatIsoLocal } from '../time.js'
import { renameRun, setRunArchiveState, setRunStatus, writeRunReadme } from './mutations.js'

const SEED = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../test-fixtures/mutation-parity/seed',
)
const CLOCK = new Date('2026-09-02T03:04:05Z')
const now = () => CLOCK
const STAMP = formatIsoLocal(CLOCK)

let root: string
let probe: string
let other: string
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-core-run-mutations-'))
  await fs.cp(SEED, root, { recursive: true })
  probe = join(root, 'logs/probe-260901-120000/README.md')
  other = join(root, 'logs/other-260901-130000/README.md')
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const base = { fs: nodeMutationFs, now }

describe('setRunStatus', () => {
  it('finishing stamps updated_at and finished_at; restarting clears finished_at', async () => {
    const finished = await setRunStatus({ ...base, readmePath: probe, status: 'FINISHED' })
    expect(finished).toMatchObject({ changed: true, prevStatus: 'RUNNING', nextStatus: 'FINISHED' })
    expect(finished.content).toContain(`updated_at: "${STAMP}"`)
    expect(finished.content).toContain(`finished_at: "${STAMP}"`)
    const restarted = await setRunStatus({ ...base, readmePath: probe, status: 'RUNNING' })
    expect(restarted.content).toContain('finished_at: null')
  })

  it('an already-set status is a no-op even with a stale lock', async () => {
    const before = await fs.readFile(probe, 'utf8')
    const result = await setRunStatus({
      ...base,
      readmePath: probe,
      status: 'RUNNING',
      lock: { expectedMtime: 1 },
    })
    expect(result.changed).toBe(false)
    expect(await fs.readFile(probe, 'utf8')).toBe(before)
    await expect(
      setRunStatus({ ...base, readmePath: probe, status: 'FAILED', lock: { expectedMtime: 1 } }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('refuses RUNNING on an archived Run', async () => {
    await setRunArchiveState({ ...base, readmePath: other, archived: true })
    await expect(
      setRunStatus({ ...base, readmePath: other, status: 'RUNNING' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', reason: 'ARCHIVED_RUNNING' })
  })
})

describe('setRunArchiveState', () => {
  it('refuses archiving a RUNNING Run and is idempotent', async () => {
    await expect(
      setRunArchiveState({ ...base, readmePath: probe, archived: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', reason: 'RUNNING_ARCHIVE' })
    const noop = await setRunArchiveState({
      ...base,
      readmePath: probe,
      archived: false,
      lock: { expectedMtime: 1 },
    })
    expect(noop.changed).toBe(false)
  })
})

describe('writeRunReadme', () => {
  it('preserve writes verbatim, stamp re-serializes with updated_at', async () => {
    const content = (await fs.readFile(probe, 'utf8')).replace('Probe setup.', 'Changed.')
    const preserved = await writeRunReadme({
      ...base,
      readmePath: probe,
      content,
      updatedAt: 'preserve',
    })
    expect(await fs.readFile(probe, 'utf8')).toBe(content)
    const stamped = await writeRunReadme({
      ...base,
      readmePath: probe,
      content: content.replace('Changed.', 'Again.'),
      updatedAt: 'stamp',
      lock: { expectedMtime: preserved.mtime, expectedHash: preserved.hash },
    })
    expect(stamped.finalContent).toContain(`updated_at: "${STAMP}"`)
  })

  it('stale lock with identical content is a no-op, otherwise a conflict naming the stale field', async () => {
    const content = await fs.readFile(probe, 'utf8')
    const noop = await writeRunReadme({
      ...base,
      readmePath: probe,
      content: content.replace("updated_at: '2026-09-01T12:00:00+08:00'", "updated_at: 'x'"),
      updatedAt: 'preserve',
      lock: { expectedMtime: 1 },
    })
    expect(noop.changed).toBe(false)
    await expect(
      writeRunReadme({
        ...base,
        readmePath: probe,
        content: content.replace('Probe setup.', 'X'),
        updatedAt: 'preserve',
        lock: { expectedHash: '0'.repeat(40) },
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: expect.objectContaining({ stale: 'hash' }),
    })
  })

  it('refuses archived RUNNING content and creates a missing README only for mtime 0', async () => {
    const content = await fs.readFile(probe, 'utf8')
    await expect(
      writeRunReadme({
        ...base,
        readmePath: probe,
        content: content.replace('archived: false', 'archived: true'),
        updatedAt: 'preserve',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const missing = join(root, 'logs/new-260901-140000/README.md')
    await fs.mkdir(dirname(missing))
    await expect(
      writeRunReadme({
        ...base,
        readmePath: missing,
        content,
        updatedAt: 'preserve',
        allowCreate: true,
        lock: { expectedMtime: 5 },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const created = await writeRunReadme({
      ...base,
      readmePath: missing,
      content,
      updatedAt: 'preserve',
      allowCreate: true,
      lock: { expectedMtime: 0 },
    })
    expect(created.created).toBe(true)
  })
})

describe('renameRun', () => {
  it('renames the directory, the README identity and the declaring Experiment path', async () => {
    const created = await createExperiment({
      ...base,
      projectRoot: root,
      projectName: 'p',
      slug: 'probe',
      importedRun: await readRunDir(join(root, 'logs/probe-260901-120000'), 'p'),
    })
    const result = await renameRun({
      ...base,
      projectRoot: root,
      projectName: 'p',
      runDir: join(root, 'logs/probe-260901-120000'),
      runId: 'probe-260901-120000',
      newSlug: 'renamed',
      isTaken: () => false,
    })
    expect(result).toMatchObject({
      oldId: 'probe-260901-120000',
      newId: 'renamed-260901-120000',
      noop: false,
    })
    expect(result.warnings).toHaveLength(1)
    const readme = await fs.readFile(join(root, 'logs/renamed-260901-120000/README.md'), 'utf8')
    expect(readme).toContain('id: renamed-260901-120000')
    const experiment = await fs.readFile(created.readmePath, 'utf8')
    expect(experiment).toContain('logs/renamed-260901-120000')
    const description = JSON.parse(
      await fs.readFile(join(created.directory, 'experiment.json'), 'utf8'),
    )
    expect(description.variants[0].runs).toEqual(['logs/renamed-260901-120000'])
  })

  it('rejects timestamp tails and dir-name clashes, no-ops on the same slug', async () => {
    const input = {
      ...base,
      projectRoot: root,
      projectName: 'p',
      runDir: join(root, 'logs/other-260901-130000'),
      runId: 'other-260901-130000',
      isTaken: () => true,
    }
    await expect(renameRun({ ...input, newSlug: 'x-260101-000000' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    await expect(renameRun({ ...input, newSlug: 'y' })).rejects.toMatchObject({
      reason: 'DUPLICATE_RUN_DIR',
    })
    expect((await renameRun({ ...input, newSlug: 'other' })).noop).toBe(true)
  })

  it('link then rename keeps the binding', async () => {
    const created = await createExperiment({
      ...base,
      projectRoot: root,
      projectName: 'p',
      slug: 'other',
    })
    await linkExperimentRun({
      ...base,
      projectRoot: root,
      experiment: { id: created.id, path: created.readmePath },
      run: await readRunDir(join(root, 'logs/other-260901-130000'), 'p'),
    })
    const result = await renameRun({
      ...base,
      projectRoot: root,
      projectName: 'p',
      runDir: join(root, 'logs/other-260901-130000'),
      runId: 'other-260901-130000',
      newSlug: 'other-b',
      isTaken: () => false,
    })
    expect(result.warnings).toEqual([])
    expect(await fs.readFile(created.readmePath, 'utf8')).toContain('logs/other-b-260901-130000')
  })
})
