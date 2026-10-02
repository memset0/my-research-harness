// Project-owned layout: `.memon/project.yml` layout keys, per-key precedence
// with deprecated central values, discovery applying the effective excludes,
// the central deprecation log and `readCentralProjectLayout`.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readCentralProjectLayout } from '../config/central-layout.js'
import { ConfigError, loadConfig, resetCentralLayoutDeprecationWarnings } from '../config/load.js'
import { discoverRuns } from '../discovery/discover.js'
import { scanProjectRoot } from '../project-scan/scan.js'
import type { ProjectConfig } from '../types.js'
import { resetCentralLayoutWarnings, resolveProjectLayout } from './layout.js'
import { lintProjectDeclaration } from './lint.js'
import { loadProjectDeclaration } from './load.js'
import { ProjectDeclarationError } from './schema.js'

let root: string
let stderr: string[]
const realWrite = process.stderr.write.bind(process.stderr)

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-project-layout-'))
  stderr = []
  resetCentralLayoutWarnings()
  resetCentralLayoutDeprecationWarnings()
  process.stderr.write = ((chunk: unknown) => {
    stderr.push(String(chunk))
    return true
  }) as typeof process.stderr.write
})

afterEach(async () => {
  process.stderr.write = realWrite
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

const project = (central: Partial<ProjectConfig> = {}): ProjectConfig => ({
  name: 'project-a',
  root,
  include: [],
  exclude: [],
  ...central,
})

async function invalid(content: string, key: string): Promise<void> {
  await declare(content)
  const error = await loadProjectDeclaration(root).catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(ProjectDeclarationError)
  expect((error as ProjectDeclarationError).key).toBe(key)
  expect((error as Error).message).toContain(key)
}

describe('declaration layout schema', () => {
  it('accepts include, exclude and github next to run_dirs', async () => {
    await declare(
      [
        'schema_version: 1',
        'run_dirs: ["logs/*", "logs/*/*"]',
        'include: ["logs/**"]',
        'exclude: [scratch, "tmp-*"]',
        'github:',
        '  - { owner: acme, repo: project-a, path: . }',
        '  - { owner: acme, repo: ext, path: third_party/ext }',
        '',
      ].join('\n'),
    )
    expect(await loadProjectDeclaration(root)).toEqual({
      schema_version: 1,
      run_dirs: ['logs/*', 'logs/*/*'],
      include: ['logs/**'],
      exclude: ['scratch', 'tmp-*'],
      github: [
        { owner: 'acme', repo: 'project-a', path: '.' },
        { owner: 'acme', repo: 'ext', path: 'third_party/ext' },
      ],
    })
  })

  it('rejects wrong types, null values and unknown keys naming the key', async () => {
    await invalid('schema_version: 1\nexclude: scratch\n', 'exclude')
    await invalid('schema_version: 1\ninclude: [1]\n', 'include')
    await invalid('schema_version: 1\nexclude:\n', 'exclude')
    await invalid('schema_version: 1\ngithub: [{ owner: acme }]\n', 'github')
    await invalid('schema_version: 1\nroot: /elsewhere\n', 'root')
    await invalid('schema_version: 1\nstorage: sshfs\n', 'storage')
  })

  it('rejects github paths outside the project root', async () => {
    for (const path of ['../other', '/etc', 'a/../../b']) {
      await invalid(
        `schema_version: 1\ngithub: [{ owner: acme, repo: x, path: "${path}" }]\n`,
        'github',
      )
    }
  })
})

describe('per-key precedence', () => {
  beforeEach(async () => {
    await run('logs/a-260901-090000')
    await run('logs/scratch/b-260901-090000')
    await run('logs/tmp/c-260901-090000')
  })

  const walk = async (config: ProjectConfig) =>
    (await discoverRuns(config)).map((path) => relative(root, path))
  const deep = 'run_dirs: ["logs/*", "logs/*/*"]\n'

  it('project only: the declaration exclude applies (discovery and scan)', async () => {
    await declare(`schema_version: 1\n${deep}exclude: [scratch]\n`)
    expect(await walk(project())).toEqual(['logs/a-260901-090000', 'logs/tmp/c-260901-090000'])
    const snapshot = await scanProjectRoot(root)
    expect(snapshot.experiments.map((r) => r.id).sort()).toEqual([
      'a-260901-090000',
      'c-260901-090000',
    ])
    const layout = await resolveProjectLayout(project())
    expect(layout.sources).toEqual({
      run_dirs: 'project',
      include: 'default',
      exclude: 'project',
      github: 'default',
    })
    expect(stderr.join('')).toBe('')
  })

  it('central only: the central exclude applies without a declaration', async () => {
    const config = project({ runDirs: ['logs/*', 'logs/*/*'], exclude: ['scratch'] })
    expect(await walk(config)).toEqual(['logs/a-260901-090000', 'logs/tmp/c-260901-090000'])
    expect((await resolveProjectLayout(config)).sources.exclude).toBe('central')
  })

  it('both agree: central source, no conflict warning', async () => {
    await declare(`schema_version: 1\n${deep}exclude: [scratch]\n`)
    const config = project({ runDirs: ['logs/*', 'logs/*/*'], exclude: ['scratch'] })
    expect(await walk(config)).toEqual(['logs/a-260901-090000', 'logs/tmp/c-260901-090000'])
    expect((await resolveProjectLayout(config)).sources.exclude).toBe('central')
    expect(stderr.join('')).not.toContain('CENTRAL_LAYOUT_DEPRECATED')
  })

  it('conflict: central wins and one warning names the key', async () => {
    await declare(`schema_version: 1\n${deep}exclude: [tmp]\n`)
    const config = project({ exclude: ['scratch'] })
    expect(await walk(config)).toEqual(['logs/a-260901-090000', 'logs/tmp/c-260901-090000'])
    await walk(config)
    const warnings = stderr.join('').match(/CENTRAL_LAYOUT_DEPRECATED.*`exclude` conflicts/g)
    expect(warnings).toHaveLength(1)
    // run_dirs came from the declaration: the declaration still supplies other keys.
    expect((await resolveProjectLayout(config)).sources).toMatchObject({
      run_dirs: 'project',
      exclude: 'central',
    })
  })

  it('an invalid declaration is ignored only when central covers every key', async () => {
    await declare('schema_version: 1\nexclude: scratch\n')
    const full = project({
      runDirs: ['logs/*'],
      include: ['logs/**'],
      exclude: ['scratch'],
      github: [{ owner: 'acme', repo: 'x', path: root }],
    })
    expect((await resolveProjectLayout(full)).sources.exclude).toBe('central')
    await expect(resolveProjectLayout(project({ runDirs: ['logs/*'] }))).rejects.toBeInstanceOf(
      ProjectDeclarationError,
    )
    await expect(walk(project({ runDirs: ['logs/*'] }))).rejects.toBeInstanceOf(
      ProjectDeclarationError,
    )
  })

  it('github paths from the declaration resolve against the root', async () => {
    await declare(
      'schema_version: 1\ngithub: [{ owner: acme, repo: ext, path: third_party/ext }]\n',
    )
    expect((await resolveProjectLayout(project())).github).toEqual([
      { owner: 'acme', repo: 'ext', path: join(root, 'third_party/ext') },
    ])
  })

  it('lint reports deprecated central keys and flags conflicts', async () => {
    await declare(`schema_version: 1\n${deep}exclude: [tmp]\n`)
    const lint = await lintProjectDeclaration(root, {
      central: { exclude: ['scratch'], run_dirs: ['logs/*', 'logs/*/*'] },
      centralConfigPath: 'config.yml',
    })
    expect(lint.layout?.exclude).toEqual(['scratch'])
    expect(lint.layout?.sources.exclude).toBe('central')
    expect(lint.diagnostics).toEqual([
      expect.objectContaining({
        code: 'CENTRAL_LAYOUT_DEPRECATED',
        severity: 'warning',
        field: 'run_dirs',
        conflict: false,
      }),
      expect.objectContaining({
        code: 'CENTRAL_LAYOUT_DEPRECATED',
        severity: 'warning',
        field: 'exclude',
        conflict: true,
      }),
    ])
  })
})

describe('central configuration', () => {
  const CENTRAL = [
    'projects:',
    '  - name: project-a',
    '    root: ./project-a',
    '    run_dirs: ["outputs/*/*"]',
    '    exclude: [scratch]',
    '    include: []',
    '    github: [{ owner: acme, repo: project-a, path: . }]',
    '  - name: project-b',
    '    root: ./project-b',
    '',
  ].join('\n')

  it('loadConfig keeps central layout keys and warns once per project and key', async () => {
    await fs.writeFile(join(root, 'config.yml'), CENTRAL)
    const first = await loadConfig({ cwd: root })
    await loadConfig({ cwd: root })
    expect(first!.projects[0]).toMatchObject({ exclude: ['scratch'], runDirs: ['outputs/*/*'] })
    const text = stderr.join('')
    for (const key of ['run_dirs', 'exclude', 'github']) {
      expect(
        text.match(new RegExp(`CENTRAL_LAYOUT_DEPRECATED.*"project-a".*\`${key}\``, 'g')),
      ).toHaveLength(1)
    }
    // empty lists and deployment-only entries are not reported
    expect(text).not.toContain('`include`')
    expect(text).not.toContain('project-b')
  })

  it('a deployment-only configuration logs nothing', async () => {
    await fs.writeFile(join(root, 'config.yml'), 'projects:\n  - { name: project-b, root: ./b }\n')
    await loadConfig({ cwd: root })
    expect(stderr.join('')).not.toContain('CENTRAL_LAYOUT_DEPRECATED')
  })

  it('readCentralProjectLayout extracts the raw layout keys of one entry', async () => {
    await fs.writeFile(join(root, 'config.yml'), CENTRAL)
    expect(
      await readCentralProjectLayout({ configPath: 'config.yml', cwd: root, project: 'project-a' }),
    ).toEqual({
      configPath: join(root, 'config.yml'),
      name: 'project-a',
      root: join(root, 'project-a'),
      layout: {
        run_dirs: ['outputs/*/*'],
        exclude: ['scratch'],
        github: [{ owner: 'acme', repo: 'project-a', path: '.' }],
      },
    })
    expect(
      (
        await readCentralProjectLayout({
          configPath: 'config.yml',
          cwd: root,
          project: 'project-b',
        })
      ).layout,
    ).toEqual({})
  })

  it('readCentralProjectLayout rejects unknown, ambiguous and invalid entries', async () => {
    await fs.writeFile(
      join(root, 'config.yml'),
      [
        'projects:',
        '  - { name: p, root: ./p, host: h1 }',
        '  - { name: p, root: ./p2, host: h2, exclude: [x] }',
        '  - { name: bad, root: ./b, run_dirs: ["logs/**"] }',
        '',
      ].join('\n'),
    )
    const read = (project: string, host?: string) =>
      readCentralProjectLayout({ configPath: 'config.yml', cwd: root, project, host })
    await expect(read('missing')).rejects.toBeInstanceOf(ConfigError)
    await expect(read('p')).rejects.toThrow(/ambiguous/)
    expect((await read('p', 'h2')).layout).toEqual({ exclude: ['x'] })
    await expect(read('bad')).rejects.toThrow(/run_dirs/)
    await expect(
      readCentralProjectLayout({ configPath: 'nope.yml', cwd: root, project: 'p' }),
    ).rejects.toBeInstanceOf(ConfigError)
  })
})
