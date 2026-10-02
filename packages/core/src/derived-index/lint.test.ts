import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lintExperimentDocument } from '../experiments/documents.js'
import { buildExperimentRecord, parseExperimentReadme } from '../experiments/parse.js'
import { lintProjectDeclaration } from '../project-declaration/lint.js'
import { lintRunNesting } from '../readme/lint.js'
import { lintDerivedIndex } from './lint.js'
import { rebuildIndex } from './rebuild.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-index-lint-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function experimentWith(runs: string[]) {
  const parsed = parseExperimentReadme(
    `---\nid: E0001-foo\nslug: foo\ntitle: T\nstatus: OPEN\narchived: false\nruns:\n${runs.map((r) => `  - ${r}`).join('\n')}\n---\n`,
    'E0001-foo',
  )
  return buildExperimentRecord(parsed, {
    id: 'E0001-foo',
    project: 'p',
    path: join(root, 'docs/experiments/E0001-foo/README.md'),
    mtime: 0,
    readmeMtime: 0,
  })
}

describe('Experiment document lint (FS v8 layout)', () => {
  it('reports RUN_NESTED for a declared path with a Run-shaped ancestor and keeps it', () => {
    const experiment = experimentWith([
      'logs/a-260901-090000/b-260901-100000',
      'logs/c-260901-090000',
    ])
    const codes = lintExperimentDocument(experiment).filter((d) => d.code === 'RUN_NESTED')
    expect(codes).toEqual([
      expect.objectContaining({
        severity: 'error',
        field: 'runs',
        message: expect.stringContaining('logs/a-260901-090000'),
      }),
    ])
    expect(experiment.frontMatter.runs).toHaveLength(2)
  })

  it('reports RUN_OUTSIDE_RUN_DIRS only when the effective patterns are given', () => {
    const experiment = experimentWith(['outputs/group/a-260901-090000', 'logs/b-260901-090000'])
    expect(lintExperimentDocument(experiment).some((d) => d.code === 'RUN_OUTSIDE_RUN_DIRS')).toBe(
      false,
    )
    const outside = lintExperimentDocument(experiment, {
      runDirs: ['logs/*', 'outputs/*', 'experiments/*'],
    }).filter((d) => d.code === 'RUN_OUTSIDE_RUN_DIRS')
    expect(outside).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message: expect.stringContaining('outputs/group/a-260901-090000'),
      }),
    ])
    expect(
      lintExperimentDocument(experiment, { runDirs: ['logs/*', 'outputs/*/*'] }).some(
        (d) => d.code === 'RUN_OUTSIDE_RUN_DIRS',
      ),
    ).toBe(false)
  })
})

describe('Run nesting lint', () => {
  it('lists Run-shaped direct children of a Run', async () => {
    const run = join(root, 'logs/a-260901-090000')
    await fs.mkdir(join(run, 'b-260901-100000'), { recursive: true })
    await fs.mkdir(join(run, 'checkpoints'), { recursive: true })
    await fs.writeFile(join(run, 'c-260901-110000'), '')
    expect(await lintRunNesting(run)).toEqual([
      expect.objectContaining({ code: 'RUN_NESTED', severity: 'error', file: 'b-260901-100000' }),
    ])
    expect(await lintRunNesting(join(root, 'logs/missing-260901-090000'))).toEqual([])
  })
})

describe('project declaration lint', () => {
  it('reports the effective patterns with their source', async () => {
    expect(await lintProjectDeclaration(root)).toEqual({
      present: false,
      declaration: null,
      effective: { patterns: ['logs/*', 'outputs/*', 'experiments/*'], source: 'default' },
      diagnostics: [],
    })
    await fs.mkdir(join(root, '.memon'))
    await fs.writeFile(
      join(root, '.memon/project.yml'),
      'schema_version: 1\nrun_dirs: ["logs/*/*"]\n',
    )
    expect((await lintProjectDeclaration(root)).effective).toEqual({
      patterns: ['logs/*/*'],
      source: 'project',
    })
    expect((await lintProjectDeclaration(root, { cliRunDirs: ['logs/*'] })).effective?.source).toBe(
      'cli',
    )
  })

  it('reports PROJECT_DECLARATION_INVALID naming the file and key', async () => {
    await fs.mkdir(join(root, '.memon'))
    await fs.writeFile(join(root, '.memon/project.yml'), 'schema_version: 1\nrun_depth: 2\n')
    const lint = await lintProjectDeclaration(root)
    expect(lint.effective).toBeNull()
    expect(lint.diagnostics).toEqual([
      {
        code: 'PROJECT_DECLARATION_INVALID',
        severity: 'error',
        file: '.memon/project.yml',
        field: 'run_depth',
        message: expect.stringContaining('run_depth'),
      },
    ])
  })
})

describe('index lint', () => {
  it('turns drift and layout notices into lint diagnostics', async () => {
    await fs.mkdir(join(root, 'logs/a-260901-090000'), { recursive: true })
    await fs.writeFile(
      join(root, 'logs/a-260901-090000/README.md'),
      '---\nid: a-260901-090000\n---\n',
    )
    await rebuildIndex(root)
    await fs.mkdir(join(root, '.memon'), { recursive: true })
    await fs.writeFile(
      join(root, '.memon/project.yml'),
      'schema_version: 1\nrun_dirs: ["logs/*/*"]\n',
    )
    const { diagnostics } = await lintDerivedIndex(root)
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'INDEX_DRIFT', field: 'walk:run_dirs:run_dirs' }),
    ])
  })
})
