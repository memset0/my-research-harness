import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  allowRulesCommand,
  gitCheckIgnore,
  planResultAllowRules,
  RESULT_ALLOW_RULES_COMMENT,
  resolveRunRealPath,
  resultFileIgnoredWarning,
  runLocationOf,
} from './ignore.js'

const roots: string[] = []

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

async function project(options: {
  git?: boolean
  gitignore?: string
  files?: Record<string, string>
  runs?: string[]
}) {
  const base = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'memon-ignore-')))
  roots.push(base)
  const root = join(base, 'project')
  const runs = options.runs ?? ['logs/a-260901-090000', 'logs/b-260901-090000']
  for (const run of runs) {
    await fs.mkdir(join(root, run), { recursive: true })
    await fs.writeFile(join(root, run, 'README.md'), '---\nstatus: FINISHED\n---\n')
    await fs.writeFile(join(root, run, 'train.log'), 'log\n')
  }
  if (options.gitignore !== undefined)
    await fs.writeFile(join(root, '.gitignore'), options.gitignore)
  for (const [path, content] of Object.entries(options.files ?? {})) {
    await fs.mkdir(join(root, path, '..'), { recursive: true })
    await fs.writeFile(join(root, path), content)
  }
  if (options.git !== false) git(root, 'init', '-q', '-b', 'main')
  return { root, runs }
}

async function append(root: string, file: string, lines: readonly string[]) {
  const path = join(root, file)
  const before = await fs.readFile(path, 'utf8').catch(() => '')
  await fs.writeFile(
    path,
    `${before}${before && !before.endsWith('\n') ? '\n' : ''}${lines.join('\n')}\n`,
  )
}

const untracked = (root: string) =>
  git(root, 'ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean).sort()

const IGNORE_FILES = ['.gitignore', 'logs/.gitignore', '.git/info/exclude']

async function ignoreFileBytes(root: string): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  for (const file of IGNORE_FILES)
    out[file] = await fs.readFile(join(root, file), 'utf8').catch(() => null)
  return out
}

