import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  migrateV3ToV4,
  rewriteV3ExpDoc,
  rewriteV3RunReadme,
} from './v3-to-v4.js'

const NOW = '2026-05-13T12:00:00+08:00'

const V3_RUN_README = `---
id: foo-260513-100000
name: foo
status: FINISHED
experiment: E0001-zero-snr
created_at: '2026-05-13T10:00:00+08:00'
updated_at: '2026-05-13T11:00:00+08:00'
finished_at: '2026-05-13T11:00:00+08:00'
host: gpu-04
pid: null
gpus: [0, 1]
entry: ./run.sh
command: bash run.sh
wandb: null
---

## Setup
Setup body.

## Result
Result body.

## Artifacts
`

const V4_RUN_README_NOT_ARCHIVED = `---
id: foo-260513-100000
name: foo
status: FINISHED
experiment: E0001-zero-snr
created_at: '2026-05-13T10:00:00+08:00'
updated_at: '${NOW}'
finished_at: '2026-05-13T11:00:00+08:00'
host: gpu-04
pid: null
gpus: [0, 1]
archived: false
entry: ./run.sh
command: bash run.sh
wandb: null
---`

const V3_EXP_DOC = `---
id: E0001-zero-snr
slug: zero-snr
title: Zero SNR study
runs: [foo-260513-100000]
hypotheses: []
tags: []
created_at: '2026-05-13T08:00:00+08:00'
updated_at: '2026-05-13T08:00:00+08:00'
---

## Motivation
Why we run this.

## Method
How.

## Plan

## Conclusion

## Caveats

## Warnings
`

describe('rewriteV3RunReadme', () => {
  it('inserts archived: false when no sidecar and the field is missing', () => {
    const out = rewriteV3RunReadme({
      v3Content: V3_RUN_README,
      hadSidecar: false,
      migrationTime: NOW,
    })
    expect(out.unchanged).toBe(false)
    expect(out.content).toContain('archived: false')
    expect(out.content).toContain(`updated_at: "${NOW}"`)
  })

  it('inserts archived: true when sidecar exists and the field is missing', () => {
    const out = rewriteV3RunReadme({
      v3Content: V3_RUN_README,
      hadSidecar: true,
      migrationTime: NOW,
    })
    expect(out.unchanged).toBe(false)
    expect(out.content).toContain('archived: true')
  })

  it('is a no-op when the README already has archived', () => {
    const out = rewriteV3RunReadme({
      v3Content: V4_RUN_README_NOT_ARCHIVED,
      hadSidecar: false,
      migrationTime: NOW,
    })
    expect(out.unchanged).toBe(true)
    expect(out.content).toBe(V4_RUN_README_NOT_ARCHIVED)
  })
})

describe('rewriteV3ExpDoc', () => {
  it('inserts status: OPEN and archived: false when both are missing', () => {
    const out = rewriteV3ExpDoc({
      v3Content: V3_EXP_DOC,
      filenameStem: 'E0001-zero-snr',
      migrationTime: NOW,
    })
    expect(out.unchanged).toBe(false)
    expect(out.content).toContain('status: OPEN')
    expect(out.content).toContain('archived: false')
    expect(out.content).toContain(`updated_at: "${NOW}"`)
  })

  it('preserves a hand-set status value during migration', () => {
    const v3WithStatus = V3_EXP_DOC.replace(
      `title: Zero SNR study`,
      `title: Zero SNR study\nstatus: RESOLVED`,
    )
    const out = rewriteV3ExpDoc({
      v3Content: v3WithStatus,
      filenameStem: 'E0001-zero-snr',
      migrationTime: NOW,
    })
    expect(out.parsed.frontMatter.status).toBe('RESOLVED')
    expect(out.content).toContain('status: RESOLVED')
  })

  it('is a no-op when both status and archived are present', () => {
    const v4Doc = V3_EXP_DOC.replace(
      `title: Zero SNR study`,
      `title: Zero SNR study\nstatus: OPEN\narchived: false`,
    )
    const out = rewriteV3ExpDoc({
      v3Content: v4Doc,
      filenameStem: 'E0001-zero-snr',
      migrationTime: NOW,
    })
    expect(out.unchanged).toBe(true)
  })
})

describe('migrateV3ToV4 end-to-end', () => {
  async function setup() {
    const root = await mkdtemp(join(tmpdir(), 'memon-v3-v4-'))
    const runDir = join(root, 'logs', 'foo-260513-100000')
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, 'README.md'), V3_RUN_README, 'utf8')
    // Sidecar present.
    await writeFile(join(runDir, '.archived'), '', 'utf8')

    const expDir = join(root, 'docs', 'experiments')
    await mkdir(expDir, { recursive: true })
    const expPath = join(expDir, 'E0001-zero-snr.md')
    await writeFile(expPath, V3_EXP_DOC, 'utf8')
    return { root, runDir, expPath }
  }

  it('rewrites both run + exp, deletes sidecar after run write', async () => {
    const { root, runDir, expPath } = await setup()
    const result = await migrateV3ToV4({
      projectRoot: root,
      migrationTime: NOW,
      runDirs: [runDir],
      expDocPaths: [expPath],
    })
    expect(result.runStats).toHaveLength(1)
    expect(result.runStats[0]!.changed).toBe(true)
    expect(result.runStats[0]!.sidecarDeleted).toBe(true)
    expect(result.expStats[0]!.changed).toBe(true)

    // Sidecar gone.
    expect(existsSync(join(runDir, '.archived'))).toBe(false)

    // Run README has archived: true (from the sidecar).
    const runContent = await readFile(join(runDir, 'README.md'), 'utf8')
    expect(runContent).toContain('archived: true')

    // Exp doc has both new fields.
    const expContent = await readFile(expPath, 'utf8')
    expect(expContent).toContain('status: OPEN')
    expect(expContent).toContain('archived: false')
  })

  it('idempotent re-run does no work and does not bump updated_at', async () => {
    const { root, runDir, expPath } = await setup()
    await migrateV3ToV4({
      projectRoot: root,
      migrationTime: NOW,
      runDirs: [runDir],
      expDocPaths: [expPath],
    })
    const firstRunStat = await stat(join(runDir, 'README.md'))
    const firstExpStat = await stat(expPath)

    // Wait long enough for mtime resolution.
    await new Promise((r) => setTimeout(r, 25))

    const result = await migrateV3ToV4({
      projectRoot: root,
      migrationTime: '2026-06-01T00:00:00+08:00',
      runDirs: [runDir],
      expDocPaths: [expPath],
    })
    expect(result.runStats[0]!.changed).toBe(false)
    expect(result.expStats[0]!.changed).toBe(false)

    const secondRunStat = await stat(join(runDir, 'README.md'))
    const secondExpStat = await stat(expPath)
    expect(secondRunStat.mtimeMs).toBe(firstRunStat.mtimeMs)
    expect(secondExpStat.mtimeMs).toBe(firstExpStat.mtimeMs)
  })

  it('handles missing run README gracefully (skip)', async () => {
    const { root, expPath } = await setup()
    const ghostRunDir = join(root, 'logs', 'ghost-260513-100000')
    await mkdir(ghostRunDir, { recursive: true })
    // No README.

    const result = await migrateV3ToV4({
      projectRoot: root,
      migrationTime: NOW,
      runDirs: [ghostRunDir],
      expDocPaths: [expPath],
    })
    expect(result.runStats).toHaveLength(0) // skipped
    expect(result.expStats[0]!.changed).toBe(true)
  })
})
