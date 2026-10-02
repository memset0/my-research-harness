// Writer obligation: every Experiment/Run write primitive publishes exactly
// one index event through `MutationBase.index`, the written project bytes are
// the same with and without a sink, and an event failure never fails a write.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setRunDeprecated } from '../discovery/deprecation.js'
import { readRunDir } from '../discovery/read.js'
import {
  createExperiment,
  deleteExperiment,
  linkExperimentRun,
  type MutationFs,
  mutateDocumentWarning,
  nodeMutationFs,
  setExperimentArchived,
  setExperimentStatus,
  unlinkExperimentRun,
  writeExperimentReadme,
} from '../experiments/mutations.js'
import { renameExperiment } from '../experiments/rename.js'
import { declaredRunOwner } from '../experiments/run-path.js'
import { renameRun, setRunArchiveState, setRunStatus, writeRunReadme } from '../runs/mutations.js'
import { formatIsoLocal } from '../time.js'
import type { IndexSink } from './events.js'
import { readDerivedIndex } from './snapshot.js'

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../test-fixtures/mutation-parity',
)
const CLOCK = new Date('2026-09-02T03:04:05Z')
const now = () => CLOCK

let root: string
let sink: IndexSink

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-index-sink-'))
  await fs.cp(join(FIXTURE, 'seed'), root, { recursive: true })
  sink = { projectRoot: root, role: 'cli', now }
})

afterEach(async () => {
  await fs.chmod(join(root, '.memon/index/events'), 0o755).catch(() => undefined)
  await fs.rm(root, { recursive: true, force: true })
})

async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  async function walk(current: string) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      const rel = relative(dir, path).split(sep).join('/')
      if (rel === '.memon' || rel === 'docs/journal.md') continue
      if (entry.isDirectory()) await walk(path)
      else out[rel] = await fs.readFile(path, 'utf8')
    }
  }
  await walk(dir)
  return out
}

async function run(dir: string) {
  const loaded = await readRunDir(join(root, dir), 'project-a')
  loaded.frontMatter.experiment = await declaredRunOwner(root, loaded.path, 'project-a')
  return loaded
}

const experimentPath = (id: string) => join(root, 'docs/experiments', id, 'README.md')
const runReadme = (dir: string) => join(root, dir, 'README.md')

/** Read the events and drop them, so each op's event is inspected alone. */
async function takeEvents() {
  const read = await readDerivedIndex(root)
  for (const { name } of read.events) await fs.rm(join(root, '.memon/index/events', name))
  return read.events.map((item) => item.event)
}

