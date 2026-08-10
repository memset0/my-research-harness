// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Poller, readExperimentDoc } from '@memon/core'
import { afterEach, describe, expect, it } from 'vitest'
import { experimentIdForWatchedPath, watchExperimentBundle } from './runtime'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'memon-experiment-watch-'))
  cleanup.push(root)
  const directory = join(root, 'docs', 'experiments', 'E0001-demo')
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, 'README.md'),
    `---
id: E0001-demo
slug: demo
title: Demo
status: OPEN
archived: false
runs: []
hypotheses: []
tags: []
created_at: '2026-08-10T00:00:00Z'
updated_at: '2026-08-10T00:00:00Z'
---

# Demo

## Motivation

Watch YAML changes.

## Design

Keep README unchanged.

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
`,
  )
  await writeFile(join(directory, 'implementation.yaml'), 'schema_version: 1\nitems: []\n')
  await writeFile(join(directory, 'investigation.yaml'), 'schema_version: 1\nitems: []\n')
  await writeFile(join(directory, 'results.yaml'), 'schema_version: 1\ncolumns: []\nvariants: []\n')
  return { root, directory }
}

describe('Experiment bundle polling', () => {
  it('maps managed sidecars and the bundle directory back to their Experiment', async () => {
    const { root, directory } = await fixture()
    expect(experimentIdForWatchedPath(root, join(directory, 'results.yaml'))).toBe('E0001-demo')
    expect(experimentIdForWatchedPath(root, directory)).toBe('E0001-demo')
    expect(experimentIdForWatchedPath(root, join(directory, 'notes.txt'))).toBeNull()
  })

  it('reloads the bundle when only results.yaml changes', async () => {
    const { root, directory } = await fixture()
    const initial = await readExperimentDoc(root, 'research', 'E0001-demo')
    expect(initial).not.toBeNull()

    let resolveReload!: (value: NonNullable<typeof initial>) => void
    const reloaded = new Promise<NonNullable<typeof initial>>((resolve) => {
      resolveReload = resolve
    })
    const poller = new Poller(
      { minIntervalMs: 5, maxIntervalMs: 10, backoffFactor: 1 },
      async (changedPath) => {
        if (!changedPath.endsWith('results.yaml')) return
        const updated = await readExperimentDoc(root, 'research', 'E0001-demo')
        if (updated) resolveReload(updated)
      },
    )
    await watchExperimentBundle(poller, initial!)

    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeFile(
      join(directory, 'results.yaml'),
      `schema_version: 1
columns: []
variants:
  - id: V0001
    name: Watched variant
    status: PLANNED
    parameters: {}
    metrics: {}
    runs: []
    attempts: []
`,
    )

    let timeout: ReturnType<typeof setTimeout> | undefined
    const updated = await Promise.race([
      reloaded,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('results.yaml watch timed out')), 2_000)
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout)
      poller.stop()
    })
    expect(updated.documents?.results.data?.variants[0]?.name).toBe('Watched variant')
  })
})
