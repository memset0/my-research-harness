// Unit tests for renameExperiment — runs against a temp project root
// rather than mocking fs so the multi-file cascade (folder rename + exp
// README + bound runs + hypotheses + JOURNAL) is realistic.

import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RenameExperimentError, renameExperiment } from './rename.js'

const PROJECT_NAME = '(project-root)'

const FIXED_NOW = '2026-05-15T10:00:00+08:00'
const now = () => FIXED_NOW

function expReadme(opts: {
  id: string
  slug: string
  runs: string[]
  title?: string
  hypotheses?: string[]
}): string {
  const title = opts.title ?? `Exp ${opts.slug}`
  return `---
id: ${opts.id}
slug: ${opts.slug}
title: ${JSON.stringify(title)}
status: OPEN
archived: false
runs: ${JSON.stringify(opts.runs)}
hypotheses: ${JSON.stringify(opts.hypotheses ?? [])}
tags: []
created_at: '2026-05-01T08:00:00+08:00'
updated_at: '2026-05-01T08:00:00+08:00'
---

## Motivation

m

## Method

x

## Plan

p

## Conclusion

c

## Caveats

cav
`
}

function runReadme(opts: { id: string; slug: string; expId: string | null }): string {
  return `---
id: ${opts.id}
name: ${opts.slug}
project: ''
status: FINISHED
created_at: '2026-05-01T10:00:00+08:00'
finished_at: '2026-05-01T11:00:00+08:00'
host: null
pid: null
gpus: []
experiment: ${opts.expId === null ? 'null' : JSON.stringify(opts.expId)}
archived: false
entry: ./run.sh
command: ./run.sh
wandb: null
hypotheses: []
tags: []
---

## Setup

s

## Result

r

## Artifacts

- \`./run.log\` — log
`
}

const HYPOTHESES_BASE = `# diffusion-prior hypotheses

## Summary table

| ID | Statement | Status | Experiments |
| :-: | --- | :-: | --- |
| H0001 | first | ✅ | E0001-foo |
| H0002 | second | 🟡 | E0001-foo, E0002-bar |

## H0001. first

- **Statement**: first
- **Experiments**: E0001-foo
- **Runs**: foo-260501-100000

## H0002. second

- **Statement**: second
- **Experiments**: E0001-foo, E0002-bar
- **Runs**: foo-260502-110000
`

async function seedProject(
  root: string,
  opts: {
    exps: { id: string; slug: string; runs: string[] }[]
    runs?: { id: string; slug: string; expId: string | null }[]
    hypotheses?: string | null
  },
): Promise<void> {
  for (const e of opts.exps) {
    const dir = join(root, 'docs', 'experiments', e.id)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'README.md'), expReadme(e))
  }
  for (const r of opts.runs ?? []) {
    const dir = join(root, 'logs', r.id)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'README.md'), runReadme(r))
  }
  if (opts.hypotheses !== null && opts.hypotheses !== undefined) {
    const docs = join(root, 'docs')
    await fs.mkdir(docs, { recursive: true })
    await fs.writeFile(join(docs, 'hypotheses.md'), opts.hypotheses)
  }
}

