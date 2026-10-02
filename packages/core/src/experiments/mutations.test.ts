import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readRunDir } from '../discovery/read.js'
import { projectFs } from '../project-file-store.js'
import { loadResultsSummary } from '../results/summary-cache.js'
import { setRunStatus } from '../runs/mutations.js'
import { formatIsoLocal } from '../time.js'
import {
  buildExperimentBundle,
  createExperiment,
  deleteExperiment,
  IMPORTED_VARIANT_DESCRIPTION,
  linkExperimentRun,
  MutationError,
  type MutationFs,
  mutateDocumentWarning,
  nodeMutationFs,
  readDocumentLock,
  replaceDocumentAtomic,
  setExperimentArchived,
  setExperimentStatus,
  unlinkExperimentRun,
  writeExperimentReadme,
} from './mutations.js'
import { declaredRunOwner } from './run-path.js'

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../test-fixtures/mutation-parity',
)
const CLOCK = new Date('2026-09-02T03:04:05Z')
const now = () => CLOCK

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-core-mutations-'))
  await fs.cp(join(FIXTURE, 'seed'), root, { recursive: true })
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function run(dir: string) {
  const loaded = await readRunDir(join(root, dir), 'project-a')
  loaded.frontMatter.experiment = await declaredRunOwner(root, loaded.path, 'project-a')
  return loaded
}

const experimentPath = (id: string) => join(root, 'docs/experiments', id, 'README.md')

/** Every file under `dir` except activity receipts and the legacy journal. */
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

/** The shared parity sequence, driven straight through the primitives. */
async function paritySequence(port: MutationFs) {
  await createExperiment({
    fs: port,
    now,
    projectRoot: root,
    projectName: 'project-a',
    slug: 'parity-plain',
    title: 'Parity plain',
  })
  await createExperiment({
    fs: port,
    now,
    projectRoot: root,
    projectName: 'project-a',
    slug: 'parity-imported',
    importedRun: await run('logs/probe-260901-120000'),
  })
  const plain = { id: 'E0001-parity-plain', path: experimentPath('E0001-parity-plain') }
  await linkExperimentRun({
    fs: port,
    now,
    projectRoot: root,
    experiment: plain,
    run: await run('logs/other-260901-130000'),
  })
  await setExperimentStatus({ fs: port, now, experiment: plain, status: 'RESOLVED' })
  await setRunStatus({
    fs: port,
    now,
    readmePath: join(root, 'logs/probe-260901-120000/README.md'),
    status: 'FINISHED',
  })
}

async function expectedTree(): Promise<Record<string, string>> {
  const stamp = formatIsoLocal(CLOCK)
  const expected = await tree(join(FIXTURE, 'expected'))
  return Object.fromEntries(
    Object.entries(expected).map(([path, body]) => [path, body.replaceAll('{{NOW}}', stamp)]),
  )
}

describe('mutation parity golden', () => {
  it.each([
    ['node fs', nodeMutationFs],
    ['projectFs', projectFs as unknown as MutationFs],
  ])('the shared sequence through %s writes the golden tree', async (_label, port) => {
    await paritySequence(port)
    const actual = await tree(root)
    if (process.env.MEMON_UPDATE_PARITY_GOLDEN === '1' && port === nodeMutationFs) {
      const stamp = formatIsoLocal(CLOCK)
      await fs.rm(join(FIXTURE, 'expected'), { recursive: true, force: true })
      for (const [path, body] of Object.entries(actual)) {
        const target = join(FIXTURE, 'expected', path)
        await fs.mkdir(dirname(target), { recursive: true })
        await fs.writeFile(target, body.replaceAll(stamp, '{{NOW}}'))
      }
    }
    expect(actual).toEqual(await expectedTree())
  })
})

