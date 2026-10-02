import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readRunDir } from '../discovery/read.js'
import { deriveExperimentEntry, deriveRunEntry, runRowFromRun } from './entries.js'
import { appendIndexEvent, type IndexSink } from './events.js'
import { defaultIndexFs, type IndexFs } from './fs.js'
import { ensureIndexDirectory } from './gitignore.js'
import { classifyIndexedPath, publishMutationEvent } from './mutation-events.js'
import { isEventFileName, resolveIndexPaths } from './paths.js'
import { parseEvent } from './schema.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-index-events-'))
})

afterEach(async () => {
  await fs.chmod(join(root, '.memon/index/events'), 0o755).catch(() => undefined)
  await fs.rm(root, { recursive: true, force: true })
})

const RUN_README = `---
id: a-260901-090000
name: a
status: RUNNING
created_at: '2026-09-01T09:00:00+08:00'
updated_at: '2026-09-01T09:00:00+08:00'
---
`

async function writeRun(rel: string, content: string | null = RUN_README): Promise<string> {
  const dir = join(root, rel)
  await fs.mkdir(dir, { recursive: true })
  if (content !== null) await fs.writeFile(join(dir, 'README.md'), content)
  return dir
}

async function events(): Promise<string[]> {
  return (await fs.readdir(join(root, '.memon/index/events'))).sort()
}

describe('ensureIndexDirectory', () => {
  it('writes .gitignore ("*") before any other index file', async () => {
    const order: string[] = []
    const spy: IndexFs = {
      ...defaultIndexFs,
      writeFile: (async (path: string, ...rest: unknown[]) => {
        order.push(relative(root, path))
        return (defaultIndexFs.writeFile as (...args: unknown[]) => Promise<void>)(path, ...rest)
      }) as IndexFs['writeFile'],
    }
    await appendIndexEvent({ projectRoot: root, role: 'cli', fs: spy }, 'test', {
      upserts: {},
      removals: { runs: ['logs/x-260901-090000'] },
    })
    expect(order[0]).toBe('.memon/index/.gitignore')
    expect(await fs.readFile(join(root, '.memon/index/.gitignore'), 'utf8')).toBe('*\n')
    expect(order.slice(1).every((path) => path.startsWith('.memon/index/events/.tmp-'))).toBe(true)
  })

  it('is idempotent and never touches other .memon files', async () => {
    await fs.mkdir(join(root, '.memon'))
    await fs.writeFile(join(root, '.memon/version.json'), '{"x":1}\n')
    const paths = resolveIndexPaths(root)
    await ensureIndexDirectory(paths)
    await ensureIndexDirectory(paths, { events: true })
    expect((await fs.readdir(join(root, '.memon'))).sort()).toEqual(['index', 'version.json'])
    expect(await fs.readFile(join(root, '.memon/version.json'), 'utf8')).toBe('{"x":1}\n')
  })
})

describe('appendIndexEvent', () => {
  it('concurrent publishers produce distinct, complete event files', async () => {
    const sink: IndexSink = { projectRoot: root, role: 'cli' }
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        appendIndexEvent(sink, `op-${index}`, {
          upserts: {},
          removals: { runs: [`logs/r${index}-260901-090000`] },
        }),
      ),
    )
    expect(results.every((result) => result.warnings.length === 0)).toBe(true)
    const names = await events()
    expect(names).toHaveLength(24)
    expect(new Set(results.map((result) => result.name))).toEqual(new Set(names))
    for (const name of names) {
      expect(isEventFileName(name)).toBe(true)
      const parsed = parseEvent(
        JSON.parse(await fs.readFile(join(root, '.memon/index/events', name), 'utf8')),
      )
      expect(parsed.ok).toBe(true)
    }
  })

  it('returns INDEX_EVENT_FAILED when events/ is not writable and leaves no temp file', async () => {
    await ensureIndexDirectory(resolveIndexPaths(root), { events: true })
    await fs.chmod(join(root, '.memon/index/events'), 0o555)
    const result = await appendIndexEvent({ projectRoot: root, role: 'cli' }, 'run.status', {
      upserts: {},
      removals: {},
    })
    expect(result.name).toBeNull()
    expect(result.warnings).toEqual([
      { code: 'INDEX_EVENT_FAILED', message: expect.stringContaining('not written') },
    ])
    expect(await events()).toEqual([])
  })

  it('records writer, offset timestamp and no absolute path', async () => {
    const dir = await writeRun('logs/a-260901-090000')
    const warnings = await publishMutationEvent(
      { projectRoot: root, role: 'central', release: '9.9.9' },
      'run.status',
      [{ path: join(dir, 'README.md'), after: RUN_README }],
    )
    expect(warnings).toEqual([])
    const [name] = await events()
    const raw = await fs.readFile(join(root, '.memon/index/events', name!), 'utf8')
    expect(raw).not.toContain(root)
    const event = JSON.parse(raw)
    expect(event.writer).toEqual({ release: '9.9.9', role: 'central', op: 'run.status' })
    expect(event.written_at).toMatch(/[+-]\d{2}:\d{2}$/)
    expect(Object.keys(event.upserts.runs)).toEqual(['logs/a-260901-090000'])
  })
})

