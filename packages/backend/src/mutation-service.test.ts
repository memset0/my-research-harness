import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackendMutationError, FilesystemMutationService } from './mutation-service.js'

let dir: string
let projectRoot: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'memon-mutations-'))
  projectRoot = join(dir, 'project-a')
  await fs.cp(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../mock/project-a'),
    projectRoot,
    { recursive: true },
  )
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('FilesystemMutationService', () => {
  it('atomically updates Run status with mtime/hash conflict and journal pairing', async () => {
    const service = new FilesystemMutationService(
      [{ name: 'project-a', root: projectRoot, include: [], exclude: [] }],
      () => new Date('2026-08-26T19:00:00Z'),
    )
    const path = join(projectRoot, 'logs/foo-260501-100000/README.md')
    const content = await fs.readFile(path, 'utf8')
    const stat = await fs.stat(path)
    const result = await service.setRunStatus('project-a', 'foo-260501-100000', {
      status: 'FINISHED',
      expectedMtime: stat.mtimeMs,
      expectedHash: createHash('sha1').update(content).digest('hex'),
    })
    expect(result.nextStatus).toBe('FINISHED')
    expect(await fs.readFile(path, 'utf8')).toContain('status: FINISHED')
    expect(await fs.readFile(join(projectRoot, 'docs/journal.md'), 'utf8')).toContain(
      'foo-260501-100000',
    )
    await expect(
      service.setRunStatus('project-a', 'foo-260501-100000', {
        status: 'FAILED',
        expectedMtime: stat.mtimeMs,
      }),
    ).rejects.toBeInstanceOf(BackendMutationError)
  })
  it('updates Experiment archive without exposing filesystem paths', async () => {
    const service = new FilesystemMutationService([
      { name: 'project-a', root: projectRoot, include: [], exclude: [] },
    ])
    const path = join(projectRoot, 'docs/experiments/E0001-vpred-convergence/README.md')
    const stat = await fs.stat(path)
    const result = await service.setExperimentArchived('project-a', 'E0001-vpred-convergence', {
      archived: true,
      expectedMtime: stat.mtimeMs,
    })
    expect(result.archived).toBe(true)
    expect(JSON.stringify(result)).not.toContain(projectRoot)
  })
  it('appends allowed journal events and rejects DIGEST', async () => {
    const service = new FilesystemMutationService([
      { name: 'project-a', root: projectRoot, include: [], exclude: [] },
    ])
    await expect(
      service.appendJournal('project-a', { tag: 'NOTE', body: 'hello' }),
    ).resolves.toMatchObject({ appended: { tag: 'NOTE' } })
    await expect(
      service.appendJournal('project-a', { tag: 'DIGEST', body: 'no' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('applies warning operations with mtime+hash locking and returns portable records', async () => {
    const service = new FilesystemMutationService(
      [{ name: 'project-a', root: projectRoot, include: [], exclude: [] }],
      () => new Date('2026-08-26T19:00:00Z'),
    )
    const before = await service.listWarnings('run', 'project-a', 'foo-260501-100000')
    const result = await service.mutateWarning('run', 'project-a', 'foo-260501-100000', {
      op: 'add',
      category: 'other',
      message: 'portable warning',
      expectedMtime: before.mtime,
      expectedHash: before.hash,
    })

    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: 'portable warning' })]),
    )
    expect(JSON.stringify(result)).not.toContain(projectRoot)
    await expect(
      service.mutateWarning('run', 'project-a', 'foo-260501-100000', {
        op: 'delete',
        rowId: result.rowId,
        expectedMtime: before.mtime,
        expectedHash: before.hash,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('creates and cascade-deletes a path-free Experiment bundle with exact Run locks', async () => {
    const service = new FilesystemMutationService(
      [{ name: 'project-a', root: projectRoot, include: [], exclude: [] }],
      () => new Date('2026-08-26T19:00:00Z'),
    )
    const runPath = join(projectRoot, 'logs/sub-recipe-260504-110000/README.md')
    const runBefore = await documentLock(runPath)
    const created = await service.createExperiment('project-a', {
      slug: 'backend-created',
      title: 'Backend created',
      fromRun: 'sub-recipe-260504-110000',
      fromRunExpectedMtime: runBefore.mtime,
      fromRunExpectedHash: runBefore.hash,
    })
    expect(created.resource).toMatch(/^docs\/experiments\/E\d{4}-backend-created\/README\.md$/)
    expect(JSON.stringify(created)).not.toContain(projectRoot)
    const experimentPath = join(projectRoot, created.resource)
    expect(await fs.readFile(runPath, 'utf8')).toContain(`experiment: ${created.id}`)
    await expect(
      service.deleteExperiment('project-a', created.id, {
        force: true,
        expectedMtime: created.mtime + 1,
        expectedHash: created.hash,
        runLocks: [],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.stat(experimentPath)).toBeTruthy()

    const [experimentLock, runLock] = await Promise.all([
      documentLock(experimentPath),
      documentLock(runPath),
    ])
    const deleted = await service.deleteExperiment('project-a', created.id, {
      force: true,
      expectedMtime: experimentLock.mtime,
      expectedHash: experimentLock.hash,
      runLocks: [
        {
          run: 'sub-recipe-260504-110000',
          expectedMtime: runLock.mtime,
          expectedHash: runLock.hash,
        },
      ],
    })
    expect(deleted).toEqual({
      ok: true,
      deletedId: created.id,
      cascadedRuns: ['sub-recipe-260504-110000'],
    })
    await expect(fs.stat(experimentPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(runPath, 'utf8')).toContain('experiment: null')
  })

  it('links and unlinks both documents under mtime+hash conflicts', async () => {
    const service = new FilesystemMutationService(
      [{ name: 'project-a', root: projectRoot, include: [], exclude: [] }],
      () => new Date('2026-08-26T19:00:00Z'),
    )
    const experimentId = 'E0001-vpred-convergence'
    const runId = 'sub-recipe-260504-110000'
    const experimentPath = join(projectRoot, `docs/experiments/${experimentId}/README.md`)
    const runPath = join(projectRoot, `logs/${runId}/README.md`)
    const [experimentBefore, runBefore] = await Promise.all([
      documentLock(experimentPath),
      documentLock(runPath),
    ])
    const linked = await service.bindExperiment('link', 'project-a', experimentId, {
      run: runId,
      expectedMtime: experimentBefore.mtime,
      expectedHash: experimentBefore.hash,
      expectedRunMtime: runBefore.mtime,
      expectedRunHash: runBefore.hash,
    })
    expect(linked).toMatchObject({ ok: true, experimentId, runId })
    expect(JSON.stringify(linked)).not.toContain(projectRoot)
    expect(await fs.readFile(runPath, 'utf8')).toContain(`experiment: ${experimentId}`)
    expect(await fs.readFile(experimentPath, 'utf8')).toContain(runId)
    await expect(
      service.bindExperiment('unlink', 'project-a', experimentId, {
        run: runId,
        expectedMtime: experimentBefore.mtime,
        expectedHash: experimentBefore.hash,
        expectedRunMtime: runBefore.mtime,
        expectedRunHash: runBefore.hash,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    const [experimentLinked, runLinked] = await Promise.all([
      documentLock(experimentPath),
      documentLock(runPath),
    ])
    await service.bindExperiment('unlink', 'project-a', experimentId, {
      run: runId,
      expectedMtime: experimentLinked.mtime,
      expectedHash: experimentLinked.hash,
      expectedRunMtime: runLinked.mtime,
      expectedRunHash: runLinked.hash,
    })
    expect(await fs.readFile(runPath, 'utf8')).toContain('experiment: null')
  })

  it('writes a canonical Experiment README and rejects stale content locks', async () => {
    const service = new FilesystemMutationService(
      [{ name: 'project-a', root: projectRoot, include: [], exclude: [] }],
      () => new Date('2026-08-26T19:00:00Z'),
    )
    const id = 'E0001-vpred-convergence'
    const path = join(projectRoot, `docs/experiments/${id}/README.md`)
    const before = await documentLock(path)
    const content = await fs.readFile(path, 'utf8')
    const result = await service.writeExperimentReadme('project-a', id, {
      content: content.replace('status: OPEN', 'status: RESOLVED'),
      expectedMtime: before.mtime,
      expectedHash: before.hash,
    })
    expect(result).toMatchObject({
      ok: true,
      prevStatus: 'OPEN',
      nextStatus: 'RESOLVED',
      journalChanged: true,
    })
    expect(result.finalContent).toContain('status: RESOLVED')
    await expect(
      service.writeExperimentReadme('project-a', id, {
        content,
        expectedMtime: before.mtime,
        expectedHash: before.hash,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

async function documentLock(path: string): Promise<{ mtime: number; hash: string }> {
  const [content, stat] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
  return { mtime: stat.mtimeMs, hash: createHash('sha1').update(content).digest('hex') }
}
