import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MANAGED_SECTION_POINTERS } from '@memon/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  runExperimentCreate,
  runExperimentDelete,
  runExperimentLs,
  runExperimentShow,
  runExperimentStatusSet,
} from './experiment-doc.js'
import { runExperimentDocumentLint, runExperimentDocumentRender } from './experiment-document.js'

const IMPORTED_RUN_ID = 'baseline-260810-120000'
const IMPORTED_RUN_README = `---
id: ${IMPORTED_RUN_ID}
name: baseline
status: FINISHED
archived: false
experiment: null
created_at: '2026-08-10T12:00:00+00:00'
updated_at: '2026-08-10T13:00:00+00:00'
finished_at: '2026-08-10T13:00:00+00:00'
host: test
pid: null
gpus: []
entry: ./train.sh
command: ./train.sh
wandb: null
---

## Setup

baseline

## Result

finished

## Artifacts
`

describe('Experiment document CLI (FS v9 bundle)', () => {
  let root: string
  let stdout = ''
  let realWrite: typeof process.stdout.write
  let priorExitCode: typeof process.exitCode

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'memon-v6-doc-cli-'))
    realWrite = process.stdout.write
    priorExitCode = process.exitCode
    process.exitCode = undefined
    process.stdout.write = ((chunk: unknown) => {
      stdout += String(chunk)
      return true
    }) as typeof process.stdout.write
  })

  afterEach(async () => {
    process.stdout.write = realWrite
    process.exitCode = priorExitCode
    await fs.rm(root, { recursive: true, force: true })
  })

  async function create(): Promise<string> {
    stdout = ''
    await runExperimentCreate({ projectRoot: root, cwd: root, slug: 'foo', title: 'Foo' })
    return JSON.parse(stdout).id as string
  }

  it('create keeps the strict slug rule for new Experiments', async () => {
    const realExit = process.exit
    const realStderr = process.stderr.write
    let code: number | undefined
    let stderr = ''
    process.exit = ((value?: number) => {
      code = value ?? 0
      throw new Error('exit')
    }) as typeof process.exit
    process.stderr.write = ((chunk: unknown) => {
      stderr += String(chunk)
      return true
    }) as typeof process.stderr.write
    try {
      await expect(
        runExperimentCreate({ projectRoot: root, cwd: root, slug: 'a', title: 'A' }),
      ).rejects.toThrow('exit')
    } finally {
      process.exit = realExit
      process.stderr.write = realStderr
    }
    expect(code).toBe(2)
    expect(stderr).toContain('BAD_REQUEST')
  })

  it('create writes a canonical README, the two YAML files and experiment.json', async () => {
    const id = await create()
    const directory = join(root, 'docs', 'experiments', id)
    const readme = await fs.readFile(join(directory, 'README.md'), 'utf8')
    expect(readme).toContain('## Design')
    expect(readme).toContain(
      '> Managed in [implementation.yaml](./implementation.yaml); read and update that file directly.',
    )
    expect(readme).toContain(MANAGED_SECTION_POINTERS.results)
    for (const file of ['implementation.yaml', 'investigation.yaml']) {
      await expect(fs.readFile(join(directory, file), 'utf8')).resolves.toContain(
        'schema_version: 1',
      )
    }
    expect(JSON.parse(await fs.readFile(join(directory, 'experiment.json'), 'utf8'))).toEqual({
      experiment_schema_version: 1,
      groups: {},
      columns: [],
      variants: [],
    })
    await expect(fs.stat(join(directory, 'results.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    })

    stdout = ''
    await runExperimentDocumentLint({ projectRoot: root, cwd: root, idOrSlug: id, format: 'json' })
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, summary: { errors: 0 } })
  })

  it('exposes README-only locks separately from bundle activity in ls/show', async () => {
    const id = await create()
    const directory = join(root, 'docs', 'experiments', id)
    const readmeMtime = (await fs.stat(join(directory, 'README.md'))).mtimeMs
    const future = new Date(Date.now() + 60_000)
    await fs.utimes(join(directory, 'experiment.json'), future, future)

    stdout = ''
    await runExperimentShow({ projectRoot: root, cwd: root, idOrSlug: id, format: 'json' })
    const shown = JSON.parse(stdout)
    expect(shown.readmeMtime).toBe(readmeMtime)
    expect(shown.mtime).toBeGreaterThan(shown.readmeMtime)

    stdout = ''
    await runExperimentLs({ projectRoot: root, cwd: root, format: 'json' })
    expect(JSON.parse(stdout).experiments[0]).toMatchObject({
      id,
      readmeMtime,
      mtime: shown.mtime,
    })

    // A caller can use show.readmeMtime as the README optimistic lock even
    // while aggregate bundle activity is newer because a managed source changed.
    stdout = ''
    await runExperimentStatusSet({
      projectRoot: root,
      cwd: root,
      experimentId: id,
      to: 'ABANDONED',
      expectedMtime: shown.readmeMtime,
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, nextStatus: 'ABANDONED' })
  })

  it('renders Results from the summary and lints member result files read-only', async () => {
    const runDirectory = join(root, 'logs', IMPORTED_RUN_ID)
    await fs.mkdir(runDirectory, { recursive: true })
    await fs.writeFile(join(runDirectory, 'README.md'), IMPORTED_RUN_README)
    stdout = ''
    await runExperimentCreate({
      projectRoot: root,
      cwd: root,
      slug: 'imported',
      fromRun: IMPORTED_RUN_ID,
    })
    const id = JSON.parse(stdout).id as string
    const descriptionPath = join(root, 'docs', 'experiments', id, 'experiment.json')
    const description = JSON.parse(await fs.readFile(descriptionPath, 'utf8'))
    description.columns = [
      { path: 'params.precision', label: 'Precision', type: 'enum', options: ['fp32', 'bf16'] },
      { path: 'metrics.fid', label: 'FID', type: 'number' },
    ]
    await fs.writeFile(descriptionPath, `${JSON.stringify(description, null, 2)}\n`)
    const resultPath = join(runDirectory, 'result.csv')
    await fs.writeFile(
      resultPath,
      'path,stat,value\n$experiment_schema_version,,1\nparams.precision,,bf16\nmetrics.fid,,12.5\n',
    )

    stdout = ''
    await runExperimentDocumentRender({
      projectRoot: root,
      cwd: root,
      idOrSlug: id,
      section: 'results',
      format: 'human',
    })
    expect(stdout).toContain(
      '| Variant | Status | Precision | FID | Entry | Recipe | Commit | Runs | Other Runs |',
    )
    expect(stdout).toContain(`**V0001** Imported baseline | \`COMPLETED\``)
    expect(stdout).toContain('| bf16 | 12.5 |')

    stdout = ''
    await runExperimentDocumentLint({ projectRoot: root, cwd: root, idOrSlug: id, format: 'json' })
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, summary: { errors: 0 } })

    // A value of the wrong type in a member result file is a lint error.
    const before = 'path,stat,value\n$experiment_schema_version,,1\nparams.precision,,fp8\n'
    await fs.writeFile(resultPath, before)
    stdout = ''
    process.exitCode = undefined
    await runExperimentDocumentLint({ projectRoot: root, cwd: root, idOrSlug: id, format: 'json' })
    const lint = JSON.parse(stdout)
    expect(process.exitCode).toBe(1)
    process.exitCode = undefined
    expect(lint.ok).toBe(false)
    expect(lint.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'RESULT_VALUE_TYPE_MISMATCH',
          file: `logs/${IMPORTED_RUN_ID}/result.csv`,
          field: 'params.precision',
          message: expect.stringContaining('enum'),
        }),
      ]),
    )
    expect(await fs.readFile(resultPath, 'utf8')).toBe(before)
  })

  it('reports RESULT_FILE_IGNORED for an ignored member result file inside Git', async () => {
    const runDirectory = join(root, 'logs', IMPORTED_RUN_ID)
    await fs.mkdir(runDirectory, { recursive: true })
    await fs.writeFile(join(runDirectory, 'README.md'), IMPORTED_RUN_README)
    stdout = ''
    await runExperimentCreate({
      projectRoot: root,
      cwd: root,
      slug: 'ignored',
      fromRun: IMPORTED_RUN_ID,
    })
    const id = JSON.parse(stdout).id as string
    await fs.writeFile(
      join(runDirectory, 'result.csv'),
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.fid,,1\n',
    )
    const gitignore = 'logs/*/*\n!logs/*/README.md\n'
    await fs.writeFile(join(root, '.gitignore'), gitignore)
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
    stdout = ''
    await runExperimentDocumentLint({ projectRoot: root, cwd: root, idOrSlug: id, format: 'json' })
    const lint = JSON.parse(stdout)
    expect(lint.ok).toBe(true)
    expect(lint.diagnostics).toEqual([
      expect.objectContaining({
        code: 'RESULT_FILE_IGNORED',
        severity: 'warning',
        file: `logs/${IMPORTED_RUN_ID}/result.csv`,
        message: expect.stringContaining('!/logs/*/result.csv'),
      }),
    ])
    expect(await fs.readFile(join(root, '.gitignore'), 'utf8')).toBe(gitignore)
  })

  it('imports --from-run into a valid V0001 Results assignment', async () => {
    const runDirectory = join(root, 'logs', IMPORTED_RUN_ID)
    await fs.mkdir(runDirectory, { recursive: true })
    await fs.writeFile(join(runDirectory, 'README.md'), IMPORTED_RUN_README)

    stdout = ''
    await runExperimentCreate({
      projectRoot: root,
      cwd: root,
      slug: 'imported',
      fromRun: IMPORTED_RUN_ID,
    })
    const id = JSON.parse(stdout).id as string
    const description = JSON.parse(
      await fs.readFile(join(root, 'docs', 'experiments', id, 'experiment.json'), 'utf8'),
    )
    expect(description.variants).toEqual([
      expect.objectContaining({ id: 'V0001', runs: [`logs/${IMPORTED_RUN_ID}`] }),
    ])
    expect(description.variants[0]).not.toHaveProperty('status')

    stdout = ''
    await runExperimentDocumentLint({ projectRoot: root, cwd: root, idOrSlug: id, format: 'json' })
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, summary: { errors: 0 } })
  })

  it('force-delete resolves members once and ignores unrelated broken Run READMEs', async () => {
    const runDirectory = join(root, 'logs', IMPORTED_RUN_ID)
    await fs.mkdir(runDirectory, { recursive: true })
    await fs.writeFile(join(runDirectory, 'README.md'), IMPORTED_RUN_README)

    stdout = ''
    await runExperimentCreate({
      projectRoot: root,
      cwd: root,
      slug: 'delete-members',
      fromRun: IMPORTED_RUN_ID,
    })
    const id = JSON.parse(stdout).id as string

    // `readFile()` on a directory fails. A whole-project scan would therefore
    // abort, while targeted member resolution must never open this README.
    await fs.mkdir(join(root, 'outputs', 'unrelated-260811-120000', 'README.md'), {
      recursive: true,
    })

    stdout = ''
    await runExperimentDelete({
      projectRoot: root,
      cwd: root,
      experimentIdOrSlug: id,
      force: true,
    })

    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      deletedId: id,
      cascadedRuns: [`logs/${IMPORTED_RUN_ID}`],
    })
    const runReadme = await fs.readFile(join(runDirectory, 'README.md'), 'utf8')
    expect(runReadme).toContain('experiment: null')
    await expect(fs.stat(join(root, 'docs', 'experiments', id))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('lint reports a managed-section conflict without hiding its real README content', async () => {
    const id = await create()
    const readmePath = join(root, 'docs', 'experiments', id, 'README.md')
    const readme = await fs.readFile(readmePath, 'utf8')
    await fs.writeFile(
      readmePath,
      readme.replace(
        '> Managed in [investigation.yaml](./investigation.yaml); read and update that file directly.',
        '- [ ] legacy investigation text',
      ),
    )

    stdout = ''
    await runExperimentDocumentRender({
      projectRoot: root,
      cwd: root,
      idOrSlug: id,
      section: 'investigation',
      format: 'human',
    })
    expect(stdout).toContain('MANAGED_SECTION_NOT_STUB')
    expect(stdout).toContain('legacy investigation text')

    stdout = ''
    await runExperimentDocumentLint({ projectRoot: root, cwd: root, idOrSlug: id, format: 'json' })
    const result = JSON.parse(stdout)
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MANAGED_SECTION_NOT_STUB' })]),
    )
  })
})