async function assertRulesTrackOnlyResultFiles(root: string, runs: readonly string[]) {
  const before = untracked(root)
  const bytes = await ignoreFileBytes(root)
  const plan = await planResultAllowRules({ projectRoot: root, runs, runDirs: ['logs/*'] })
  // The computation itself never touches an ignore file.
  expect(await ignoreFileBytes(root)).toEqual(bytes)
  for (const run of runs) await fs.writeFile(join(root, run, 'result.csv'), 'path,stat,value\n')
  for (const target of plan!.targets) await append(root, target.file, target.lines)
  const decisions = await gitCheckIgnore(
    root,
    runs.map((run) => `${run}/result.csv`),
  )
  expect(decisions.every((decision) => !decision.ignored)).toBe(true)
  const newlyVisible = untracked(root).filter((path) => !before.includes(path))
  const planned = [
    ...runs.map((run) => `${run}/result.csv`),
    ...plan!.targets.map((target) => target.file),
  ]
  expect(newlyVisible.filter((path) => !planned.includes(path))).toEqual([])
  return plan!
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('planResultAllowRules', () => {
  it('adds one negation when files inside Run directories are ignored', async () => {
    const gitignore = 'logs/*/*\n!logs/*/README.md\n'
    const { root, runs } = await project({ gitignore })
    const plan = await planResultAllowRules({ projectRoot: root, runs, runDirs: ['logs/*'] })
    expect(plan!.targets).toEqual([
      {
        file: '.gitignore',
        lines: [RESULT_ALLOW_RULES_COMMENT, '!/logs/*/result.csv'],
        overrides: ['.gitignore:1:logs/*/*'],
        locations: ['logs/*'],
        runs,
        command: `printf '%s\\n' '${RESULT_ALLOW_RULES_COMMENT}' '!/logs/*/result.csv' >> '.gitignore'`,
      },
    ])
    expect(plan!.ignored.map((entry) => entry.excludedDirectory)).toEqual([null, null])
    expect(await fs.readFile(join(root, '.gitignore'), 'utf8')).toBe(gitignore)
    await assertRulesTrackOnlyResultFiles(root, runs)
  })

  it('builds the re-inclusion ladder below an excluded logs/ directory', async () => {
    const { root, runs } = await project({
      gitignore: 'logs/\n',
      files: { 'logs/notes.txt': 'x\n', 'logs/scratch/data.bin': 'x\n' },
    })
    const plan = await planResultAllowRules({ projectRoot: root, runs, runDirs: ['logs/*'] })
    expect(plan!.targets[0]!.lines).toEqual([
      RESULT_ALLOW_RULES_COMMENT,
      '!/logs/',
      '/logs/*',
      '!/logs/*/',
      '/logs/*/*',
      '!/logs/*/result.csv',
    ])
    expect(plan!.ignored[0]!.excludedDirectory).toBe('logs')
    await assertRulesTrackOnlyResultFiles(root, runs)
  })

  it('builds a shorter ladder when the Run directories themselves are excluded', async () => {
    const { root, runs } = await project({ gitignore: 'logs/*/\n' })
    const plan = await planResultAllowRules({ projectRoot: root, runs, runDirs: ['logs/*'] })
    expect(plan!.targets[0]!.lines).toEqual([
      RESULT_ALLOW_RULES_COMMENT,
      '!/logs/*/',
      '/logs/*/*',
      '!/logs/*/result.csv',
    ])
    await assertRulesTrackOnlyResultFiles(root, runs)
  })

  it('targets a deciding .gitignore nested in the project with paths relative to it', async () => {
    const { root, runs } = await project({ files: { 'logs/.gitignore': '*/*\n!*/README.md\n' } })
    const plan = await planResultAllowRules({ projectRoot: root, runs, runDirs: ['logs/*'] })
    expect(plan!.targets).toMatchObject([
      {
        file: 'logs/.gitignore',
        lines: [RESULT_ALLOW_RULES_COMMENT, '!/*/result.csv'],
        overrides: ['logs/.gitignore:1:*/*'],
      },
    ])
    await assertRulesTrackOnlyResultFiles(root, runs)
  })

  it('targets the root .gitignore for a rule in .git/info/exclude', async () => {
    const { root, runs } = await project({})
    await fs.writeFile(join(root, '.git/info/exclude'), 'logs/\n')
    const plan = await planResultAllowRules({ projectRoot: root, runs, runDirs: ['logs/*'] })
    expect(plan!.targets[0]).toMatchObject({
      file: '.gitignore',
      overrides: ['.git/info/exclude:1:logs/'],
    })
    expect(plan!.targets[0]!.lines[1]).toBe('!/logs/')
    await assertRulesTrackOnlyResultFiles(root, runs)
  })

  it('targets the project .gitignore for a rule in a .gitignore above the project root', async () => {
    const base = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'memon-ignore-')))
    roots.push(base)
    const root = join(base, 'repo', 'project')
    const runs = ['logs/a-260901-090000']
    await fs.mkdir(join(root, runs[0]!), { recursive: true })
    await fs.writeFile(join(root, runs[0]!, 'README.md'), 'x\n')
    await fs.writeFile(join(base, 'repo', '.gitignore'), 'logs/\n')
    git(join(base, 'repo'), 'init', '-q', '-b', 'main')
    const plan = await planResultAllowRules({ projectRoot: root, runs, runDirs: ['logs/*'] })
    expect(plan!.targets[0]).toMatchObject({ file: '.gitignore' })
    expect(plan!.targets[0]!.overrides[0]).toMatch(/repo\/\.gitignore:1:logs\/$/)
    await assertRulesTrackOnlyResultFiles(root, runs)
  })

  it('merges ladders of several locations without undoing a re-inclusion', async () => {
    const { root, runs } = await project({
      gitignore: 'logs/\n',
      runs: ['logs/a-260901-090000', 'logs/sub/b-260901-090000'],
    })
    const plan = await planResultAllowRules({ projectRoot: root, runs })
    expect(plan!.targets[0]!.lines).toEqual([
      RESULT_ALLOW_RULES_COMMENT,
      '!/logs/',
      '/logs/*',
      '!/logs/*/',
      '!/logs/sub/',
      '/logs/*/*',
      '/logs/sub/*',
      '!/logs/sub/*/',
      '/logs/sub/*/*',
      '!/logs/*/result.csv',
      '!/logs/sub/*/result.csv',
    ])
    const before = untracked(root)
    for (const run of runs) await fs.writeFile(join(root, run, 'result.csv'), 'path,stat,value\n')
    await append(root, '.gitignore', plan!.targets[0]!.lines)
    expect(untracked(root).filter((path) => !before.includes(path))).toEqual([
      'logs/a-260901-090000/result.csv',
      'logs/sub/b-260901-090000/result.csv',
    ])
  })

  it('makes no check outside a Git work tree and plans nothing for tracked rules', async () => {
    const outside = await project({ git: false, gitignore: 'logs/\n' })
    expect(await planResultAllowRules({ projectRoot: outside.root, runs: outside.runs })).toBeNull()
    const open = await project({ gitignore: 'node_modules/\n' })
    expect(
      (await planResultAllowRules({ projectRoot: open.root, runs: open.runs }))!.targets,
    ).toEqual([])
  })
})

