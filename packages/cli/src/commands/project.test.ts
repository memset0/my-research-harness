// `memon project init|lint` — the tracked project declaration.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProjectDeclaration } from '@memon/core'
import { ExitCalled, spyExit } from '@memon/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setRunDirs } from '../lib/discovery-options.js'
import { runProjectInit, runProjectLint } from './project.js'

let root: string
let stdout: string[]
let stderr: string[]
const real = {
  stdout: process.stdout.write.bind(process.stdout),
  stderr: process.stderr.write.bind(process.stderr),
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-project-cli-'))
  stdout = []
  stderr = []
  process.stdout.write = ((chunk: unknown) => {
    stdout.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown) => {
    stderr.push(String(chunk))
    return true
  }) as typeof process.stderr.write
})

afterEach(async () => {
  process.stdout.write = real.stdout
  process.stderr.write = real.stderr
  process.exitCode = undefined
  setRunDirs(undefined)
  await fs.rm(root, { recursive: true, force: true })
})

const base = () => ({ projectRoot: root, cwd: root, format: 'json' as const })
const declaration = join('.memon', 'project.yml')

async function tree(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...(await tree(join(dir, entry.name), rel)))
    else out.push(rel)
  }
  return out.sort()
}

describe('memon project init', () => {
  it('creates the default declaration and nothing else', async () => {
    await runProjectInit(base())
    const result = JSON.parse(stdout.join(''))
    expect(result).toMatchObject({ ok: true, created: true, committed: false })
    expect(await tree(root)).toEqual(['.memon/project.yml'])
    expect(await loadProjectDeclaration(root)).toEqual({
      schema_version: 1,
      run_dirs: ['logs/*', 'outputs/*', 'experiments/*'],
    })
  })

  it('declares the global --run-dir patterns', async () => {
    setRunDirs(['outputs/*/*'])
    await runProjectInit(base())
    expect((await loadProjectDeclaration(root))?.run_dirs).toEqual(['outputs/*/*'])
  })

  it('refuses to overwrite an existing declaration (exit 9)', async () => {
    await fs.mkdir(join(root, '.memon'))
    const original = 'schema_version: 1\n# hand edited\n'
    await fs.writeFile(join(root, declaration), original)
    const exit = spyExit()
    try {
      await expect(runProjectInit(base())).rejects.toBeInstanceOf(ExitCalled)
      expect(exit.code).toBe(9)
    } finally {
      exit.restore()
    }
    expect(stderr.join('')).toContain('CONFLICT')
    expect(await fs.readFile(join(root, declaration), 'utf8')).toBe(original)
  })
})

describe('memon project lint', () => {
  it('reports an absent declaration with the default locations', async () => {
    await runProjectLint(base())
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      ok: true,
      present: false,
      effective: { patterns: ['logs/*', 'outputs/*', 'experiments/*'], source: 'default' },
    })
    expect(process.exitCode ?? 0).toBe(0)
  })

  it('reports the declared locations and the --run-dir override', async () => {
    await fs.mkdir(join(root, '.memon'))
    await fs.writeFile(join(root, declaration), "schema_version: 1\nrun_dirs: ['outputs/*/*']\n")
    await runProjectLint(base())
    expect(JSON.parse(stdout.join('')).effective).toEqual({
      patterns: ['outputs/*/*'],
      source: 'project',
    })
    stdout = []
    setRunDirs(['logs/*'])
    await runProjectLint(base())
    expect(JSON.parse(stdout.join('')).effective).toEqual({ patterns: ['logs/*'], source: 'cli' })
  })

  it('rejects an unknown key (exit 1)', async () => {
    await fs.mkdir(join(root, '.memon'))
    await fs.writeFile(join(root, declaration), 'schema_version: 1\nwalk_depth: 3\n')
    await runProjectLint(base())
    const result = JSON.parse(stdout.join(''))
    expect(result.ok).toBe(false)
    expect(result.effective).toBeNull()
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'PROJECT_DECLARATION_INVALID', field: 'walk_depth' }),
    ])
    expect(result.diagnostics[0].message).toContain('walk_depth')
    expect(process.exitCode).toBe(1)
  })
})

