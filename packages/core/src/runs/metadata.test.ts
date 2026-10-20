import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createTempProject, makeTempDir, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { deriveRunEntry } from '../derived-index/entries.js'
import { mergedIndexView, readDerivedIndex } from '../derived-index/snapshot.js'
import { deprecateRun, undeprecateRun } from '../discovery/deprecation.js'
import { discoverRuns } from '../discovery/discover.js'
import { readRunDir } from '../discovery/read.js'
import { nodeMutationFs, readDocumentState } from '../experiments/mutations.js'
import { resolveDeclaredRunPath } from '../experiments/run-path.js'
import { lintRun } from '../readme/lint.js'
import { isOffsetTimestamp, parseRunMetadata } from './metadata.js'
import { createRunMetadata, updateRunMetadata } from './metadata-mutations.js'
import { setRunStatus } from './mutations.js'

afterEach(removeTempDirs)
const initial = {
  id: 'trial',
  status: 'PENDING' as const,
  created_at: '2026-10-19T14:35:00+08:00',
  scheduler: { system: 'slurm', job_id: '123' },
}

describe('portable Run execution metadata', () => {
  it('validates real dates and explicit offsets, retaining extension fields', () => {
    for (const value of [
      '2026-02-29T01:00:00+08:00',
      '2026-10-19T24:00:00+00:00',
      '2026-10-19T01:00:00',
      '2026-10-19T01:00:00Z',
      '2026-10-19T01:00:00+14:01',
    ])
      expect(isOffsetTimestamp(value)).toBe(false)
    expect(isOffsetTimestamp('2024-02-29T01:00:00.123-05:00')).toBe(true)
    const parsed = parseRunMetadata(JSON.stringify({ ...initial, tracking: { custom: 'abc' } }))
    expect(parsed.issues).toEqual([])
    expect(parsed.data?.tracking).toEqual({ custom: 'abc' })
  })

  it('creates no README, preserves times through mtime changes, and publishes readable index entries', async () => {
    const project = await createTempProject()
    const dir = project.path('logs/E0001/V0001/trial')
    const created = await createRunMetadata({
      projectRoot: project.root,
      runDir: dir,
      metadata: initial,
      index: { projectRoot: project.root, role: 'cli' },
    })
    expect(created.indexWarnings).toEqual([])
    expect(await fs.readdir(dir)).toEqual(['run.json'])
    await fs.utimes(created.path, new Date(0), new Date(0))
    const run = await readRunDir(dir, 'project-a')
    expect(run.frontMatter.createdAt).toBe(initial.created_at)
    expect(run.frontMatter.status).toBe('PENDING')
    expect(run.frontMatter.scheduler?.job_id).toBe('123')
    expect(run.hasReadme).toBe(false)
    expect(run.recordFormat).toBe('json')
    expect(lintRun(run)).toEqual([])
    const entry = await deriveRunEntry({ projectRoot: project.root, runDir: dir })
    expect(entry?.metadata_fp).not.toBeNull()
    expect(entry?.row.record_format).toBe('json')
    const indexed = mergedIndexView(await readDerivedIndex(project.root), {
      runDirs: ['logs/E????/V????/*'],
      runDirsSource: 'default',
    })?.runs['logs/E0001/V0001/trial']
    expect(indexed?.status).toBe('PENDING')
    await expect(
      createRunMetadata({ projectRoot: project.root, runDir: dir, metadata: initial }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('updates queue references and actual execution events with hash conflict protection', async () => {
    const project = await createTempProject()
    const dir = project.path('logs/E0001/V0001/trial')
    const created = await createRunMetadata({
      projectRoot: project.root,
      runDir: dir,
      metadata: initial,
    })
    const update = async (patch: Parameters<typeof updateRunMetadata>[0]['patch'], now: string) => {
      const state = await readDocumentState(nodeMutationFs, created.path)
      return updateRunMetadata({
        fs: nodeMutationFs,
        path: created.path,
        patch,
        now: () => new Date(now),
        lock: { expectedMtime: state.mtime, expectedHash: state.hash },
      })
    }
    await update(
      { wandb: 'https://wandb.ai/example/project/runs/abc' },
      '2026-10-19T07:00:00+00:00',
    )
    const running = await update({ status: 'RUNNING' }, '2026-10-19T07:01:00+00:00')
    expect(running.metadata.started_at).toMatch(/T\d{2}:01:00[+-]\d{2}:\d{2}$/)
    const finished = await update({ status: 'FAILED' }, '2026-10-19T07:02:00+00:00')
    expect(finished.metadata.finished_at).toBeTruthy()
    const prepared = await update(
      { status: 'RESUME_READY', active: false },
      '2026-10-19T07:02:30+00:00',
    )
    expect(prepared.metadata.finished_at).toBe(finished.metadata.finished_at)
    expect(prepared.metadata.active).toBe(false)
    const resumed = await update({ status: 'RUNNING' }, '2026-10-19T07:03:00+00:00')
    expect(resumed.metadata.created_at).toBe(initial.created_at)
    expect(resumed.metadata.started_at).toBe(running.metadata.started_at)
    expect(resumed.metadata.finished_at).toBeNull()
    expect(resumed.metadata.active).toBe(false)
    const state = await readDocumentState(nodeMutationFs, created.path)
    await expect(
      updateRunMetadata({
        fs: nodeMutationFs,
        path: created.path,
        patch: { status: 'FINISHED' },
        lock: { expectedMtime: state.mtime, expectedHash: created.hash },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(
      update({ started_at: '2026-02-30T01:00:00+00:00' }, '2026-10-19T07:04:00+00:00'),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(await fs.readFile(created.path, 'utf8')).toBe(state.content)
    const status = await setRunStatus({
      fs: nodeMutationFs,
      readmePath: created.path,
      status: 'FINISHED',
      lock: { expectedMtime: state.mtime, expectedHash: state.hash },
    })
    expect(status.nextStatus).toBe('FINISHED')
    await deprecateRun(dir, { now: '2026-10-19T07:05:00+00:00' })
    expect((await readRunDir(dir, 'project-a')).frontMatter.deprecated).toBe(true)
    await undeprecateRun(dir, { now: '2026-10-19T07:06:00+00:00' })
    expect((await readRunDir(dir, 'project-a')).frontMatter.deprecated).toBe(false)
  })

  it('discovers both formats and smoke without descending into outputs', async () => {
    const project = await createTempProject({
      runs: {
        'logs/old-260901-090000':
          '---\nid: old-260901-090000\nstatus: FINISHED\ncreated_at: "2026-09-01T09:00:00+08:00"\n---\n',
        'logs/E0001/smoke/trial': {
          'run.json': JSON.stringify(initial),
          'outputs/inner-260901-090000/README.md': '',
        },
      },
    })
    const paths = await discoverRuns({
      root: project.root,
      name: 'project-a',
      include: [],
      exclude: [],
    })
    expect(paths).toEqual([
      project.path('logs/E0001/smoke/trial'),
      project.path('logs/old-260901-090000'),
    ])
    expect((await readRunDir(paths[1]!, 'project-a')).frontMatter.status).toBe('FINISHED')
    expect(await resolveDeclaredRunPath(project.root, 'logs/E0001/smoke/trial')).toBe(paths[0])
  })

  it('does not resurrect a legacy README when JSON is malformed', async () => {
    const project = await createTempProject({
      runs: {
        'logs/E0001/V0001/trial': { 'run.json': '{bad', 'README.md': '---\nstatus: FINISHED\n---' },
      },
    })
    const run = await readRunDir(project.path('logs/E0001/V0001/trial'), 'project-a')
    expect(run.frontMatter.status).toBe('UNKNOWN')
    expect(run.frontMatter.createdAt).toBe('')
    expect(run.parseErrors).not.toHaveLength(0)
  })

  it('refuses paths and record symlinks escaping the project', async () => {
    const project = await createTempProject()
    const outside = await makeTempDir()
    await fs.mkdir(project.path('logs'), { recursive: true })
    await fs.symlink(outside, project.path('logs/E0001'))
    await expect(
      createRunMetadata({
        projectRoot: project.root,
        runDir: project.path('logs/E0001/V0001/trial'),
        metadata: initial,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await fs.rm(project.path('logs/E0001'))
    await fs.mkdir(project.path('logs/E0001/V0001/trial'), { recursive: true })
    await fs.writeFile(join(outside, 'run.json'), JSON.stringify(initial))
    await fs.symlink(join(outside, 'run.json'), project.path('logs/E0001/V0001/trial/run.json'))
    await expect(resolveDeclaredRunPath(project.root, 'logs/E0001/V0001/trial')).rejects.toThrow(
      'escapes',
    )
  })
})