describe('mutation primitives publish index events', () => {
  it('the golden parity sequence writes the same bytes with a sink', async () => {
    const base = { fs: nodeMutationFs, now, index: sink }
    await createExperiment({
      ...base,
      projectRoot: root,
      projectName: 'project-a',
      slug: 'parity-plain',
      title: 'Parity plain',
    })
    await createExperiment({
      ...base,
      projectRoot: root,
      projectName: 'project-a',
      slug: 'parity-imported',
      importedRun: await run('logs/probe-260901-120000'),
    })
    const plain = { id: 'E0001-parity-plain', path: experimentPath('E0001-parity-plain') }
    await linkExperimentRun({
      ...base,
      projectRoot: root,
      experiment: plain,
      run: await run('logs/other-260901-130000'),
    })
    await setExperimentStatus({ ...base, experiment: plain, status: 'RESOLVED' })
    await setRunStatus({
      ...base,
      readmePath: runReadme('logs/probe-260901-120000'),
      status: 'FINISHED',
    })
    const stamp = formatIsoLocal(CLOCK)
    const expected = Object.fromEntries(
      Object.entries(await tree(join(FIXTURE, 'expected'))).map(([path, body]) => [
        path,
        body.replaceAll('{{NOW}}', stamp),
      ]),
    )
    expect(await tree(root)).toEqual(expected)
    expect(await fs.readFile(join(root, '.memon/index/.gitignore'), 'utf8')).toBe('*\n')
    expect((await readDerivedIndex(root)).events).toHaveLength(5)
  })

  it('emits exactly one event per write with the expected upserts and removals', async () => {
    const base = { fs: nodeMutationFs, now, index: sink }
    const probe = 'logs/probe-260901-120000'
    const other = 'logs/other-260901-130000'

    await createExperiment({ ...base, projectRoot: root, projectName: 'project-a', slug: 'alpha' })
    let [event, ...rest] = await takeEvents()
    expect(rest).toEqual([])
    expect(event?.writer).toMatchObject({ role: 'cli', op: 'experiment.create' })
    expect(Object.keys(event!.upserts.experiments!)).toEqual(['docs/experiments/E0001-alpha'])
    expect(
      event!.upserts.experiments!['docs/experiments/E0001-alpha']!.bundle_fp.implementation,
    ).not.toBeNull()

    const alpha = { id: 'E0001-alpha', path: experimentPath('E0001-alpha') }
    await linkExperimentRun({
      ...base,
      projectRoot: root,
      experiment: alpha,
      run: await run(probe),
    })
    ;[event, ...rest] = await takeEvents()
    expect(rest).toEqual([])
    expect(event!.upserts.experiments!['docs/experiments/E0001-alpha']!.runs).toEqual([probe])

    const ops: Array<[string, () => Promise<unknown>, (e: NonNullable<typeof event>) => void]> = [
      [
        'experiment.unlink',
        async () =>
          unlinkExperimentRun({
            ...base,
            projectRoot: root,
            experiment: alpha,
            run: await run(probe),
          }),
        (e) => expect(e.upserts.experiments!['docs/experiments/E0001-alpha']!.runs).toEqual([]),
      ],
      [
        'experiment.status',
        () => setExperimentStatus({ ...base, experiment: alpha, status: 'ABANDONED' }),
        (e) =>
          expect(e.upserts.experiments!['docs/experiments/E0001-alpha']!.status).toBe('ABANDONED'),
      ],
      [
        'experiment.archive',
        () => setExperimentArchived({ ...base, experiment: alpha, archived: true }),
        (e) => expect(e.upserts.experiments!['docs/experiments/E0001-alpha']!.archived).toBe(true),
      ],
      [
        'experiment.readme',
        async () =>
          writeExperimentReadme({
            ...base,
            experiment: alpha,
            content: await fs.readFile(alpha.path, 'utf8'),
          }),
        (e) =>
          expect(Object.keys(e.upserts.experiments!)).toEqual(['docs/experiments/E0001-alpha']),
      ],
      [
        'warning.add',
        () =>
          mutateDocumentWarning({
            ...base,
            path: alpha.path,
            op: 'add',
            category: 'other',
            message: 'm',
          }),
        // The slim row keeps 7.4.0's count of parsed README warnings.
        (e) =>
          expect(Object.keys(e.upserts.experiments!)).toEqual(['docs/experiments/E0001-alpha']),
      ],
      [
        'run.status',
        () => setRunStatus({ ...base, readmePath: runReadme(probe), status: 'FAILED' }),
        (e) => expect(e.upserts.runs![probe]!.status).toBe('FAILED'),
      ],
      [
        'run.archive',
        () => setRunArchiveState({ ...base, readmePath: runReadme(probe), archived: true }),
        (e) =>
          expect(e.upserts.runs![probe]).toMatchObject({
            archived: true,
            archive_source: 'frontmatter',
          }),
      ],
      [
        'run.readme',
        async () =>
          writeRunReadme({
            ...base,
            readmePath: runReadme(other),
            content: await fs.readFile(runReadme(other), 'utf8'),
            updatedAt: 'stamp',
          }),
        (e) => expect(Object.keys(e.upserts.runs!)).toEqual([other]),
      ],
      [
        'run.deprecate',
        () =>
          setRunDeprecated(join(root, other), true, { now: formatIsoLocal(CLOCK), index: sink }),
        (e) => expect(e.upserts.runs![other]!.deprecated).toBe(true),
      ],
      [
        'run.rename',
        () =>
          renameRun({
            ...base,
            projectRoot: root,
            projectName: 'project-a',
            runDir: join(root, other),
            runId: 'other-260901-130000',
            newSlug: 'renamed',
            isTaken: () => false,
          }),
        (e) => {
          expect(Object.keys(e.upserts.runs!)).toEqual(['logs/renamed-260901-130000'])
          expect(e.removals.runs).toEqual([other])
        },
      ],
      [
        'experiment.rename',
        () =>
          renameExperiment(root, 'project-a', 'E0001-alpha', 'beta', {
            now: () => formatIsoLocal(CLOCK),
            index: sink,
          }),
        (e) => {
          expect(Object.keys(e.upserts.experiments!)).toEqual(['docs/experiments/E0001-beta'])
          expect(e.removals.experiments).toEqual(['docs/experiments/E0001-alpha'])
        },
      ],
      [
        'experiment.delete',
        () =>
          deleteExperiment({
            ...base,
            experiment: { id: 'E0001-beta', path: experimentPath('E0001-beta') },
            force: true,
          }),
        (e) => {
          expect(e.upserts).toEqual({})
          expect(e.removals.experiments).toEqual(['docs/experiments/E0001-beta'])
        },
      ],
    ]
    for (const [op, perform, check] of ops) {
      await perform()
      const events = await takeEvents()
      expect(
        events.map((item) => item.writer.op),
        op,
      ).toEqual([op])
      check(events[0]!)
    }
  })

  it('no-op writes and writes without a sink publish nothing', async () => {
    await setRunStatus({
      fs: nodeMutationFs,
      now,
      readmePath: runReadme('logs/probe-260901-120000'),
      status: 'FINISHED',
    })
    await expect(fs.access(join(root, '.memon'))).rejects.toThrow()
    const result = await setRunStatus({
      fs: nodeMutationFs,
      now,
      index: sink,
      readmePath: runReadme('logs/probe-260901-120000'),
      status: 'FINISHED',
    })
    expect(result.changed).toBe(false)
    await expect(fs.access(join(root, '.memon'))).rejects.toThrow()
  })

  it('an unwritable events/ directory leaves the write intact and returns a warning', async () => {
    await fs.mkdir(join(root, '.memon/index/events'), { recursive: true })
    await fs.writeFile(join(root, '.memon/index/.gitignore'), '*\n')
    await fs.chmod(join(root, '.memon/index/events'), 0o555)
    const failing: MutationFs = nodeMutationFs
    const result = await setRunStatus({
      fs: failing,
      now,
      index: sink,
      readmePath: runReadme('logs/probe-260901-120000'),
      status: 'FAILED',
    })
    expect(result.changed).toBe(true)
    expect(await fs.readFile(runReadme('logs/probe-260901-120000'), 'utf8')).toContain(
      'status: FAILED',
    )
    expect(result.indexWarnings).toEqual([
      { code: 'INDEX_EVENT_FAILED', message: expect.stringContaining('not written') },
    ])
  })
})
