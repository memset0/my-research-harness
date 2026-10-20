// `--run-dir` plumbing: the effective run_dirs (flag > .memon/project.yml >
// FS v8 default) bound every CLI Run walk, while project-relative Run paths
// keep resolving directly.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectDeclarationError } from '@memon/core'
import { spyExit } from '@memon/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runRefresh } from '../commands/refresh.js'
import { runShow } from '../commands/show.js'
import { effectiveRunDirs, parseRunDirs, runWalkOptions, setRunDirs } from './discovery-options.js'

async function readInventory() {
  await runRefresh({ projectRoot: root, cwd: root, format: 'json', experiments: [] })
  stdout = []
  await runShow({ projectRoot: root, cwd: root, format: 'json', includeHistory: true })
}

const readme = (id: string) =>
  `---\nid: ${id}\nname: x\nstatus: FINISHED\ncreated_at: '2026-09-01T09:00:00+08:00'\nupdated_at: '2026-09-01T09:00:00+08:00'\n---\n`

let root: string
let stdout: string[]
let realWrite: typeof process.stdout.write

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-run-dirs-cli-'))
  for (const dir of ['logs/top-260901-090000', 'outputs/group/deep-260901-100000']) {
    await fs.mkdir(join(root, dir), { recursive: true })
    await fs.writeFile(join(root, dir, 'README.md'), readme(dir.split('/').pop()!))
  }
  await fs.mkdir(join(root, 'docs/experiments/E0001-deep'), { recursive: true })
  await fs.writeFile(
    join(root, 'docs/experiments/E0001-deep/README.md'),
    '---\nid: E0001-deep\nslug: deep\nruns: [outputs/group/deep-260901-100000]\n---\n',
  )
  stdout = []
  realWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: unknown) => {
    stdout.push(String(chunk))
    return true
  }) as typeof process.stdout.write
})

afterEach(async () => {
  process.stdout.write = realWrite
  process.exitCode = 0
  setRunDirs(undefined)
  await fs.rm(root, { recursive: true, force: true })
})

describe('--run-dir', () => {
  it('validates every pattern', () => {
    expect(parseRunDirs(undefined)).toEqual({})
    expect(parseRunDirs(['logs/*', 'outputs/*/*'])).toEqual({ runDirs: ['logs/*', 'outputs/*/*'] })
    for (const bad of ['logs/**', '../logs/*', '/abs/*', 'other/*', 'logs'])
      expect(parseRunDirs(['logs/*', bad]).error).toMatch(/^--run-dir /)
  })

  it('uses the FS v8 default run_dirs when unset and undeclared', async () => {
    expect(runWalkOptions()).toEqual({})
    expect(await effectiveRunDirs(root)).toEqual({
      patterns: [
        'logs/*',
        'outputs/*',
        'experiments/*',
        'logs/E????/V????/*',
        'logs/E????/smoke/*',
      ],
      source: 'default',
    })
    await readInventory()
    const ids = JSON.parse(stdout.join('')).runs.map((run: { id: string }) => run.id)
    // `outputs/group/<run>` is deeper than `outputs/*`, so the default misses it.
    expect(ids).toEqual(['top-260901-090000'])
  })

  it('walks the locations declared in .memon/project.yml', async () => {
    await fs.mkdir(join(root, '.memon'), { recursive: true })
    await fs.writeFile(
      join(root, '.memon/project.yml'),
      "schema_version: 1\nrun_dirs: ['logs/*', 'outputs/*/*']\n",
    )
    expect(await effectiveRunDirs(root)).toEqual({
      patterns: ['logs/*', 'outputs/*/*'],
      source: 'project',
    })
    await readInventory()
    const ids = JSON.parse(stdout.join('')).runs.map((run: { id: string }) => run.id)
    expect(ids.sort()).toEqual(['deep-260901-100000', 'top-260901-090000'])
  })

  it('lets --run-dir override the declaration as a whole', async () => {
    await fs.mkdir(join(root, '.memon'), { recursive: true })
    await fs.writeFile(
      join(root, '.memon/project.yml'),
      "schema_version: 1\nrun_dirs: ['outputs/*/*']\n",
    )
    setRunDirs(['logs/*'])
    expect(await effectiveRunDirs(root)).toEqual({ patterns: ['logs/*'], source: 'cli' })
    await readInventory()
    const ids = JSON.parse(stdout.join('')).runs.map((run: { id: string }) => run.id)
    expect(ids).toEqual(['top-260901-090000'])
  })

  it('fails closed on an invalid declaration even with --run-dir', async () => {
    await fs.mkdir(join(root, '.memon'), { recursive: true })
    await fs.writeFile(join(root, '.memon/project.yml'), 'schema_version: 1\nwalk_depth: 3\n')
    const invalid = { name: 'ProjectDeclarationError', code: 'PROJECT_DECLARATION_INVALID' }
    await expect(readInventory()).rejects.toMatchObject(invalid)
    // `--run-dir` covers only `run_dirs`; `include`/`exclude` still fall through to the
    // invalid declaration, so the walk keeps failing instead of using the defaults.
    setRunDirs(['logs/*'])
    await expect(readInventory()).rejects.toBeInstanceOf(ProjectDeclarationError)
    await expect(readInventory()).rejects.toMatchObject(invalid)
    expect(stdout.join('')).toBe('')
  })

  it('uses --run-dir over a valid declaration and keeps its other layout keys', async () => {
    await fs.mkdir(join(root, 'logs/scratch-260901-110000'), { recursive: true })
    await fs.writeFile(
      join(root, 'logs/scratch-260901-110000/README.md'),
      readme('scratch-260901-110000'),
    )
    await fs.mkdir(join(root, '.memon'), { recursive: true })
    await fs.writeFile(
      join(root, '.memon/project.yml'),
      "schema_version: 1\nrun_dirs: ['outputs/*/*']\nexclude: ['scratch-*']\n",
    )
    setRunDirs(['logs/*'])
    expect(await effectiveRunDirs(root)).toEqual({ patterns: ['logs/*'], source: 'cli' })
    await readInventory()
    const ids = JSON.parse(stdout.join('')).runs.map((run: { id: string }) => run.id)
    expect(ids).toEqual(['top-260901-090000'])
  })

  it('bounds inventory refresh', async () => {
    setRunDirs(['logs/*'])
    await readInventory()
    const ids = JSON.parse(stdout.join('')).runs.map((run: { id: string }) => run.id)
    expect(ids).toEqual(['top-260901-090000'])
  })

  it('resolves a path target beyond the bound but not its bare base name', async () => {
    setRunDirs(['logs/*'])
    await runShow({
      projectRoot: root,
      cwd: root,
      format: 'json',
      id: 'outputs/group/deep-260901-100000',
    })
    expect(JSON.parse(stdout.join('')).id).toBe('deep-260901-100000')

    const exit = spyExit()
    try {
      await runShow({
        projectRoot: root,
        cwd: root,
        format: 'json',
        id: 'deep-260901-100000',
      }).catch(() => undefined)
      expect(exit.code).not.toBeNull()
    } finally {
      exit.restore()
    }
  })
})
