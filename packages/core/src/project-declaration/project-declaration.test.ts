import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverRuns } from '../discovery/discover.js'
import { resolveRunTarget } from '../project-scan/resolve-run.js'
import { scanProjectRoot } from '../project-scan/scan.js'
import { loadProjectDeclaration, resolveEffectiveRunDirs, selectEffectiveRunDirs } from './load.js'
import { resolveProjectDeclarationPath } from './paths.js'
import { ProjectDeclarationError } from './schema.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-project-declaration-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function declare(content: string): Promise<void> {
  await fs.mkdir(join(root, '.memon'), { recursive: true })
  await fs.writeFile(join(root, '.memon/project.yml'), content)
}

async function run(rel: string): Promise<void> {
  await fs.mkdir(join(root, rel), { recursive: true })
  await fs.writeFile(join(root, rel, 'README.md'), `---\nid: ${rel.split('/').at(-1)}\n---\n`)
}

async function invalid(content: string, key?: string): Promise<void> {
  await declare(content)
  const error = await loadProjectDeclaration(root).catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(ProjectDeclarationError)
  expect((error as ProjectDeclarationError).code).toBe('PROJECT_DECLARATION_INVALID')
  expect((error as Error).message).toContain('.memon/project.yml')
  if (key) {
    expect((error as ProjectDeclarationError).key).toBe(key)
    expect((error as Error).message).toContain(key)
  }
}

describe('loadProjectDeclaration', () => {
  it('returns null when the file is absent', async () => {
    expect(await loadProjectDeclaration(root)).toBeNull()
  })

  it('accepts a schema-only file and a run_dirs list', async () => {
    await declare('schema_version: 1\n')
    expect(await loadProjectDeclaration(root)).toEqual({ schema_version: 1 })
    await declare('schema_version: 1\nrun_dirs:\n  - logs/*\n  - outputs/*/*\n')
    expect(await loadProjectDeclaration(root)).toEqual({
      schema_version: 1,
      run_dirs: ['logs/*', 'outputs/*/*'],
    })
  })

  it('rejects unknown keys naming the key', async () => {
    await invalid('schema_version: 1\nrun_depth: 2\n', 'run_depth')
  })

  it('rejects invalid patterns, empty lists and bad schema versions', async () => {
    await invalid('schema_version: 1\nrun_dirs: ["logs/**"]\n', 'run_dirs')
    await invalid('schema_version: 1\nrun_dirs: ["../logs/*"]\n', 'run_dirs')
    await invalid('schema_version: 1\nrun_dirs: []\n', 'run_dirs')
    await invalid('run_dirs: ["logs/*"]\n', 'schema_version')
    await invalid('schema_version: 2\n', 'schema_version')
    await invalid('schema_version: "1"\n', 'schema_version')
  })

  it('rejects non-mapping documents and unparseable YAML', async () => {
    await invalid('- logs/*\n')
    await invalid('just text\n')
    await invalid('')
    await invalid('schema_version: [1\n')
  })

  it('keeps the path inside the root', () => {
    expect(resolveProjectDeclarationPath('/p/x/../y')).toEqual({
      rootAbs: '/p/y',
      declarationAbs: '/p/y/.memon/project.yml',
    })
  })
})

describe('effective run_dirs precedence', () => {
  it('CLI --run-dir wins over everything', async () => {
    await declare('schema_version: 1\nrun_dirs: ["outputs/*/*"]\n')
    expect(
      await resolveEffectiveRunDirs({ root, cliRunDirs: ['logs/x/*'], centralRunDirs: ['logs/*'] }),
    ).toEqual({ patterns: ['logs/x/*'], source: 'cli' })
  })

  it('central run_dirs win over the declaration without reading it', async () => {
    await declare('schema_version: 1\nrun_depth: 2\n') // invalid, but never read
    expect(await resolveEffectiveRunDirs({ root, centralRunDirs: ['logs/*'] })).toEqual({
      patterns: ['logs/*'],
      source: 'central',
    })
  })

  it('the declaration wins over the default', async () => {
    await declare('schema_version: 1\nrun_dirs: ["outputs/*/*"]\n')
    expect(await resolveEffectiveRunDirs({ root })).toEqual({
      patterns: ['outputs/*/*'],
      source: 'project',
    })
  })

  it('falls back to the FS v8 default (also for a schema-only declaration)', async () => {
    const fallback = { patterns: ['logs/*', 'outputs/*', 'experiments/*'], source: 'default' }
    expect(await resolveEffectiveRunDirs({ root })).toEqual(fallback)
    await declare('schema_version: 1\n')
    expect(await resolveEffectiveRunDirs({ root })).toEqual(fallback)
    expect(selectEffectiveRunDirs({ declaration: null })).toEqual(fallback)
  })

  it('an invalid declaration fails closed', async () => {
    await declare('schema_version: 1\nrun_dirs: ["logs/**"]\n')
    await expect(resolveEffectiveRunDirs({ root })).rejects.toBeInstanceOf(ProjectDeclarationError)
  })
})

describe('discovery reads the declaration', () => {
  beforeEach(async () => {
    await run('logs/a-260901-090000')
    await run('outputs/group/b-260901-090000')
  })

  const found = async (runDirs?: string[]) =>
    (
      await discoverRuns({
        name: 'p',
        root,
        include: [],
        exclude: [],
        ...(runDirs ? { runDirs } : {}),
      })
    ).map((path) => relative(root, path))

  it('walks the declared patterns when the caller passes none', async () => {
    await declare('schema_version: 1\nrun_dirs: ["outputs/*/*"]\n')
    expect(await found()).toEqual(['outputs/group/b-260901-090000'])
    const snapshot = await scanProjectRoot(root)
    expect(snapshot.experiments.map((r) => r.id)).toEqual(['b-260901-090000'])
    expect(await resolveRunTarget(root, 'a-260901-090000')).toBeNull()
    expect((await resolveRunTarget(root, 'b-260901-090000'))?.id).toBe('b-260901-090000')
  })

  it('explicit runDirs override the declaration', async () => {
    await declare('schema_version: 1\nrun_dirs: ["outputs/*/*"]\n')
    expect(await found(['logs/*'])).toEqual(['logs/a-260901-090000'])
  })

  it('an invalid declaration fails the walk naming the file', async () => {
    await declare('schema_version: 1\nrun_dirs: ["logs/**"]\n')
    await expect(found()).rejects.toThrow(/\.memon\/project\.yml/)
    await expect(scanProjectRoot(root)).rejects.toBeInstanceOf(ProjectDeclarationError)
  })
})