describe('memon project --from-central', () => {
  const CENTRAL = [
    'projects:',
    '  - name: project-a',
    '    root: ./project-a',
    '    host: node-a',
    '    storage: local',
    '    execution: { kind: local }',
    '    run_dirs: ["outputs/*/*"]',
    '    exclude: [scratch]',
    "    github: [{ owner: acme, repo: project-a, path: '.' }]",
    '  - name: project-b',
    '    root: ./project-b',
    '    host: node-a',
    '    execution: { kind: local }',
    '',
  ].join('\n')
  let central: string
  const from = (centralProject?: string) => ({
    ...base(),
    fromCentral: central,
    ...(centralProject ? { centralProject } : {}),
  })

  beforeEach(async () => {
    central = join(root, 'central.yml')
    await fs.writeFile(central, CENTRAL)
  })

  it('init copies the central layout keys into the declaration', async () => {
    await runProjectInit(from('project-a'))
    const result = JSON.parse(stdout.join(''))
    expect(result).toMatchObject({
      ok: true,
      created: true,
      committed: false,
      fromCentral: { project: 'project-a', keys: ['run_dirs', 'exclude', 'github'] },
    })
    expect(await loadProjectDeclaration(root)).toEqual({
      schema_version: 1,
      run_dirs: ['outputs/*/*'],
      exclude: ['scratch'],
      github: [{ owner: 'acme', repo: 'project-a', path: '.' }],
    })
    expect((await tree(root)).filter((path) => path !== 'central.yml')).toEqual([
      '.memon/project.yml',
    ])
  })

  it('copies an agent entry layout without requiring a host or inventing a native root', async () => {
    await fs.writeFile(
      central,
      'projects:\n  - name: project-a\n    access: { kind: agent, connection: agent-a, project: project-a, source_identity: source-a }\n    run_dirs: ["outputs/*/*"]\n',
    )
    await runProjectInit(from('project-a'))
    const result = JSON.parse(stdout.join(''))
    expect(result.fromCentral.project).toBe('project-a')
    expect(result.fromCentral.root).toBeUndefined()
    expect(result.fromCentral.host).toBeUndefined()
    expect((await loadProjectDeclaration(root))?.run_dirs).toEqual(['outputs/*/*'])
  })

  it('init from a deployment-only entry writes the default run_dirs', async () => {
    await runProjectInit(from('project-b'))
    expect(await loadProjectDeclaration(root)).toEqual({
      schema_version: 1,
      run_dirs: ['logs/*', 'outputs/*', 'experiments/*'],
    })
  })

  it('init fails with BAD_REQUEST and writes nothing for an unknown project or bad flags', async () => {
    for (const input of [
      from('missing'),
      from(),
      { ...base(), centralProject: 'project-a' },
      { ...base(), fromCentral: join(root, 'absent.yml'), centralProject: 'project-a' },
    ]) {
      const exit = spyExit()
      try {
        await expect(runProjectInit(input)).rejects.toBeInstanceOf(ExitCalled)
        expect(exit.code).toBe(2)
      } finally {
        exit.restore()
      }
      expect(stderr.join('')).toContain('BAD_REQUEST')
      expect(await tree(root)).toEqual(['central.yml'])
    }
  })

  it('lint reports deprecated central keys and conflicts without failing', async () => {
    await fs.mkdir(join(root, '.memon'))
    await fs.writeFile(
      join(root, declaration),
      "schema_version: 1\nrun_dirs: ['outputs/*/*']\nexclude: [tmp]\n",
    )
    await runProjectLint(from('project-a'))
    const result = JSON.parse(stdout.join(''))
    expect(result.ok).toBe(true)
    expect(process.exitCode ?? 0).toBe(0)
    expect(result.layout).toMatchObject({
      exclude: ['scratch'],
      sources: { run_dirs: 'central', exclude: 'central', github: 'central', include: 'default' },
    })
    expect(
      result.diagnostics.map((d: { code: string; field: string; conflict: boolean }) => [
        d.code,
        d.field,
        d.conflict,
      ]),
    ).toEqual([
      ['CENTRAL_LAYOUT_DEPRECATED', 'run_dirs', false],
      ['CENTRAL_LAYOUT_DEPRECATED', 'exclude', true],
      ['CENTRAL_LAYOUT_DEPRECATED', 'github', false],
    ])
  })

  it('lint rejects an invalid layout key (exit 1)', async () => {
    await fs.mkdir(join(root, '.memon'))
    await fs.writeFile(join(root, declaration), 'schema_version: 1\nexclude: scratch\n')
    await runProjectLint(base())
    const result = JSON.parse(stdout.join(''))
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'PROJECT_DECLARATION_INVALID', field: 'exclude' }),
    ])
    expect(process.exitCode).toBe(1)
  })
})
