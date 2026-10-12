import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createTempProject, git, initGitRepo, makeTempDir, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyResearchMigration,
  planResearchMigration,
  rollbackResearchMigration,
  verifyResearchMigration,
} from './v9-to-v10.js'

const RUN = 'logs/trial-261001-100000'
const ID = 'E0001-example'
const DOC = `docs/experiments/${ID}/experiment.json`
const MARKER = '.memon/version.json'
const readme = `---\nid: ${ID}\nslug: example\ntitle: Example\nstatus: OPEN\narchived: false\nruns: [${RUN}]\ncreated_at: '2026-10-01T10:00:00+08:00'\nupdated_at: '2026-10-01T10:00:00+08:00'\ncustom: preserve\n---\n\n## Motivation\nOriginal explanation.\n`
const runReadme = '---\nid: trial-261001-100000\nstatus: FINISHED\n---\nOriginal execution.\n'
const csv = 'path,stat,value\n$experiment_schema_version,,1\nmetrics.score,,0.8\n'
const description = {
  experiment_schema_version: 1,
  groups: {},
  columns: [{ path: 'metrics.score', type: 'number', label: 'Score' }],
  variants: [
    {
      id: 'V0001',
      name: 'Baseline',
      values: {},
      runs: [RUN],
      custom: { keep: true },
      frozen: { runs: [], values: [], attempts: ['logs/old-261001-090000'] },
    },
  ],
  custom: { source: 'retained' },
}
async function fixture() {
  return createTempProject({
    experiments: {
      [ID]: { 'README.md': readme, 'experiment.json': JSON.stringify(description, null, 2) },
    },
    runs: { [RUN]: { 'README.md': runReadme, 'result.csv': csv } },
    files: {
      [MARKER]:
        '{"fs_convention_version":9,"installed_at":"2026-10-01T10:00:00+08:00","custom":true}\n',
    },
  })
}
async function backupPath() {
  return join(await makeTempDir(), 'backup')
}
afterEach(async () => {
  vi.restoreAllMocks()
  await removeTempDirs()
})

