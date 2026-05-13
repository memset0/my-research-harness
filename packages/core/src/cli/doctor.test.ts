import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runDoctor } from './doctor.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memon-doctor-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writeRun(slug: string, frontmatterExtras: string, body: string) {
  const dir = join(root, 'logs', `${slug}-260513-100000`)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'README.md'),
    `---
id: ${slug}-260513-100000
name: ${slug}
status: FINISHED
created_at: '2026-05-13T10:00:00+08:00'
updated_at: '2026-05-13T11:00:00+08:00'
finished_at: '2026-05-13T11:00:00+08:00'
host: gpu-04
pid: null
gpus: [0]
archived: false
entry: ./run.sh
command: bash run.sh
wandb: null
${frontmatterExtras}---

${body}
`,
    'utf8',
  )
  return dir
}

async function writeExp(id: string, frontmatterExtras: string, body: string) {
  const dir = join(root, 'docs', 'experiments')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, `${id}.md`),
    `---
id: ${id}
slug: ${id.replace(/^E\d{4}-/, '')}
title: Test ${id}
status: OPEN
archived: false
runs: []
hypotheses: []
tags: []
created_at: '2026-05-13T08:00:00+08:00'
updated_at: '2026-05-13T08:00:00+08:00'
${frontmatterExtras}---

${body}
`,
    'utf8',
  )
}

describe('runDoctor — v4 lints', () => {
  it('emits INTERRUPTED_NO_NOTE when an INTERRUPTED run has empty Result', async () => {
    await writeRun(
      'foo',
      '',
      '## Setup\n\n## Result\n\n## Artifacts\n',
    )
    // Override status to INTERRUPTED.
    const dir = join(root, 'logs', 'foo-260513-100000', 'README.md')
    const original = await import('node:fs/promises').then((m) => m.readFile(dir, 'utf8'))
    await writeFile(dir, original.replace('status: FINISHED', 'status: INTERRUPTED'), 'utf8')

    const report = await runDoctor(root)
    const codes = report.issues.map((i) => i.code)
    expect(codes).toContain('INTERRUPTED_NO_NOTE')
  })

  it('does not emit INTERRUPTED_NO_NOTE when Result has content', async () => {
    await writeRun(
      'foo',
      '',
      '## Setup\n\n## Result\nKilled because hyperparams were wrong.\n\n## Artifacts\n',
    )
    const dir = join(root, 'logs', 'foo-260513-100000', 'README.md')
    const original = await import('node:fs/promises').then((m) => m.readFile(dir, 'utf8'))
    await writeFile(dir, original.replace('status: FINISHED', 'status: INTERRUPTED'), 'utf8')

    const report = await runDoctor(root)
    const codes = report.issues.map((i) => i.code)
    expect(codes).not.toContain('INTERRUPTED_NO_NOTE')
  })

  it('emits RESOLVED_NO_CONCLUSION when a RESOLVED exp has empty Conclusion', async () => {
    await writeExp(
      'E0001-foo',
      '',
      '## Motivation\nWhy.\n\n## Method\nHow.\n\n## Plan\n\n## Conclusion\n\n## Caveats\n\n## Warnings\n',
    )
    const expPath = join(root, 'docs', 'experiments', 'E0001-foo.md')
    const original = await import('node:fs/promises').then((m) => m.readFile(expPath, 'utf8'))
    await writeFile(expPath, original.replace('status: OPEN', 'status: RESOLVED'), 'utf8')

    const report = await runDoctor(root)
    const codes = report.issues.map((i) => i.code)
    expect(codes).toContain('RESOLVED_NO_CONCLUSION')
  })

  it('does not emit RESOLVED_NO_CONCLUSION when Conclusion has content', async () => {
    await writeExp(
      'E0001-foo',
      '',
      '## Motivation\n\n## Method\n\n## Plan\n\n## Conclusion\nThe answer is 42.\n\n## Caveats\n\n## Warnings\n',
    )
    const expPath = join(root, 'docs', 'experiments', 'E0001-foo.md')
    const original = await import('node:fs/promises').then((m) => m.readFile(expPath, 'utf8'))
    await writeFile(expPath, original.replace('status: OPEN', 'status: RESOLVED'), 'utf8')

    const report = await runDoctor(root)
    const codes = report.issues.map((i) => i.code)
    expect(codes).not.toContain('RESOLVED_NO_CONCLUSION')
  })

  it('LEGACY_ARCHIVE_SIDECAR parse warning bubbles through to PARSE_WARNING doctor issue', async () => {
    // A run README without `archived:` + a sidecar present -> v4 fallback +
    // LEGACY_ARCHIVE_SIDECAR parse warning -> doctor PARSE_WARNING issue.
    const runDir = join(root, 'logs', 'foo-260513-100000')
    await mkdir(runDir, { recursive: true })
    await writeFile(
      join(runDir, 'README.md'),
      `---
id: foo-260513-100000
name: foo
status: FINISHED
created_at: '2026-05-13T10:00:00+08:00'
updated_at: '2026-05-13T11:00:00+08:00'
finished_at: '2026-05-13T11:00:00+08:00'
host: gpu-04
pid: null
gpus: [0]
entry: ./run.sh
command: bash run.sh
wandb: null
---

## Setup

## Result

## Artifacts
`,
      'utf8',
    )
    await writeFile(join(runDir, '.archived'), '', 'utf8')

    const report = await runDoctor(root, { includeArchived: true })
    const parseWarnings = report.issues.filter((i) => i.code === 'PARSE_WARNING')
    expect(parseWarnings.length).toBeGreaterThan(0)
    const combined = parseWarnings.map((p) => p.message).join('\n')
    expect(combined).toContain('LEGACY_ARCHIVE_SIDECAR')
  })
})
