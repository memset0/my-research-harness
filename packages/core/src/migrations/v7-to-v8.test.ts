import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { execFileGitCommand, type GitCommandRunner } from '../git/command.js'
import {
  applyDerivedIndexMigration,
  planDerivedIndexMigration,
  rollbackDerivedIndexMigration,
  V7_TO_V8_COMMIT_MESSAGE,
  verifyDerivedIndexMigration,
} from './v7-to-v8.js'

const roots: string[] = []
const MARKER_V7 =
  '{\n  "fs_convention_version": 7,\n  "installed_at": "2026-09-01T09:00:00+08:00",\n  "last_migrated_at": null,\n  "custom": "keep"\n}\n'

const runReadme = (id: string) =>
  `---\nid: ${id}\nstatus: FINISHED\ncreated_at: '2026-09-01T09:00:00+08:00'\nupdated_at: '2026-09-01T09:00:00+08:00'\n---\n`

const git = (root: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

async function fixture(options: { git?: boolean; deep?: boolean; declaration?: string } = {}) {
  const base = await fs.mkdtemp(join(tmpdir(), 'memon-v7-v8-'))
  roots.push(base)
  const root = join(base, 'project')
  const runs = [
    'logs/top-260901-090000',
    ...(options.deep ? ['outputs/group/deep-260901-100000'] : []),
  ]
  for (const run of runs) {
    await fs.mkdir(join(root, run), { recursive: true })
    await fs.writeFile(join(root, run, 'README.md'), runReadme(run.split('/').pop()!))
  }
  await fs.mkdir(join(root, 'docs/experiments/E0001-probe'), { recursive: true })
  await fs.writeFile(
    join(root, 'docs/experiments/E0001-probe/README.md'),
    `---\nid: E0001-probe\nslug: probe\ntitle: Probe\nstatus: OPEN\nruns: [${runs.map((run) => `"${run}"`).join(', ')}]\n---\n`,
  )
  await fs.mkdir(join(root, '.memon'), { recursive: true })
  await fs.writeFile(join(root, '.memon/version.json'), MARKER_V7)
  if (options.declaration !== undefined)
    await fs.writeFile(join(root, '.memon/project.yml'), options.declaration)
  if (options.git) {
    git(root, 'init', '-q', '-b', 'main')
    git(root, 'config', 'user.email', 'test@example.invalid')
    git(root, 'config', 'user.name', 'memon test')
    git(root, 'config', 'commit.gpgsign', 'false')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'init')
  }
  return { root: await fs.realpath(root), backup: join(base, 'backup') }
}

