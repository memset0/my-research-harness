import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  runExperimentCreate,
  runExperimentDelete,
  runExperimentLs,
  runExperimentShow,
  runExperimentStatusSet,
} from './experiment-doc.js'
import {
  runExperimentDocumentLint,
  runExperimentDocumentRender,
} from './experiment-document.js'

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

describe('v6 Experiment document CLI', () => {
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

  it('create writes a canonical README and all three schema-versioned YAML files', async () => {
    const id = await create()
    const directory = join(root, 'docs', 'experiments', id)
    const readme = await fs.readFile(join(directory, 'README.md'), 'utf8')
    expect(readme).toContain('## Design')
    expect(readme).toContain(
      '> Managed in [implementation.yaml](./implementation.yaml); read and update that file directly.',
    )
    for (const file of ['implementation.yaml', 'investigation.yaml', 'results.yaml']) {
      await expect(fs.readFile(join(directory, file), 'utf8')).resolves.toContain(
        'schema_version: 1',
      )
    }

    stdout = ''
    await runExperimentDocumentLint({ projectRoot: root, cwd: root, idOrSlug: id, format: 'json' })
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, summary: { errors: 0 } })
  })

  it('exposes README-only locks separately from bundle activity in ls/show', async () => {
    const id = await create()
    const directory = join(root, 'docs', 'experiments', id)
    const readmeMtime = (await fs.stat(join(directory, 'README.md'))).mtimeMs
    const future = new Date(Date.now() + 60_000)
    await fs.utimes(join(directory, 'results.yaml'), future, future)

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
    // while aggregate bundle activity is newer because a YAML file changed.
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

  it('renders Results from YAML and lints enum values/read references read-only', async () => {
    const id = await create()
    const resultsPath = join(root, 'docs', 'experiments', id, 'results.yaml')
    await fs.writeFile(
      resultsPath,
      `schema_version: 1
columns:
  - key: precision
    label: Precision
    group: parameter
    type: enum
    options: [fp32, bf16]
variants:
  - id: V0001
    name: BF16
    status: PLANNED
    parameters: {precision: bf16}
    metrics: {}
    runs: []
    attempts: []
`,
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
      '| Variant | Status | Precision | Entry | Recipe | Commit | Runs | Attempts |',
    )
    expect(stdout).toContain('**V0001** BF16')

    stdout = ''
    await runExperimentDocumentLint({
      projectRoot: root,
      cwd: root,
      idOrSlug: id,
      format: 'json',
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, summary: { errors: 0 } })
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
    const results = await fs.readFile(join(root, 'docs', 'experiments', id, 'results.yaml'), 'utf8')
    expect(results).toContain('id: V0001')
    expect(results).toContain(`- ${IMPORTED_RUN_ID}`)

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
    await fs.mkdir(
      join(root, 'outputs', 'unrelated-260811-120000', 'README.md'),
      { recursive: true },
    )

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
      cascadedRuns: [IMPORTED_RUN_ID],
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