describe('renameExperiment', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'memon-exp-rename-'))
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('happy path: rewrites folder, README, bound runs, hypotheses, JOURNAL', async () => {
    await seedProject(root, {
      exps: [{ id: 'E0001-foo', slug: 'foo', runs: ['foo-260501-100000', 'foo-260502-110000'] }],
      runs: [
        { id: 'foo-260501-100000', slug: 'foo', expId: 'E0001-foo' },
        { id: 'foo-260502-110000', slug: 'foo', expId: 'E0001-foo' },
      ],
      hypotheses: HYPOTHESES_BASE,
    })
    // A whole-project Run scan would try to read this unrelated README and
    // fail with EISDIR. Rename must resolve and read only the two named
    // members.
    await fs.mkdir(join(root, 'outputs', 'unrelated-260503-120000', 'README.md'), {
      recursive: true,
    })

    const r = await renameExperiment(root, PROJECT_NAME, 'E0001-foo', 'zero-snr', { now })

    expect(r.ok).toBe(true)
    expect(r.oldId).toBe('E0001-foo')
    expect(r.newId).toBe('E0001-zero-snr')
    expect(r.noop).toBeUndefined()
    expect(r.warnings).toHaveLength(2)
    expect(r.warnings[0]!.code).toBe('RUN_SLUG_PREFIX_VIOLATION')

    // Folder renamed.
    await expect(
      fs.stat(join(root, 'docs', 'experiments', 'E0001-zero-snr')),
    ).resolves.toBeDefined()
    await expect(fs.stat(join(root, 'docs', 'experiments', 'E0001-foo'))).rejects.toThrow()

    // New README has correct frontmatter.
    const newReadme = await fs.readFile(
      join(root, 'docs', 'experiments', 'E0001-zero-snr', 'README.md'),
      'utf8',
    )
    expect(newReadme).toContain('id: E0001-zero-snr')
    expect(newReadme).toContain('slug: zero-snr')
    expect(newReadme).toContain(`updated_at: "${FIXED_NOW}"`)

    // Membership is Experiment-owned: the renamed README still carries both
    // member declarations exactly as seeded (legacy bare ids stay readable),
    // and the Run READMEs are not rewritten.
    expect(newReadme).toContain('foo-260501-100000')
    expect(newReadme).toContain('foo-260502-110000')
    const run1 = await fs.readFile(join(root, 'logs', 'foo-260501-100000', 'README.md'), 'utf8')
    const run2 = await fs.readFile(join(root, 'logs', 'foo-260502-110000', 'README.md'), 'utf8')
    expect(run1).not.toContain('experiment: E0001-zero-snr')
    expect(run2).not.toContain('experiment: E0001-zero-snr')

    // Hypotheses substituted.
    const hyps = await fs.readFile(join(root, 'docs', 'hypotheses.md'), 'utf8')
    expect(hyps).not.toContain('E0001-foo')
    expect(hyps).toContain('E0001-zero-snr')
    expect(hyps).toContain('E0002-bar') // unrelated id untouched

    // JOURNAL append.
    const journal = await fs.readFile(join(root, 'docs', 'journal.md'), 'utf8')
    expect(journal).toContain('[RENAME]')
    expect(journal).toContain('op=experiment-rename old=E0001-foo new=E0001-zero-snr')
  })

  it('noop on same slug', async () => {
    await seedProject(root, { exps: [{ id: 'E0001-foo', slug: 'foo', runs: [] }] })

    const before = await fs.stat(join(root, 'docs', 'experiments', 'E0001-foo', 'README.md'))
    const r = await renameExperiment(root, PROJECT_NAME, 'E0001-foo', 'foo', { now })

    expect(r.noop).toBe(true)
    expect(r.oldId).toBe('E0001-foo')
    expect(r.newId).toBe('E0001-foo')

    const after = await fs.stat(join(root, 'docs', 'experiments', 'E0001-foo', 'README.md'))
    expect(after.mtimeMs).toBe(before.mtimeMs)

    // No JOURNAL event.
    await expect(fs.stat(join(root, 'docs', 'journal.md'))).rejects.toThrow()
  })

  it('rejects slug collision', async () => {
    await seedProject(root, {
      exps: [
        { id: 'E0001-foo', slug: 'foo', runs: [] },
        { id: 'E0002-bar', slug: 'bar', runs: [] },
      ],
    })

    await expect(
      renameExperiment(root, PROJECT_NAME, 'E0001-foo', 'bar', { now }),
    ).rejects.toMatchObject({ code: 'EXPERIMENT_SLUG_PREFIX_COLLISION' })

    // Original folder still exists.
    await expect(fs.stat(join(root, 'docs', 'experiments', 'E0001-foo'))).resolves.toBeDefined()
  })

  it('rejects prefix collision (new slug is a prefix of existing)', async () => {
    await seedProject(root, {
      exps: [
        { id: 'E0001-old', slug: 'old', runs: [] },
        { id: 'E0002-foo-bar', slug: 'foo-bar', runs: [] },
      ],
    })

    // Renaming E0001-old → 'foo' would mean `foo-bar` (existing) has
    // the new slug `foo` as a prefix; the uniqueness rule rejects.
    await expect(
      renameExperiment(root, PROJECT_NAME, 'E0001-old', 'foo', { now }),
    ).rejects.toMatchObject({ code: 'EXPERIMENT_SLUG_PREFIX_COLLISION' })
  })

  it('rejects prefix collision (existing slug is a prefix of new)', async () => {
    await seedProject(root, {
      exps: [
        { id: 'E0001-old', slug: 'old', runs: [] },
        { id: 'E0002-foo', slug: 'foo', runs: [] },
      ],
    })

    // Renaming E0001-old → 'foo-bar' would put `foo` (existing) as a
    // prefix of the new slug `foo-bar`; the uniqueness rule rejects.
    await expect(
      renameExperiment(root, PROJECT_NAME, 'E0001-old', 'foo-bar', { now }),
    ).rejects.toMatchObject({ code: 'EXPERIMENT_SLUG_PREFIX_COLLISION' })
  })

  it('rejects invalid SLUG_RE', async () => {
    await seedProject(root, { exps: [{ id: 'E0001-foo', slug: 'foo', runs: [] }] })

    await expect(
      renameExperiment(root, PROJECT_NAME, 'E0001-foo', 'Foo', { now }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects timestamp tail in new slug', async () => {
    await seedProject(root, { exps: [{ id: 'E0001-foo', slug: 'foo', runs: [] }] })

    await expect(
      renameExperiment(root, PROJECT_NAME, 'E0001-foo', 'baz-260501-100000', { now }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('returns NOT_FOUND on missing exp id', async () => {
    await seedProject(root, { exps: [{ id: 'E0001-foo', slug: 'foo', runs: [] }] })

    await expect(
      renameExperiment(root, PROJECT_NAME, 'E0099-missing', 'baz', { now }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('does not write hypotheses when the id is absent', async () => {
    await seedProject(root, {
      exps: [{ id: 'E0001-foo', slug: 'foo', runs: [] }],
      hypotheses: '# hypotheses\n\nno experiment ids mentioned here\n',
    })
    const before = await fs.stat(join(root, 'docs', 'hypotheses.md'))

    await renameExperiment(root, PROJECT_NAME, 'E0001-foo', 'zero', { now })

    const after = await fs.stat(join(root, 'docs', 'hypotheses.md'))
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })

  it('handles missing hypotheses.md silently', async () => {
    await seedProject(root, { exps: [{ id: 'E0001-foo', slug: 'foo', runs: [] }] })
    // No hypotheses.md seeded.
    await expect(
      renameExperiment(root, PROJECT_NAME, 'E0001-foo', 'zero', { now }),
    ).resolves.toMatchObject({ ok: true, oldId: 'E0001-foo', newId: 'E0001-zero' })
  })

  it('renames a legacy v4 .md file form (mid-migration)', async () => {
    // Seed the legacy file form directly (no folder).
    const dir = join(root, 'docs', 'experiments')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      join(dir, 'E0001-foo.md'),
      expReadme({ id: 'E0001-foo', slug: 'foo', runs: [] }),
    )

    const r = await renameExperiment(root, PROJECT_NAME, 'E0001-foo', 'zero', { now })
    expect(r.ok).toBe(true)
    expect(r.newId).toBe('E0001-zero')

    // New legacy file at the new id.
    await expect(fs.stat(join(dir, 'E0001-zero.md'))).resolves.toBeDefined()
    await expect(fs.stat(join(dir, 'E0001-foo.md'))).rejects.toThrow()
    const content = await fs.readFile(join(dir, 'E0001-zero.md'), 'utf8')
    expect(content).toContain('id: E0001-zero')
  })

  it('error class export check', () => {
    const err = new RenameExperimentError('BAD_REQUEST', 'msg')
    expect(err.code).toBe('BAD_REQUEST')
    expect(err.message).toBe('msg')
  })
})