describe('replaceDocumentAtomic', () => {
  it('keeps the file mode and leaves no temp file behind', async () => {
    const path = join(root, 'doc.md')
    await fs.writeFile(path, 'a')
    await fs.chmod(path, 0o640)
    const modes: Array<number | undefined> = []
    const spying: MutationFs = {
      ...nodeMutationFs,
      writeFile: (target, data, options) => {
        modes.push(options?.mode)
        return nodeMutationFs.writeFile(target, data, options)
      },
    }
    await replaceDocumentAtomic(spying, path, 'b')
    expect(await fs.readFile(path, 'utf8')).toBe('b')
    // The temp file is created with the original permission bits (subject to umask).
    expect(modes).toEqual([0o640])
    expect((await fs.readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('removes the temp file when the rename fails', async () => {
    const path = join(root, 'doc.md')
    await fs.writeFile(path, 'a')
    const failing: MutationFs = {
      ...nodeMutationFs,
      rename: async () => {
        throw new Error('rename failed')
      },
    }
    await expect(replaceDocumentAtomic(failing, path, 'b')).rejects.toThrow('rename failed')
    expect(await fs.readFile(path, 'utf8')).toBe('a')
    expect((await fs.readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})

describe('createExperiment', () => {
  const base = () => ({ fs: nodeMutationFs, now, projectRoot: root, projectName: 'project-a' })

  it('renders the canonical README sections and the CLI Variant prose', () => {
    const bundle = buildExperimentBundle({
      id: 'E0001-x',
      slug: 'x',
      timestamp: 'T',
      importedRun: { id: 'r-260901-120000', status: 'FAILED', path: 'logs/r-260901-120000' },
    })
    expect(bundle['README.md'].match(/^## .+$/gm)).toEqual([
      '## Motivation',
      '## Design',
      '## Implementation',
      '## Investigation',
      '## Results',
      '## Findings',
      '## Limitations',
      '## Conclusion',
      '## Warnings',
    ])
    // FS v9: the imported Run is listed by V0001 with no declared status.
    expect(JSON.parse(bundle['experiment.json'])).toEqual({
      experiment_schema_version: 1,
      groups: {},
      columns: [],
      variants: [
        {
          id: 'V0001',
          name: 'Imported r-260901-120000',
          description: IMPORTED_VARIANT_DESCRIPTION,
          runs: ['logs/r-260901-120000'],
        },
      ],
    })
    expect(bundle['README.md']).toContain('[experiment.json](./experiment.json)')
  })

  it('derives the --from-run Variant status from the Run record (INTERRUPTED reads RUNNING)', async () => {
    const probe = await run('logs/probe-260901-120000')
    const created = await createExperiment({
      ...base(),
      slug: 'imported',
      importedRun: { ...probe, frontMatter: { ...probe.frontMatter, status: 'INTERRUPTED' } },
    })
    await fs.writeFile(
      join(root, 'logs/probe-260901-120000/README.md'),
      '---\nid: probe-260901-120000\nstatus: INTERRUPTED\n---\n',
    )
    const loaded = await loadResultsSummary(root, created.id)
    expect(loaded?.summary.variants[0]).toMatchObject({
      id: 'V0001',
      status: 'RUNNING',
      declared_status: null,
      others: [{ run: 'logs/probe-260901-120000', status: 'INTERRUPTED' }],
    })
    // No file in the Run directory was written by create.
    expect(await fs.readdir(join(root, 'logs/probe-260901-120000'))).toEqual(['README.md'])
  })

  it('retries when the directory already exists and rejects bad slugs', async () => {
    let calls = 0
    const racing: MutationFs = {
      ...nodeMutationFs,
      mkdir: async (path, options) => {
        if (!options?.recursive && calls++ === 0) {
          await fs.mkdir(join(dirname(path), 'E0001-other'))
          const error = new Error('exists') as NodeJS.ErrnoException
          error.code = 'EEXIST'
          throw error
        }
        return nodeMutationFs.mkdir(path, options)
      },
    }
    const created = await createExperiment({ ...base(), fs: racing, slug: 'probe-x' })
    expect(created.id).toBe('E0002-probe-x')
    await expect(createExperiment({ ...base(), slug: 'Bad' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      reason: 'INVALID_SLUG',
    })
    await expect(createExperiment({ ...base(), slug: 'probe-x-y' })).rejects.toMatchObject({
      reason: 'SLUG_PREFIX_COLLISION',
    })
  })

  it('releases a number another writer holds under a smaller name', async () => {
    let injected = false
    const racing: MutationFs = {
      ...nodeMutationFs,
      mkdir: async (path, options) => {
        const result = await nodeMutationFs.mkdir(path, options)
        if (!options?.recursive && !injected) {
          injected = true
          await fs.mkdir(join(dirname(path), 'E0001-aaa'))
        }
        return result
      },
    }
    const created = await createExperiment({ ...base(), fs: racing, slug: 'zzz' })
    expect(created.id).toBe('E0002-zzz')
    expect((await fs.readdir(join(root, 'docs/experiments'))).sort()).toEqual([
      'E0001-aaa',
      'E0002-zzz',
    ])
  })

  it('removes the half-created bundle when a file write fails', async () => {
    const failing: MutationFs = {
      ...nodeMutationFs,
      writeFile: async (path, data, options) => {
        if (path.endsWith('experiment.json')) throw new Error('disk full')
        return nodeMutationFs.writeFile(path, data, options)
      },
    }
    await expect(createExperiment({ ...base(), fs: failing, slug: 'broken' })).rejects.toThrow(
      'disk full',
    )
    expect(await fs.readdir(join(root, 'docs/experiments'))).toEqual([])
  })

  it('refuses a Run that another Experiment already declares, and a stale Run lock', async () => {
    const probe = await run('logs/probe-260901-120000')
    await expect(
      createExperiment({
        ...base(),
        slug: 'owned',
        importedRun: { ...probe, frontMatter: { ...probe.frontMatter, experiment: 'E0009-x' } },
      }),
    ).rejects.toMatchObject({ code: 'BAD_STATE', reason: 'RUN_ALREADY_OWNED' })
    await expect(
      createExperiment({
        ...base(),
        slug: 'stale',
        importedRun: probe,
        importedRunLock: { expectedMtime: 1 },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

describe('Experiment document mutations', () => {
  let plain: { id: string; path: string }
  beforeEach(async () => {
    await createExperiment({
      fs: nodeMutationFs,
      now,
      projectRoot: root,
      projectName: 'project-a',
      slug: 'plain',
    })
    plain = { id: 'E0001-plain', path: experimentPath('E0001-plain') }
  })

  it('link keeps unrelated duplicates, warns on prefix, and unlink removes the path', async () => {
    const content = await fs.readFile(plain.path, 'utf8')
    await fs.writeFile(
      plain.path,
      content.replace('runs: []', 'runs: [logs/x-260901-000000, logs/x-260901-000000]'),
    )
    const other = await run('logs/other-260901-130000')
    const linked = await linkExperimentRun({
      fs: nodeMutationFs,
      now,
      projectRoot: root,
      experiment: plain,
      run: other,
    })
    expect(linked.warnings).toEqual([
      expect.objectContaining({ code: 'RUN_SLUG_PREFIX_VIOLATION' }),
    ])
    expect(linked.content).toContain(
      'runs: [logs/x-260901-000000, logs/x-260901-000000, logs/other-260901-130000]',
    )
    await unlinkExperimentRun({
      fs: nodeMutationFs,
      now,
      projectRoot: root,
      experiment: plain,
      run: other,
    })
    expect(await fs.readFile(plain.path, 'utf8')).not.toContain('other-260901-130000')
    await expect(
      linkExperimentRun({
        fs: nodeMutationFs,
        projectRoot: root,
        experiment: plain,
        run: { ...other, frontMatter: { ...other.frontMatter, experiment: 'E0009-x' } },
      }),
    ).rejects.toMatchObject({ code: 'BAD_STATE' })
  })

  it('status: stale lock conflicts first, unchanged status writes nothing', async () => {
    await expect(
      setExperimentStatus({
        fs: nodeMutationFs,
        experiment: plain,
        status: 'OPEN',
        lock: { expectedMtime: 1 },
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      current: expect.objectContaining({ mtime: expect.any(Number) }),
    })
    const before = await fs.readFile(plain.path, 'utf8')
    const result = await setExperimentStatus({
      fs: nodeMutationFs,
      experiment: plain,
      status: 'OPEN',
    })
    expect(result.changed).toBe(false)
    expect(await fs.readFile(plain.path, 'utf8')).toBe(before)
    const archived = await setExperimentArchived({
      fs: nodeMutationFs,
      now,
      experiment: plain,
      archived: true,
    })
    expect(archived.changed).toBe(true)
    expect(archived.content).toContain('archived: true')
  })

  it('README write stamps updated_at and reports the status transition', async () => {
    const lock = await readDocumentLock(nodeMutationFs, plain.path)
    const content = await fs.readFile(plain.path, 'utf8')
    const result = await writeExperimentReadme({
      fs: nodeMutationFs,
      now,
      experiment: plain,
      content: content.replace('status: OPEN', 'status: ABANDONED'),
      lock,
    })
    expect(result).toMatchObject({ prevStatus: 'OPEN', nextStatus: 'ABANDONED' })
    expect(result.finalContent).toContain(`updated_at: "${formatIsoLocal(CLOCK)}"`)
  })

  it('warnings: add then delete, unknown row is NOT_FOUND', async () => {
    const added = await mutateDocumentWarning({
      fs: nodeMutationFs,
      now,
      path: plain.path,
      op: 'add',
      category: 'other',
      message: 'm',
    })
    expect(added.rowId).toBeTruthy()
    await expect(
      mutateDocumentWarning({ fs: nodeMutationFs, path: plain.path, op: 'reopen', rowId: 'nope' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const deleted = await mutateDocumentWarning({
      fs: nodeMutationFs,
      path: plain.path,
      op: 'delete',
      rowId: added.rowId!,
    })
    expect(deleted.deleted?.message).toBe('m')
  })

  it('delete refuses members and scratch without force, quarantines with force', async () => {
    await linkExperimentRun({
      fs: nodeMutationFs,
      projectRoot: root,
      experiment: plain,
      run: await run('logs/other-260901-130000'),
    })
    await expect(
      deleteExperiment({ fs: nodeMutationFs, experiment: plain, force: false }),
    ).rejects.toMatchObject({ reason: 'HAS_MEMBERS' })
    await fs.writeFile(join(dirname(plain.path), 'scratch.sh'), '')
    const renamed: string[] = []
    const watching: MutationFs = {
      ...nodeMutationFs,
      rename: async (from, to) => {
        renamed.push(to)
        return nodeMutationFs.rename(from, to)
      },
    }
    const deleted = await deleteExperiment({ fs: watching, experiment: plain, force: true })
    expect(deleted.cascadedRuns).toEqual(['logs/other-260901-130000'])
    expect(renamed[0]).toMatch(/\.memon-delete-E0001-plain-/)
    expect(await fs.readdir(join(root, 'docs/experiments'))).toEqual([])
  })

  it('delete keeps schema-upgrades/ canonical and removes the generated summary', async () => {
    const folder = dirname(plain.path)
    await fs.mkdir(join(folder, 'schema-upgrades'))
    await fs.writeFile(join(folder, 'schema-upgrades', '1-to-2.json'), '{}\n')
    const summary = join(root, '.memon/index/results/E0001-plain.json')
    await fs.mkdir(dirname(summary), { recursive: true })
    await fs.writeFile(summary, '{}\n')
    await deleteExperiment({ fs: nodeMutationFs, experiment: plain, force: false })
    expect(await fs.readdir(join(root, 'docs/experiments'))).toEqual([])
    await expect(fs.access(summary)).rejects.toThrow()
  })

  it('stale locks carry the current document', async () => {
    try {
      await setExperimentArchived({
        fs: nodeMutationFs,
        experiment: plain,
        archived: true,
        lock: { expectedHash: 'x' },
      })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(MutationError)
      expect((error as MutationError).details.stale).toBe('hash')
      expect((error as MutationError).current?.content).toContain('id: E0001-plain')
    }
  })
})