async function snapshotOfDocuments(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  async function walk(dir: string, prefix: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (rel === '.git' || rel === '.memon') continue
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel)
      else out[rel] = await fs.readFile(join(dir, entry.name), 'utf8')
    }
  }
  await walk(root, '')
  return out
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('FS v7 to v8 derived-index migration', () => {
  it('plans read-only and lists deep Runs as acknowledged warnings', async () => {
    const { root } = await fixture({ git: true, deep: true })
    const plan = await planDerivedIndexMigration(root)
    expect(plan).toMatchObject({
      from: 7,
      alreadyMigrated: false,
      git: true,
      blockers: [],
      declarationPresent: false,
      indexPresent: false,
      runDirs: { source: 'default' },
      outsideRunDirs: ['outputs/group/deep-260901-100000'],
    })
    expect(plan.warnings.join('\n')).toContain('memon project init')
    expect(await fs.readdir(join(root, '.memon'))).toEqual(['version.json'])
    await expect(applyDerivedIndexMigration(plan, join(root, '..', 'b0'))).rejects.toThrow(
      /acknowledge/,
    )
  })

  it('reports nothing for deep Runs covered by an existing declaration', async () => {
    const { root } = await fixture({
      deep: true,
      declaration: "schema_version: 1\nrun_dirs: ['logs/*', 'outputs/*/*']\n",
    })
    const plan = await planDerivedIndexMigration(root)
    expect(plan.runDirs?.source).toBe('project')
    expect(plan.outsideRunDirs).toEqual([])
    expect(plan.warnings).toEqual([])
  })

  it('applies in Git mode: commit holds only the marker, documents unchanged, then rolls back and re-applies', async () => {
    const { root, backup } = await fixture({ git: true, deep: true })
    const before = await snapshotOfDocuments(root)
    const plan = await planDerivedIndexMigration(root)
    const result = await applyDerivedIndexMigration(plan, backup, { acknowledgeWarnings: true })
    expect(result.status).toBe('migrated')
    expect(git(root, 'log', '-1', '--format=%s')).toBe(V7_TO_V8_COMMIT_MESSAGE)
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD')).toBe('.memon/version.json')
    expect(git(root, 'status', '--porcelain')).toBe('')
    expect(await snapshotOfDocuments(root)).toEqual(before)
    const marker = JSON.parse(await fs.readFile(join(root, '.memon/version.json'), 'utf8'))
    expect(marker).toMatchObject({ fs_convention_version: 8, custom: 'keep' })
    expect(await fs.readFile(join(root, '.memon/index/.gitignore'), 'utf8')).toBe('*\n')
    await expect(fs.stat(join(root, '.memon/project.yml'))).rejects.toThrow()
    expect(await verifyDerivedIndexMigration(root, { declarationExpected: false })).toMatchObject({
      ok: true,
      marker: 8,
    })
    expect((await fs.readdir(backup)).sort()).toEqual(['memon', 'plan.json', 'receipt.json'])

    const rolled = await rollbackDerivedIndexMigration(backup)
    expect(rolled.marker).toBe('reverted')
    expect(await fs.readFile(join(root, '.memon/version.json'), 'utf8')).toBe(MARKER_V7)
    await expect(fs.stat(join(root, '.memon/index'))).rejects.toThrow()
    expect(git(root, 'status', '--porcelain')).toBe('')

    const again = await planDerivedIndexMigration(root)
    expect(again.from).toBe(7)
    const second = await applyDerivedIndexMigration(again, `${backup}-2`, {
      acknowledgeWarnings: true,
    })
    expect(second.status).toBe('migrated')
    expect((await verifyDerivedIndexMigration(root)).ok).toBe(true)

    // Re-running on a migrated project only refreshes the index.
    const refreshed = await applyDerivedIndexMigration(
      await planDerivedIndexMigration(root),
      null,
      { acknowledgeWarnings: true },
    )
    expect(refreshed).toMatchObject({ status: 'refreshed', commit: null })
    expect(git(root, 'log', '--format=%s').split('\n')[0]).toBe(V7_TO_V8_COMMIT_MESSAGE)
  })

  it('refuses a dirty Git worktree unless approved', async () => {
    const { root } = await fixture({ git: true })
    await fs.writeFile(join(root, 'notes.txt'), 'wip\n')
    expect((await planDerivedIndexMigration(root)).blockers.join()).toMatch(/dirty/)
    expect((await planDerivedIndexMigration(root, { allowDirty: true })).blockers).toEqual([])
  })

  it('blocks a project that is not at v7 and an invalid declaration', async () => {
    const { root } = await fixture()
    await fs.writeFile(
      join(root, '.memon/version.json'),
      '{"fs_convention_version":6,"installed_at":"2026-09-01T09:00:00+08:00","last_migrated_at":null}\n',
    )
    expect((await planDerivedIndexMigration(root)).blockers.join()).toMatch(/v6/)
    const other = await fixture({ declaration: 'schema_version: 1\nwalk_depth: 3\n' })
    expect((await planDerivedIndexMigration(other.root)).blockers.join()).toMatch(
      /PROJECT_DECLARATION_INVALID/,
    )
  })

  it('refuses a stale marker; outside Git the marker bytes are restored on rollback', async () => {
    const { root, backup } = await fixture()
    const plan = await planDerivedIndexMigration(root)
    expect(plan.git).toBe(false)
    // A stale marker makes apply fail before anything is written.
    await fs.writeFile(join(root, '.memon/version.json'), MARKER_V7.replace('keep', 'edited'))
    await expect(applyDerivedIndexMigration(plan, backup)).rejects.toThrow(/Stale/)
    await fs.writeFile(join(root, '.memon/version.json'), MARKER_V7)

    const result = await applyDerivedIndexMigration(plan, backup)
    expect(result).toMatchObject({ status: 'migrated', commit: null })
    const rolled = await rollbackDerivedIndexMigration(backup)
    expect(rolled.marker).toBe('restored')
    expect(await fs.readFile(join(root, '.memon/version.json'), 'utf8')).toBe(MARKER_V7)
    await expect(fs.stat(join(root, '.memon/index'))).rejects.toThrow()
  })

  it('keeps marker 7, makes no commit and restores the index when verification fails', async () => {
    const { root, backup } = await fixture({ git: true })
    // The snapshot is reported as not ignored: verification fails after the rebuild.
    const failingCheckIgnore: GitCommandRunner = (bin, args, opts) =>
      args[0] === 'check-ignore'
        ? Promise.resolve({ stdout: '', stderr: '', code: 1 })
        : execFileGitCommand(bin, args, opts)
    const plan = await planDerivedIndexMigration(root)
    await expect(
      applyDerivedIndexMigration(plan, backup, { git: failingCheckIgnore }),
    ).rejects.toThrow(/not ignored/)
    expect(await fs.readFile(join(root, '.memon/version.json'), 'utf8')).toBe(MARKER_V7)
    await expect(fs.stat(join(root, '.memon/index'))).rejects.toThrow()
    expect(git(root, 'log', '--format=%s')).toBe('init')
  })
})
