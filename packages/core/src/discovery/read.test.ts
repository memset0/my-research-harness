import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readExperimentDir } from './read.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-read-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const FULL_README = `---
id: foo-260503-082800
name: foo
project: fsdp-comm
status: RUNNING
created_at: 2026-05-03T08:28:00+08:00
finished_at: null
host: m2
pid: 12345
gpus: [0, 1]
entry: ./run.sh
command: bash run.sh
wandb: null
hypotheses: [H0001]
tags: [moe]
---

## Motivation
verify H0001
`

describe('readExperimentDir', () => {
  it('returns full Experiment when README is present', async () => {
    const dir = join(root, 'foo-260503-082800')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'README.md'), FULL_README)

    const exp = await readExperimentDir(dir, 'fsdp-comm')
    expect(exp.hasReadme).toBe(true)
    expect(exp.id).toBe('foo-260503-082800')
    expect(exp.frontMatter.status).toBe('RUNNING')
    expect(exp.path).toBe(dir)
    expect(exp.mtime).toBeGreaterThan(0)
  })

  it('synthesizes Experiment when README is missing', async () => {
    const dir = join(root, 'foo-260503-082800')
    await fs.mkdir(dir, { recursive: true })

    const exp = await readExperimentDir(dir, 'fsdp-comm')
    expect(exp.hasReadme).toBe(false)
    expect(exp.id).toBe('foo-260503-082800')
    expect(exp.frontMatter.id).toBe('foo-260503-082800')
    expect(exp.frontMatter.name).toBe('foo')
    expect(exp.frontMatter.project).toBe('fsdp-comm')
    expect(exp.frontMatter.status).toBe('UNKNOWN')
    expect(exp.frontMatter.createdAt).toMatch(/^2026-05-03T08:28:00[+-]\d{2}:\d{2}$/)
    expect(exp.parseErrors).toEqual([])
    expect(exp.parseWarnings).toHaveLength(1)
  })

  it('backfills id and project when front matter has empty strings', async () => {
    const dir = join(root, 'noid-260503-082800')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      join(dir, 'README.md'),
      FULL_README.replace('id: foo-260503-082800', 'id: ""').replace(
        'project: fsdp-comm',
        'project: ""',
      ),
    )

    const exp = await readExperimentDir(dir, 'fallback-project')
    // id backfills from directory; project from arg
    expect(exp.id).toBe('noid-260503-082800')
    expect(exp.frontMatter.project).toBe('fallback-project')
  })
})