describe('publishMutationEvent', () => {
  it('classifies Experiment bundle files, legacy files, Run READMEs and result files', () => {
    const e = join(root, 'docs/experiments/E0001-foo')
    expect(classifyIndexedPath(root, join(e, 'experiment.json'))).toEqual({
      kind: 'experiment',
      readmePath: join(e, 'README.md'),
    })
    // A leftover v8 results.yaml is not an input of any index entry.
    expect(classifyIndexedPath(root, join(e, 'results.yaml'))).toBeNull()
    expect(classifyIndexedPath(root, join(root, 'logs/a-260901-090000/result.csv'))).toEqual({
      kind: 'run',
      dir: join(root, 'logs/a-260901-090000'),
      file: 'result.csv',
    })
    expect(classifyIndexedPath(root, join(root, 'docs/experiments/E0002-bar.md'))).toEqual({
      kind: 'experiment',
      readmePath: join(root, 'docs/experiments/E0002-bar.md'),
    })
    expect(classifyIndexedPath(root, join(root, 'outputs/g/a-260901-090000/README.md'))).toEqual({
      kind: 'run',
      dir: join(root, 'outputs/g/a-260901-090000'),
      file: 'README.md',
    })
    expect(classifyIndexedPath(root, join(root, 'docs/hypotheses.md'))).toBeNull()
    expect(classifyIndexedPath(root, join(e, 'scratch/notes.md'))).toBeNull()
    expect(classifyIndexedPath(root, '/elsewhere/logs/a-260901-090000/README.md')).toBeNull()
  })

  it('emits nothing without a sink or without indexed changes', async () => {
    expect(await publishMutationEvent(undefined, 'x', [{ path: 'a', after: 'b' }])).toEqual([])
    const sink = { projectRoot: root, role: 'cli' as const }
    expect(
      await publishMutationEvent(sink, 'x', [{ path: join(root, 'docs/x.md'), after: '' }]),
    ).toEqual([])
    await expect(fs.access(join(root, '.memon'))).rejects.toThrow()
  })

  it('turns a deleted Experiment README into a removal and extras into upserts/removals', async () => {
    const sink = { projectRoot: root, role: 'cli' as const }
    const fresh = await writeRun('logs/new-260901-090000', null)
    await publishMutationEvent(
      sink,
      'experiment.delete',
      [{ path: join(root, 'docs/experiments/E0001-foo/README.md'), after: null }],
      { upsertRuns: [fresh], removeRuns: [join(root, 'logs/old-260901-090000')] },
    )
    const [name] = await events()
    const event = JSON.parse(await fs.readFile(join(root, '.memon/index/events', name!), 'utf8'))
    expect(event.removals).toEqual({
      runs: ['logs/old-260901-090000'],
      experiments: ['docs/experiments/E0001-foo'],
    })
    expect(event.upserts.runs['logs/new-260901-090000']).toMatchObject({
      has_readme: false,
      status: 'UNKNOWN',
      readme_fp: null,
    })
  })
})