describe('FS9 to FS10 explicit migration', () => {
  it('preserves execution bytes, unknown fields, frozen attempts, modes and schema; rollback restores exact source', async () => {
    const project = await fixture()
    await fs.chmod(project.path(DOC), 0o640)
    const original = await fs.readFile(project.path(DOC), 'utf8')
    const marker = await fs.readFile(project.path(MARKER), 'utf8')
    const plan = await planResearchMigration(project.root)
    expect(plan.blockers).toEqual([])
    expect(plan.files.map((f) => f.path)).toEqual([DOC, MARKER])
    expect(await fs.readFile(project.path(DOC), 'utf8')).toBe(original)
    const backup = await backupPath()
    await applyResearchMigration(plan, backup)
    const next = JSON.parse(await fs.readFile(project.path(DOC), 'utf8'))
    expect(next.experiment_schema_version).toBe(1)
    expect(next.research.current_version).toBe(1)
    expect(next.research.run_versions).toEqual({ [RUN]: 1 })
    expect(next.custom).toEqual(description.custom)
    expect(next.variants.V0001.custom).toEqual({ keep: true })
    expect(next.variants.V0001.frozen.attempts).toEqual(['logs/old-261001-090000'])
    expect(next.variants.V0001.runs).toEqual([RUN])
    expect(await fs.readFile(project.path(RUN, 'README.md'), 'utf8')).toBe(runReadme)
    expect(await fs.readFile(project.path(RUN, 'result.csv'), 'utf8')).toBe(csv)
    expect(await fs.readFile(project.path(`docs/experiments/${ID}/README.md`), 'utf8')).toBe(readme)
    expect((await fs.stat(project.path(DOC))).mode & 0o777).toBe(0o640)
    expect(await verifyResearchMigration(project.root)).toEqual({ ok: true, problems: [] })
    const repeated = await planResearchMigration(project.root)
    expect(repeated.alreadyMigrated).toBe(true)
    expect((await applyResearchMigration(repeated, await backupPath())).status).toBe('unchanged')
    await rollbackResearchMigration(backup)
    expect(await fs.readFile(project.path(DOC), 'utf8')).toBe(original)
    expect(await fs.readFile(project.path(MARKER), 'utf8')).toBe(marker)
  })

  it('refuses a stale plan after an execution result changes, even with its mtime restored', async () => {
    const project = await fixture()
    const file = project.path(RUN, 'result.csv')
    const stat = await fs.stat(file)
    const plan = await planResearchMigration(project.root)
    await fs.writeFile(file, csv.replace('0.8', '0.9'))
    await fs.utimes(file, stat.atime, stat.mtime)
    await expect(applyResearchMigration(plan, await backupPath())).rejects.toThrow(
      'Concurrent edit',
    )
    expect(JSON.parse(await fs.readFile(project.path(MARKER), 'utf8')).fs_convention_version).toBe(
      9,
    )
  })

  it('does not collapse duplicate IDs or accept a missing description', async () => {
    const project = await fixture()
    await fs.writeFile(
      project.path(DOC),
      JSON.stringify({
        ...description,
        variants: [...description.variants, ...description.variants],
      }),
    )
    expect((await planResearchMigration(project.root)).blockers.join()).toMatch(/duplicate/i)
    await fs.rm(project.path(DOC))
    expect((await planResearchMigration(project.root)).blockers.join()).toMatch(/required/)
  })

  it('rejects newly added experiments and modified planned outputs', async () => {
    const project = await fixture()
    const plan = await planResearchMigration(project.root)
    plan.files[0]!.after = plan.files[0]!.after.replace('Baseline', 'tampered')
    await expect(applyResearchMigration(plan, await backupPath())).rejects.toThrow(
      'modified migration plan',
    )
    const fresh = await planResearchMigration(project.root)
    await fs.mkdir(project.path('docs/experiments/E0002-new'))
    await expect(applyResearchMigration(fresh, await backupPath())).rejects.toThrow('Stale')
  })

  it('rolls back a partial write when marker publication fails', async () => {
    const project = await fixture()
    const original = await fs.readFile(project.path(DOC), 'utf8')
    const plan = await planResearchMigration(project.root)
    const rename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).endsWith('/version.json')) throw new Error('simulated marker failure')
      return rename(from, to)
    })
    await expect(applyResearchMigration(plan, await backupPath())).rejects.toThrow(
      'simulated marker failure',
    )
    expect(await fs.readFile(project.path(DOC), 'utf8')).toBe(original)
    expect(JSON.parse(await fs.readFile(project.path(MARKER), 'utf8')).fs_convention_version).toBe(
      9,
    )
  })

  it('refuses rollback over subsequent user changes', async () => {
    const project = await fixture()
    const backup = await backupPath()
    await applyResearchMigration(await planResearchMigration(project.root), backup)
    const edited = `${await fs.readFile(project.path(DOC), 'utf8')} `
    await fs.writeFile(project.path(DOC), edited)
    await expect(rollbackResearchMigration(backup)).rejects.toThrow('Concurrent edit')
    expect(await fs.readFile(project.path(DOC), 'utf8')).toBe(edited)
    expect(JSON.parse(await fs.readFile(project.path(MARKER), 'utf8')).fs_convention_version).toBe(
      10,
    )
  })

  it('rejects external symlinks before reading or changing them', async () => {
    const project = await fixture()
    const outside = await makeTempDir()
    await fs.writeFile(join(outside, 'secret.json'), JSON.stringify(description))
    await fs.rm(project.path(DOC))
    await fs.symlink(join(outside, 'secret.json'), project.path(DOC))
    expect((await planResearchMigration(project.root)).blockers.join()).toMatch(/escapes project/)
  })

  it('refuses a dirty Git worktree by default without staging anything', async () => {
    const project = await fixture()
    await initGitRepo(project.root)
    expect((await planResearchMigration(project.root)).blockers.join()).toMatch(/Dirty worktree/)
    expect(await git(project.root, 'diff', '--cached', '--name-only')).toBe('')
    expect((await planResearchMigration(project.root, { allowDirty: true })).blockers).toEqual([])
  })

  it('handles an empty project without creating research documents', async () => {
    const project = await createTempProject({
      files: { [MARKER]: '{"fs_convention_version":9}\n' },
    })
    const plan = await planResearchMigration(project.root)
    expect(plan.files.map((f) => f.path)).toEqual([MARKER])
    await applyResearchMigration(plan, await backupPath())
    expect((await verifyResearchMigration(project.root)).ok).toBe(true)
    await expect(fs.stat(project.path('docs'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