describe('symlinked Run paths', () => {
  it('probes and covers a symlinked Run at its real path inside the project', async () => {
    const { root } = await project({
      gitignore: 'logs/*/*\n!logs/*/README.md\n',
      runs: ['logs/real-20260901-090000'],
    })
    await fs.symlink('real-20260901-090000', join(root, 'logs/a-260901-090000'))
    // git check-ignore itself rejects the declared path.
    await expect(gitCheckIgnore(root, ['logs/a-260901-090000/result.csv'])).rejects.toThrow(
      /beyond a symbolic link/,
    )
    expect(await resolveRunRealPath(root, 'logs/a-260901-090000')).toEqual({
      kind: 'inside',
      run: 'logs/a-260901-090000',
      real: 'logs/real-20260901-090000',
    })
    const plan = await planResultAllowRules({
      projectRoot: root,
      runs: ['logs/a-260901-090000', 'logs/real-20260901-090000'],
      runDirs: ['logs/*'],
    })
    expect(plan!.outside).toEqual([])
    expect(plan!.ignored).toEqual([
      expect.objectContaining({
        run: 'logs/real-20260901-090000',
        declaredAs: ['logs/a-260901-090000'],
        file: 'logs/real-20260901-090000/result.csv',
      }),
    ])
    expect(plan!.targets[0]!.lines).toEqual([RESULT_ALLOW_RULES_COMMENT, '!/logs/*/result.csv'])
    const warning = await resultFileIgnoredWarning({
      projectRoot: root,
      run: 'logs/a-260901-090000',
    })
    expect(warning?.details.file).toBe('logs/real-20260901-090000/result.csv')
  })

  it('reports a symlinked Run whose target leaves the project and never probes it', async () => {
    const { root } = await project({ files: { '.gitignore': 'logs/*/*\n' }, runs: [] })
    const elsewhere = join(root, '..', 'elsewhere-260901-090000')
    await fs.mkdir(elsewhere, { recursive: true })
    await fs.mkdir(join(root, 'logs'), { recursive: true })
    await fs.symlink(elsewhere, join(root, 'logs/a-260901-090000'))
    expect((await resolveRunRealPath(root, 'logs/a-260901-090000')).kind).toBe('outside')
    const probed: string[] = []
    const plan = await planResultAllowRules({
      projectRoot: root,
      runs: ['logs/a-260901-090000'],
      checkIgnore: async (projectRoot, paths) => {
        probed.push(...paths)
        return gitCheckIgnore(projectRoot, paths)
      },
    })
    expect(plan!.outside).toEqual([{ run: 'logs/a-260901-090000', target: elsewhere }])
    expect(plan!.targets).toEqual([])
    expect(probed).toEqual([])
  })
})

describe('resultFileIgnoredWarning', () => {
  it('names the deciding rule and the command for an ignored new result file', async () => {
    const { root } = await project({
      gitignore: 'logs/*/*\n!logs/*/README.md\n',
      runs: ['logs/a-260901-090000'],
    })
    const warning = await resultFileIgnoredWarning({
      projectRoot: root,
      run: 'logs/a-260901-090000',
    })
    expect(warning).toMatchObject({
      code: 'RESULT_FILE_IGNORED',
      severity: 'warning',
      file: 'logs/a-260901-090000/result.csv',
      details: {
        rule: '.gitignore:1:logs/*/*',
        target: '.gitignore',
        lines: [RESULT_ALLOW_RULES_COMMENT, '!/logs/*/result.csv'],
      },
    })
    expect(warning!.details.command).toContain("'!/logs/*/result.csv' >> '.gitignore'")
  })

  it('returns null for a tracked location and outside Git', async () => {
    const tracked = await project({ gitignore: '', runs: ['logs/a-260901-090000'] })
    expect(
      await resultFileIgnoredWarning({ projectRoot: tracked.root, run: 'logs/a-260901-090000' }),
    ).toBeNull()
    const outside = await project({ git: false, runs: ['logs/a-260901-090000'] })
    expect(
      await resultFileIgnoredWarning({ projectRoot: outside.root, run: 'logs/a-260901-090000' }),
    ).toBeNull()
  })
})

describe('helpers', () => {
  it('derives the Run location and the append command', () => {
    expect(runLocationOf('outputs/sweep/a-260901-090000', ['logs/*', 'outputs/*/*'])).toBe(
      'outputs/*/*',
    )
    expect(runLocationOf('logs/sub/a-260901-090000', ['logs/*'])).toBe('logs/sub/*')
    expect(allowRulesCommand('.gitignore', ["it's"])).toBe(
      `printf '%s\\n' 'it'\\''s' >> '.gitignore'`,
    )
  })
})
