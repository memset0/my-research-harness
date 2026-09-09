import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { applyMembershipMigration, planMembershipMigration, rollbackMembershipMigration } from './v6-to-v7.js'

const roots: string[] = []
const run = 'trial-260908-120000'

async function fixture() {
  const base = await fs.mkdtemp(join(tmpdir(), 'memon-membership-'))
  roots.push(base)
  const root = join(base, 'project')
  await fs.mkdir(join(root, 'logs', run), { recursive: true })
  await fs.mkdir(join(root, 'docs/experiments/E0001-trial'), { recursive: true })
  await fs.mkdir(join(root, '.memon'), { recursive: true })
  await fs.writeFile(join(root, '.memon/version.json'), '{"fs_convention_version":6}\n')
  const experiment = join(root, 'docs/experiments/E0001-trial/README.md')
  const readme = join(root, 'logs', run, 'README.md')
  await fs.writeFile(experiment, `---\nid: E0001-trial\nruns: [${run}] # members\ncustom: 'keep me'\n---\nUnchanged body\n`)
  await fs.writeFile(readme, `---\nexperiment: E0001-trial\ncustom: 'keep me'\n---\nUnchanged run body\n`)
  return { root, base, experiment, readme }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('FS v6 to v7 membership migration', () => {
  it('refuses dirty Git worktrees without the explicit scoped override', async () => {
    const { root, base } = await fixture()
    execFileSync('git', ['init', '-q'], { cwd: root })
    const plan = await planMembershipMigration(root)
    await expect(applyMembershipMigration(plan, join(base, 'backup'))).rejects.toThrow('Dirty worktree')
    expect(JSON.parse(await fs.readFile(join(root, '.memon/version.json'), 'utf8')).fs_convention_version).toBe(6)
  })

  it('resumes an interrupted plan and rolls back only its own postimages', async () => {
    const { root, base } = await fixture()
    const plan = await planMembershipMigration(root, { allowDirty: true })
    const first = plan.files[0]!
    await fs.writeFile(join(root, first.path), first.after)
    const backup = join(base, 'backup')
    await applyMembershipMigration(plan, backup)
    await fs.writeFile(join(root, 'unrelated.txt'), 'keep this')
    await rollbackMembershipMigration(backup)
    for (const file of plan.files) expect(await fs.readFile(join(root, file.path), 'utf8')).toBe(file.before)
    expect(await fs.readFile(join(root, 'unrelated.txt'), 'utf8')).toBe('keep this')
  })

  it('refuses rollback when a migrated file has subsequently changed', async () => {
    const { root, base, readme } = await fixture()
    const plan = await planMembershipMigration(root, { allowDirty: true })
    const backup = join(base, 'backup')
    await applyMembershipMigration(plan, backup)
    await fs.appendFile(readme, 'new note\n')
    await expect(rollbackMembershipMigration(backup)).rejects.toThrow('Concurrent edit')
    expect(await fs.readFile(readme, 'utf8')).toContain('new note')
    expect(JSON.parse(await fs.readFile(join(root, '.memon/version.json'), 'utf8')).fs_convention_version).toBe(7)
  })

  it('migrates declarations and results, preserving unrelated bytes, and is idempotent', async () => {
    const { root, base, experiment, readme } = await fixture()
    const results = join(root, 'docs/experiments/E0001-trial/results.yaml')
    await fs.writeFile(results, `variants:\n  - id: V0001\n    runs: [${run}] # evidence\n    attempts: []\ncustom: 'keep me'\n`)
    const plan = await planMembershipMigration(root, { allowDirty: true })
    expect(plan.blockers).toEqual([])
    await applyMembershipMigration(plan, join(base, 'backup'))
    expect(await fs.readFile(experiment, 'utf8')).toContain(`runs: ["logs/${run}"] # members`)
    expect(await fs.readFile(readme, 'utf8')).toBe("---\ncustom: 'keep me'\n---\nUnchanged run body\n")
    expect(await fs.readFile(results, 'utf8')).toContain(`runs: ["logs/${run}"] # evidence`)
    const second = await planMembershipMigration(root, { allowDirty: true })
    expect(second.blockers).toEqual([])
    expect(second.files.filter((file) => file.before !== file.after)).toEqual([])
    expect(JSON.parse(await fs.readFile(join(base, 'backup/plan.json'), 'utf8')).files).toEqual(plan.files)
  })

  it('requires explicit permission to discard Run-only ownership', async () => {
    const { root, base, experiment, readme } = await fixture()
    await fs.writeFile(experiment, '---\nid: E0001-trial\nruns: []\n---\n')
    expect((await planMembershipMigration(root)).blockers).toHaveLength(1)
    const plan = await planMembershipMigration(root, { allowDirty: true, dropRunOnlyClaims: true })
    expect(plan.droppedClaims).toEqual([`logs/${run}`])
    await applyMembershipMigration(plan, join(base, 'backup'))
    expect(await fs.readFile(experiment, 'utf8')).toContain('runs: []')
    expect(await fs.readFile(readme, 'utf8')).not.toContain('experiment:')
  })

  it('refuses a stale plan without modifying any file', async () => {
    const { root, base, readme } = await fixture()
    const plan = await planMembershipMigration(root, { allowDirty: true })
    await fs.appendFile(readme, 'Concurrent research note\n')
    await expect(applyMembershipMigration(plan, join(base, 'backup'))).rejects.toThrow('Stale migration plan')
    expect(JSON.parse(await fs.readFile(join(root, '.memon/version.json'), 'utf8')).fs_convention_version).toBe(6)
    expect(await fs.readFile(readme, 'utf8')).toContain('Concurrent research note')
  })

  it('blocks duplicate basenames instead of choosing the newest Run', async () => {
    const { root } = await fixture()
    await fs.mkdir(join(root, 'outputs', run), { recursive: true })
    await fs.writeFile(join(root, 'outputs', run, 'README.md'), '---\n---\n')
    expect((await planMembershipMigration(root)).blockers.join('\n')).toContain('ambiguous Run reference')
  })

  it('rejects traversal and leaves an unreferenced missing README alone', async () => {
    const { root, experiment } = await fixture()
    await fs.mkdir(join(root, 'logs/empty-260908-130000'))
    await fs.writeFile(experiment, `---\nruns: [../logs/${run}]\n---\n`)
    const plan = await planMembershipMigration(root)
    expect(plan.blockers.join('\n')).toContain('Unresolved')
    expect(plan.warnings).toHaveLength(1)
  })
})