describe('entry derivation', () => {
  const MOCK = resolve(__dirname, '../../../../mock/project-a')

  it('matches the in-memory Run projection for every mock Run', async () => {
    const dirs = (await fs.readdir(join(MOCK, 'logs'))).filter((name) => /-\d{6}-\d{6}$/.test(name))
    expect(dirs.length).toBeGreaterThan(3)
    for (const name of dirs) {
      const dir = join(MOCK, 'logs', name)
      const entry = await deriveRunEntry({ projectRoot: MOCK, runDir: dir })
      const run = await readRunDir(dir, '')
      expect(entry).not.toBeNull()
      expect(entry!.row).toEqual(runRowFromRun(run))
      expect(entry!.status).toBe(run.frontMatter.status)
      expect(entry!.deprecated).toBe(run.frontMatter.deprecated)
      expect(entry!.has_readme).toBe(run.hasReadme)
      expect(entry!.updated_at).toBe(run.frontMatter.updatedAt || undefined)
      expect(entry!.archived).toBe(
        run.frontMatterKeys.includes('archived') ? run.frontMatter.archived : entry!.archived,
      )
    }
  })

  it('records archive source, eligibility errors and fingerprints', async () => {
    const sidecar = await writeRun('logs/s-260901-090000')
    await fs.writeFile(join(sidecar, '.archived'), '')
    const sidecarEntry = await deriveRunEntry({ projectRoot: root, runDir: sidecar })
    expect(sidecarEntry).toMatchObject({ archived: true, archive_source: 'sidecar' })

    const broken = await writeRun('logs/b-260901-090000', '---\ndeprecated: maybe\n---\n')
    const brokenEntry = await deriveRunEntry({ projectRoot: root, runDir: broken })
    expect(brokenEntry?.eligibility_error).toBe('Run deprecated field must be boolean')
    expect(brokenEntry?.readme_fp).toEqual({
      ino: expect.any(Number),
      size: (await fs.stat(join(broken, 'README.md'))).size,
      mtime_ms: expect.any(Number),
      ctime_ms: expect.any(Number),
    })
    expect(await deriveRunEntry({ projectRoot: root, runDir: join(root, 'logs/none') })).toBeNull()
  })

  it('derives Experiment entries with bundle fingerprints and slim row', async () => {
    const readme = join(MOCK, 'docs/experiments/E0001-vpred-convergence/README.md')
    const derived = await deriveExperimentEntry({ projectRoot: MOCK, readmePath: readme })
    expect(derived?.key).toBe('docs/experiments/E0001-vpred-convergence')
    expect(derived?.entry).toMatchObject({
      dir: 'docs/experiments/E0001-vpred-convergence',
      id: 'E0001-vpred-convergence',
      slug: 'vpred-convergence',
    })
    expect(derived?.entry.runs.length).toBeGreaterThan(0)
    // The mock bundles carry no YAML documents: absent files are null.
    expect(derived?.entry.bundle_fp).toEqual({
      implementation: null,
      investigation: null,
      description: null,
    })
    expect(derived?.entry.readme_fp).not.toBeNull()
  })
})

describe('result files (index_version 2)', () => {
  const RESULT = 'path,stat,value\n$experiment_schema_version,,2\nmetrics.fid,,1\n'

  it('indexes the result file fingerprint and its recorded schema version', async () => {
    const dir = await writeRun('logs/a-260901-090000')
    expect(await deriveRunEntry({ projectRoot: root, runDir: dir })).toMatchObject({
      result_fp: null,
      result_schema_version: null,
    })
    await fs.writeFile(join(dir, 'result.csv'), RESULT)
    const entry = await deriveRunEntry({ projectRoot: root, runDir: dir })
    expect(entry?.result_fp).toMatchObject({ size: RESULT.length })
    expect(entry?.result_schema_version).toBe(2)
    await fs.writeFile(join(dir, 'result.csv'), 'path,stat,value\nmetrics.fid,,1\n')
    expect((await deriveRunEntry({ projectRoot: root, runDir: dir }))?.result_schema_version).toBe(
      null,
    )
  })

  it('publishes a result write as an upsert of the Run entry with the new result_fp', async () => {
    const dir = await writeRun('logs/a-260901-090000')
    await fs.writeFile(join(dir, 'result.csv'), RESULT)
    const sink: IndexSink = { projectRoot: root, role: 'cli' }
    const warnings = await publishMutationEvent(sink, 'run.result', [
      { path: join(dir, 'result.csv'), after: RESULT },
    ])
    expect(warnings).toEqual([])
    const [name] = await events()
    const event = parseEvent(
      JSON.parse(await fs.readFile(join(root, '.memon/index/events', name!), 'utf8')),
    )
    expect(event.ok).toBe(true)
    if (!event.ok) return
    expect(event.value.index_version).toBe(2)
    const entry = event.value.upserts.runs!['logs/a-260901-090000']!
    expect(entry.result_schema_version).toBe(2)
    expect(entry.result_fp).not.toBeNull()
    // The README was not part of the write: it is read for the entry.
    expect(entry.status).toBe('RUNNING')
  })
})
