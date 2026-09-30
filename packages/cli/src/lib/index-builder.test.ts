import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Config, DEFAULT_GIT_STATUS } from '@memon/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildIndex } from './index-builder.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-cli-builder-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const README = (id: string, project: string) => `---
id: ${id}
name: ${id.split('-')[0]}
project: ${project}
status: RUNNING
created_at: 2026-05-01T10:00:00+08:00
entry: ./run.sh
command: bash run.sh
hypotheses: []
tags: []
---

## Motivation
TBD
`

describe('buildIndex', () => {
  it('discovers experiments across projects, populates the index', async () => {
    const projectA = join(root, 'a')
    const projectB = join(root, 'b')
    await fs.mkdir(join(projectA, 'logs', 'foo-260501-100000'), { recursive: true })
    await fs.writeFile(
      join(projectA, 'logs', 'foo-260501-100000', 'README.md'),
      README('foo-260501-100000', 'a'),
    )
    await fs.mkdir(join(projectB, 'logs', 'bar-260502-100000'), { recursive: true })
    await fs.writeFile(
      join(projectB, 'logs', 'bar-260502-100000', 'README.md'),
      README('bar-260502-100000', 'b'),
    )

    const config: Config = {
      projects: [
        { name: 'a', root: projectA, include: [], exclude: [] },
        { name: 'b', root: projectB, include: [], exclude: [] },
      ],
      poll: { minIntervalMs: 1000, maxIntervalMs: 60000, backoffFactor: 2 },
      slurm: { totalNodes: -1 },
      gitStatus: { ...DEFAULT_GIT_STATUS },
    }

    const idx = await buildIndex(config)
    expect(idx.size()).toBe(2)
    const ids = idx
      .list()
      .map((e) => e.id)
      .sort()
    expect(ids).toEqual(['bar-260502-100000', 'foo-260501-100000'])
  })

  it('respects project filter', async () => {
    const projectA = join(root, 'a')
    const projectB = join(root, 'b')
    await fs.mkdir(join(projectA, 'logs', 'foo-260501-100000'), { recursive: true })
    await fs.mkdir(join(projectB, 'logs', 'bar-260502-100000'), { recursive: true })

    const config: Config = {
      projects: [
        { name: 'a', root: projectA, include: [], exclude: [] },
        { name: 'b', root: projectB, include: [], exclude: [] },
      ],
      poll: { minIntervalMs: 1000, maxIntervalMs: 60000, backoffFactor: 2 },
      slurm: { totalNodes: -1 },
      gitStatus: { ...DEFAULT_GIT_STATUS },
    }

    const idx = await buildIndex(config, { project: 'a' })
    expect(idx.size()).toBe(1)
  })
})
