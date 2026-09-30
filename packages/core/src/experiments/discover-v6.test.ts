import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  discoverExperiments,
  listExperimentIds,
  listExperimentPaths,
  readExperimentDoc,
} from './discover.js'

const EXPERIMENT_ID = 'E0001-foo'
const README = `---
id: ${EXPERIMENT_ID}
slug: foo
title: Foo
status: OPEN
archived: false
runs: []
hypotheses: []
tags: []
created_at: '2026-08-10T00:00:00+00:00'
updated_at: '2026-08-10T00:00:00+00:00'
---

## Motivation

## Design

## Implementation
> Managed in [implementation.yaml](./implementation.yaml); read and update that file directly.

## Investigation
> Managed in [investigation.yaml](./investigation.yaml); read and update that file directly.

## Results
> Managed in [results.yaml](./results.yaml); read and update that file directly.

## Findings

## Limitations

## Conclusion

## Warnings
`

describe('v6 Experiment bundle mtimes', () => {
  let root: string
  let directory: string

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'memon-exp-v6-mtime-'))
    directory = join(root, 'docs', 'experiments', EXPERIMENT_ID)
    await fs.mkdir(directory, { recursive: true })
    await Promise.all([
      fs.writeFile(join(directory, 'README.md'), README),
      fs.writeFile(join(directory, 'implementation.yaml'), 'schema_version: 1\nitems: []\n'),
      fs.writeFile(join(directory, 'investigation.yaml'), 'schema_version: 1\nitems: []\n'),
      fs.writeFile(
        join(directory, 'results.yaml'),
        'schema_version: 1\ncolumns: []\nvariants: []\n',
      ),
    ])
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('updates aggregate mtime for a YAML edit without changing readmeMtime', async () => {
    const readmeTime = new Date('2026-08-10T00:00:00.000Z')
    const initialYamlTime = new Date('2026-08-10T00:01:00.000Z')
    await fs.utimes(join(directory, 'README.md'), readmeTime, readmeTime)
    for (const file of ['implementation.yaml', 'investigation.yaml', 'results.yaml']) {
      await fs.utimes(join(directory, file), initialYamlTime, initialYamlTime)
    }

    const before = await readExperimentDoc(root, 'test', EXPERIMENT_ID)
    expect(before).not.toBeNull()
    expect(before!.mtime).toBeGreaterThan(before!.readmeMtime)

    const laterYamlTime = new Date('2026-08-10T00:02:00.000Z')
    await fs.writeFile(
      join(directory, 'results.yaml'),
      'schema_version: 1\ncolumns: []\nvariants: []\n# updated\n',
    )
    await fs.utimes(join(directory, 'results.yaml'), laterYamlTime, laterYamlTime)

    const after = await readExperimentDoc(root, 'test', EXPERIMENT_ID)
    expect(after).not.toBeNull()
    expect(after!.readmeMtime).toBe(before!.readmeMtime)
    expect(after!.mtime).toBeGreaterThan(before!.mtime)

    const discovered = await discoverExperiments(root, 'test')
    expect(discovered.experiments[0]).toMatchObject({
      id: EXPERIMENT_ID,
      mtime: after!.mtime,
      readmeMtime: before!.readmeMtime,
    })
  })

  it('uses zero for a missing-README placeholder and the file mtime for legacy layout', async () => {
    const missingDirectory = join(root, 'docs', 'experiments', 'E0002-missing')
    await fs.mkdir(missingDirectory)
    await fs.writeFile(
      join(root, 'docs', 'experiments', 'E0003-legacy.md'),
      README.replaceAll(EXPERIMENT_ID, 'E0003-legacy').replace('slug: foo', 'slug: legacy'),
    )

    const { experiments } = await discoverExperiments(root, 'test')
    const missing = experiments.find((experiment) => experiment.id === 'E0002-missing')
    const legacy = experiments.find((experiment) => experiment.id === 'E0003-legacy')
    expect(missing?.readmeMtime).toBe(0)
    expect(legacy?.readmeMtime).toBe(legacy?.mtime)
  })

  it('lists ids from directory entries alone, past an unreadable document', async () => {
    await fs.mkdir(join(root, 'docs', 'experiments', 'E0002-missing'))
    await fs.writeFile(
      join(root, 'docs', 'experiments', 'E0003-legacy.md'),
      README.replaceAll(EXPERIMENT_ID, 'E0003-legacy'),
    )
    await fs.writeFile(join(root, 'docs', 'experiments', 'notes.md'), '# not an experiment\n')
    await fs.writeFile(
      join(root, 'docs', 'experiments', `${EXPERIMENT_ID}.md`),
      '# leftover legacy',
    )
    // A document that cannot be read at all still has an identity on disk.
    await fs.rm(join(directory, 'README.md'))
    await fs.symlink('README.md', join(directory, 'README.md'))

    expect(await listExperimentIds(root)).toEqual([EXPERIMENT_ID, 'E0002-missing', 'E0003-legacy'])
    expect(await listExperimentIds(join(root, 'nowhere'))).toEqual([])
    expect([...(await listExperimentPaths(root))]).toEqual([
      [EXPERIMENT_ID, `docs/experiments/${EXPERIMENT_ID}/README.md`],
      ['E0002-missing', 'docs/experiments/E0002-missing/README.md'],
      ['E0003-legacy', 'docs/experiments/E0003-legacy.md'],
    ])
  })
})
