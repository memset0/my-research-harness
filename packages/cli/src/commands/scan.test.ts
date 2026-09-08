// CLI tests for `memon scan` after Journal left the research snapshot.
//
// The strong assertion is that scan does not READ the legacy file: the fixture
// replaces `docs/journal.md` with a directory, which any reader would fail on
// (EISDIR), so a successful scan proves the read is gone rather than merely
// stripped from the output.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runScan } from './scan.js'

const RUN = `---
id: foo-260901-090000
name: foo
status: RUNNING
experiment: null
created_at: '2026-09-01T09:00:00+08:00'
updated_at: '2026-09-01T09:00:00+08:00'
finished_at: null
host: null
pid: null
gpus: []
archived: false
entry: ./run.sh
command: ./run.sh
wandb: null
---

## Setup

s

## Result

r

## Artifacts

a
`

let root: string
let stdoutChunks: string[]
let realStdoutWrite: typeof process.stdout.write

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-scan-'))
  await fs.mkdir(join(root, 'logs', 'foo-260901-090000'), { recursive: true })
  await fs.writeFile(join(root, 'logs', 'foo-260901-090000', 'README.md'), RUN, 'utf8')
  // Unreadable-as-a-file journal: reading it would throw EISDIR.
  await fs.mkdir(join(root, 'docs', 'journal.md'), { recursive: true })

  stdoutChunks = []
  realStdoutWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((c: unknown) => {
    stdoutChunks.push(String(c))
    return true
  }) as typeof process.stdout.write
})

afterEach(async () => {
  process.stdout.write = realStdoutWrite
  await fs.rm(root, { recursive: true, force: true })
})

describe('memon scan', () => {
  it('scans research documents without reading or returning journal history', async () => {
    await runScan({ projectRoot: root, format: 'json' })

    const snapshot = JSON.parse(stdoutChunks.join('').trim()) as Record<string, unknown> & {
      experiments: { id: string }[]
    }
    expect(snapshot).not.toHaveProperty('journal')
    expect(snapshot.experiments.map((run) => run.id)).toEqual(['foo-260901-090000'])
    expect(snapshot).toHaveProperty('hypotheses')
  })

  it('human output reports no digest cursor', async () => {
    await runScan({ projectRoot: root, format: 'human' })

    const text = stdoutChunks.join('')
    expect(text).toContain('experiments:  1')
    expect(text.toLowerCase()).not.toContain('digest')
    expect(text.toLowerCase()).not.toContain('journal')
  })
})
