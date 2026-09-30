import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyDigestWikiMigration, verifyDigestWikiMigration } from './digests-to-wiki.js'
import {
  applyMembershipMigration,
  planMembershipMigration,
  rollbackMembershipMigration,
} from './v6-to-v7.js'

const roots: string[] = []
const run = 'trial-260908-120000'

it('detects new Wiki identities after Digest conversion before finalization', async () => {
  const { root } = await fixture()
  await fs.mkdir(join(root, 'docs/digests'), { recursive: true })
  await fs.writeFile(join(root, 'docs/digests/D0001-2026-05-04.md'), '# Summary\n')
  const plan = await planMembershipMigration(root, { allowDirty: true })
  await applyDigestWikiMigration(plan.digests!)
  await expect(verifyDigestWikiMigration(plan.digests!)).resolves.toBeUndefined()
  await fs.writeFile(join(root, 'docs/wiki/digest/W0001-concurrent.md'), '# Another page\n')
  await expect(verifyDigestWikiMigration(plan.digests!)).rejects.toThrow(
    'Concurrent Wiki inventory',
  )
  expect(
    JSON.parse(await fs.readFile(join(root, '.memon/version.json'), 'utf8')).fs_convention_version,
  ).toBe(6)
})

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
  await fs.writeFile(
    experiment,
    `---\nid: E0001-trial\nruns: [${run}] # members\ncustom: 'keep me'\n---\nUnchanged body\n`,
  )
  await fs.writeFile(
    readme,
    `---\nexperiment: E0001-trial\ncustom: 'keep me'\n---\nUnchanged run body\n`,
  )
  return { root, base, experiment, readme }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('FS v6 to v7 membership migration', () => {
  it('migrates every legacy Digest with Wiki IDs, metadata and rebased links, then rolls back', async () => {
    const { root, base } = await fixture()
    const reviewMarks = 'commit,verified_at\n'
    const journal = '---\nlast_digest_at: 2026-05-01T10:00:00+08:00\n---\nHistory\n'
    await fs.writeFile(join(root, '.memon/wiki-review.csv'), reviewMarks)
    await fs.writeFile(join(root, 'docs/journal.md'), journal)
    await fs.mkdir(join(root, 'docs/digests'), { recursive: true })
    await fs.mkdir(join(root, 'docs/wiki/note'), { recursive: true })
    await fs.writeFile(
      join(root, 'docs/wiki/note/W0007-existing.md'),
      '---\nid: W0007\nkind: note\ntitle: Existing\n---\nKeep\n',
    )
    const firstPath = join(root, 'docs/digests/D0001-2026-05-04.md')
    const first =
      '---\nid: D0001\nowner: human\n---\n# Progress\n\n[Next](D0002-2026-05-05.md#section)\n[Evidence](../experiments/E0001-trial/README.md)\n`[literal](../unchanged)`\n'
    await fs.writeFile(firstPath, first)
    await fs.writeFile(
      join(root, 'docs/digests/D0002-2026-05-05.md'),
      '# Next\n\nUnchanged narrative.\n',
    )
    const plan = await planMembershipMigration(root, { allowDirty: true })
    expect(plan.blockers).toEqual([])
    expect(plan.digests?.documents).toHaveLength(2)
    const converted = plan.digests!.documents[0]!
    expect(converted.target).toContain('/W0008-')
    expect(converted.after).toContain('legacy_id: D0001')
    expect(converted.after).toContain('kind: digest')
    expect(converted.after).toContain('owner: human')
    expect(converted.after).toContain('[Next](W0009-digest-d0002-2026-05-05.md#section)')
    expect(converted.after).toContain('../../experiments/E0001-trial/README.md')
    expect(converted.after).toContain('`[literal](../unchanged)`')
    const backup = join(base, 'digest-backup')
    await applyMembershipMigration(plan, backup)
    expect(await fs.readFile(join(root, '.memon/wiki-review.csv'), 'utf8')).toBe(reviewMarks)
    expect(await fs.readFile(join(root, 'docs/journal.md'), 'utf8')).toBe(journal)
    await expect(fs.stat(firstPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(join(root, converted.target), 'utf8')).toBe(converted.after)
    const again = await planMembershipMigration(root)
    expect(again.blockers).toEqual([])
    expect(again.digests?.documents).toEqual([])
    await rollbackMembershipMigration(backup)
    expect(await fs.readFile(firstPath, 'utf8')).toBe(first)
    await expect(fs.stat(join(root, converted.target))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('restores converted Digests if a later membership write fails', async () => {
    const { root, base } = await fixture()
    await fs.mkdir(join(root, 'docs/digests'), { recursive: true })
    const source = join(root, 'docs/digests/D0001-2026-05-04.md')
    await fs.writeFile(source, '# Original summary\n')
    const plan = await planMembershipMigration(root, { allowDirty: true })
    const rename = vi
      .spyOn(fs, 'rename')
      .mockRejectedValueOnce(new Error('simulated write failure'))
    try {
      await expect(applyMembershipMigration(plan, join(base, 'backup'))).rejects.toThrow(
        'simulated write failure',
      )
    } finally {
      rename.mockRestore()
    }
    expect(await fs.readFile(source, 'utf8')).toBe('# Original summary\n')
    await expect(fs.stat(join(root, plan.digests!.documents[0]!.target))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    for (const file of plan.files)
      expect(await fs.readFile(join(root, file.path), 'utf8')).toBe(file.before)
  })

  it('leaves legacy digests untouched during explicit FS6 membership preparation', async () => {
    const { root, base } = await fixture()
    await fs.mkdir(join(root, 'docs/digests'), { recursive: true })
    const path = join(root, 'docs/digests/D0001-2026-05-04.md')
    await fs.writeFile(path, '# Legacy\n')
    const plan = await planMembershipMigration(root, { allowDirty: true, keepVersion: true })
    expect(plan.digests).toBeUndefined()
    await applyMembershipMigration(plan, join(base, 'backup'))
    expect(await fs.readFile(path, 'utf8')).toBe('# Legacy\n')
    expect((await planMembershipMigration(root)).digests?.documents).toHaveLength(1)
  })

  it.each([
    'source',
    'destination',
    'wiki-inventory',
  ])('rejects stale Digest %s before membership writes', async (change) => {
    const { root, base, experiment } = await fixture()
    await fs.mkdir(join(root, 'docs/digests'), { recursive: true })
    const source = join(root, 'docs/digests/D0001-2026-05-04.md')
    await fs.writeFile(source, '# Legacy\n')
    const before = await fs.readFile(experiment, 'utf8')
    const plan = await planMembershipMigration(root, { allowDirty: true })
    await fs.mkdir(join(root, 'docs/wiki/digest'), { recursive: true })
    if (change === 'source') await fs.appendFile(source, 'Concurrent edit')
    else
      await fs.writeFile(
        join(
          root,
          change === 'destination'
            ? plan.digests!.documents[0]!.target
            : 'docs/wiki/digest/W0001-other.md',
        ),
        'occupied',
      )
    await expect(applyMembershipMigration(plan, join(base, 'backup'))).rejects.toThrow(
      'Stale Digest',
    )
    expect(await fs.readFile(experiment, 'utf8')).toBe(before)
  })

  it.each([
    'notes.md',
    'D0001-2026-05-04.md',
  ])('blocks unsupported legacy content rather than omitting %s', async (name) => {
    const { root } = await fixture()
    await fs.mkdir(join(root, 'docs/digests'), { recursive: true })
    await fs.writeFile(join(root, 'docs/digests', name), '![plot](plot.png)\n')
    expect((await planMembershipMigration(root)).blockers.length).toBeGreaterThan(0)
  })

  it('blocks reference-style image assets rather than rebasing them as document links', async () => {
    const { root } = await fixture()
    await fs.mkdir(join(root, 'docs/digests'), { recursive: true })
    await fs.writeFile(
      join(root, 'docs/digests/D0001-2026-05-04.md'),
      '![plot][chart]\n\n[chart]: plot.png\n',
    )
    expect((await planMembershipMigration(root)).blockers.join('\n')).toContain(
      'Relative image assets',
    )
  })

  it('rejects duplicate legacy identities and escaping symlink directories', async () => {
    const { root, base } = await fixture()
    await fs.mkdir(join(root, 'docs/digests'), { recursive: true })
    await fs.writeFile(join(root, 'docs/digests/D0001-2026-05-04.md'), '# One\n')
    await fs.writeFile(join(root, 'docs/digests/D0001-2026-05-05.md'), '# Two\n')
    expect((await planMembershipMigration(root)).blockers.join('\n')).toContain(
      'Duplicate legacy identity',
    )
    await fs.rm(join(root, 'docs/digests'), { recursive: true })
    await fs.symlink(base, join(root, 'docs/digests'))
    expect((await planMembershipMigration(root)).blockers.join('\n')).toContain('Unsafe symlink')
  })

  it('preserves changed converted pages on rollback and rejects old final-v7 plans', async () => {
    const { root, base } = await fixture()
    await fs.mkdir(join(root, 'docs/digests'), { recursive: true })
    await fs.writeFile(join(root, 'docs/digests/D0001-2026-05-04.md'), '# Legacy\n')
    const plan = await planMembershipMigration(root, { allowDirty: true })
    const old = { ...plan, digests: undefined }
    await expect(applyMembershipMigration(old, join(base, 'old'))).rejects.toThrow('Regenerate')
    const backup = join(base, 'backup')
    await applyMembershipMigration(plan, backup)
    const target = join(root, plan.digests!.documents[0]!.target)
    await fs.appendFile(target, 'Human update\n')
    await expect(rollbackMembershipMigration(backup)).rejects.toThrow('Concurrent edit')
    expect(await fs.readFile(target, 'utf8')).toContain('Human update')
  })

  it('performs the data upgrade without changing any version-marker bytes when requested', async () => {
    const { root, base, experiment, readme } = await fixture()
    const markerPath = join(root, '.memon/version.json')
    const markerBefore = await fs.readFile(markerPath, 'utf8')
    const markerStat = await fs.stat(markerPath)
    const plan = await planMembershipMigration(root, { allowDirty: true, keepVersion: true })
    await applyMembershipMigration(plan, join(base, 'backup'))
    expect(await fs.readFile(experiment, 'utf8')).toContain(`logs/${run}`)
    expect(await fs.readFile(readme, 'utf8')).not.toContain('experiment:')
    expect(await fs.readFile(markerPath, 'utf8')).toBe(markerBefore)
    expect((await fs.stat(markerPath)).mtimeMs).toBe(markerStat.mtimeMs)
    const second = await planMembershipMigration(root, { keepVersion: true })
    expect(second.blockers).toEqual([])
    expect(second.files.filter((file) => file.before !== file.after)).toEqual([])
    const finalUpgrade = await planMembershipMigration(root)
    expect(
      finalUpgrade.files.filter((file) => file.before !== file.after).map((file) => file.path),
    ).toEqual(['.memon/version.json'])
  })

  it('refuses dirty Git worktrees without the explicit scoped override', async () => {
    const { root, base } = await fixture()
    execFileSync('git', ['init', '-q'], { cwd: root })
    const plan = await planMembershipMigration(root)
    await expect(applyMembershipMigration(plan, join(base, 'backup'))).rejects.toThrow(
      'Dirty worktree',
    )
    expect(
      JSON.parse(await fs.readFile(join(root, '.memon/version.json'), 'utf8'))
        .fs_convention_version,
    ).toBe(6)
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
    for (const file of plan.files)
      expect(await fs.readFile(join(root, file.path), 'utf8')).toBe(file.before)
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
    expect(
      JSON.parse(await fs.readFile(join(root, '.memon/version.json'), 'utf8'))
        .fs_convention_version,
    ).toBe(7)
  })

  it('migrates declarations and results, preserving unrelated bytes, and is idempotent', async () => {
    const { root, base, experiment, readme } = await fixture()
    const results = join(root, 'docs/experiments/E0001-trial/results.yaml')
    await fs.writeFile(
      results,
      `variants:\n  - id: V0001\n    runs: [${run}] # evidence\n    attempts: []\ncustom: 'keep me'\n`,
    )
    const plan = await planMembershipMigration(root, { allowDirty: true })
    expect(plan.blockers).toEqual([])
    await applyMembershipMigration(plan, join(base, 'backup'))
    expect(await fs.readFile(experiment, 'utf8')).toContain(`runs: ["logs/${run}"] # members`)
    expect(await fs.readFile(readme, 'utf8')).toBe(
      "---\ncustom: 'keep me'\n---\nUnchanged run body\n",
    )
    expect(await fs.readFile(results, 'utf8')).toContain(`runs: ["logs/${run}"] # evidence`)
    const second = await planMembershipMigration(root, { allowDirty: true })
    expect(second.blockers).toEqual([])
    expect(second.files.filter((file) => file.before !== file.after)).toEqual([])
    expect(JSON.parse(await fs.readFile(join(base, 'backup/plan.json'), 'utf8')).files).toEqual(
      plan.files,
    )
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
    await expect(applyMembershipMigration(plan, join(base, 'backup'))).rejects.toThrow(
      'Stale migration plan',
    )
    expect(
      JSON.parse(await fs.readFile(join(root, '.memon/version.json'), 'utf8'))
        .fs_convention_version,
    ).toBe(6)
    expect(await fs.readFile(readme, 'utf8')).toContain('Concurrent research note')
  })

  it('blocks duplicate basenames instead of choosing the newest Run', async () => {
    const { root } = await fixture()
    await fs.mkdir(join(root, 'outputs', run), { recursive: true })
    await fs.writeFile(join(root, 'outputs', run, 'README.md'), '---\n---\n')
    expect((await planMembershipMigration(root)).blockers.join('\n')).toContain(
      'ambiguous Run reference',
    )
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
