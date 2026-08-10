// @vitest-environment node

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CANONICAL_EXPERIMENT_SECTION_HEADINGS,
  lintExperimentDocument,
  MANAGED_SECTION_POINTERS,
  parseExperimentReadme,
  readExperimentDoc,
  readRunDir,
} from '@memon/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createExperiment,
  deleteExperiment,
  linkRun,
  unlinkRun,
  writeExperimentReadme,
} from './experiments'
import type { Runtime } from './runtime'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

function fakeRuntime(root: string): Runtime {
  const runs = new Map<string, Awaited<ReturnType<typeof readRunDir>>>()
  return {
    config: { projects: [{ name: 'research', root }] },
    index: {
      get: (id: string) => runs.get(id),
      set: (run: Awaited<ReturnType<typeof readRunDir>>) => runs.set(run.id, run),
    },
    experiments: new Map(),
    recomputeAnomalies: vi.fn(),
    events: { emit: vi.fn() },
    projectFor: (path: string) =>
      path === root || path.startsWith(`${root}/`) ? { name: 'research', root } : null,
  } as unknown as Runtime
}

describe('Web v6 Experiment mutations', () => {
  it('creates a canonical README and all three managed YAML documents', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-web-create-v6-'))
    roots.push(root)
    const rt = fakeRuntime(root)

    const created = await createExperiment(rt, {
      project: 'research',
      slug: 'precision-study',
      title: 'Precision study',
    })
    const directory = join(root, 'docs', 'experiments', created.id)
    const readme = await fs.readFile(join(directory, 'README.md'), 'utf8')
    const parsed = parseExperimentReadme(readme, created.id)

    expect(parsed.rawSections.map((section) => section.heading)).toEqual(
      CANONICAL_EXPERIMENT_SECTION_HEADINGS,
    )
    expect(parsed.sections.implementation).toBe(MANAGED_SECTION_POINTERS.implementation)
    expect(parsed.sections.investigation).toBe(MANAGED_SECTION_POINTERS.investigation)
    expect(parsed.sections.results).toBe(MANAGED_SECTION_POINTERS.results)
    await expect(fs.readFile(join(directory, 'implementation.yaml'), 'utf8')).resolves.toContain(
      'schema_version: 1',
    )
    await expect(fs.readFile(join(directory, 'investigation.yaml'), 'utf8')).resolves.toContain(
      'schema_version: 1',
    )
    await expect(fs.readFile(join(directory, 'results.yaml'), 'utf8')).resolves.toContain(
      'schema_version: 1',
    )

    const discovered = await readExperimentDoc(root, 'research', created.id)
    expect(discovered).not.toBeNull()
    expect(lintExperimentDocument(discovered!)).toEqual([])
  })

  it('keeps unsupported and duplicate H2 bodies during a normal README edit', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-web-edit-v6-'))
    roots.push(root)
    const rt = fakeRuntime(root)
    const created = await createExperiment(rt, {
      project: 'research',
      slug: 'compat-edit',
      title: 'Compatibility edit',
    })
    const readmePath = created.path
    const original = await fs.readFile(readmePath, 'utf8')
    const withLegacy = original.replace(
      '\n## Warnings\n',
      '\n## Legacy Notes\n\nfirst\n\n## Legacy Notes\n\nsecond\n\n## Warnings\n',
    )
    await fs.writeFile(readmePath, withLegacy, 'utf8')
    const fresh = await readExperimentDoc(root, 'research', created.id)
    expect(fresh).not.toBeNull()
    rt.experiments.set(created.id, fresh!)
    const stat = await fs.stat(readmePath)

    await writeExperimentReadme(rt, created.id, {
      content: withLegacy.replace('title: Compatibility edit', 'title: Edited title'),
      expectedMtime: stat.mtimeMs,
    })

    const after = await fs.readFile(readmePath, 'utf8')
    expect(after).toContain('title: Edited title')
    expect(after.match(/^## Legacy Notes$/gm)).toHaveLength(2)
    expect(after).toContain('\nfirst\n')
    expect(after).toContain('\nsecond\n')
  })

  it('keeps unsupported and duplicate H2 bodies while linking and unlinking a Run', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-web-link-v6-'))
    roots.push(root)
    const rt = fakeRuntime(root)
    const runId = 'compat-link-260810-010000'
    const runDir = join(root, 'logs', runId)
    await fs.mkdir(runDir, { recursive: true })
    await fs.writeFile(
      join(runDir, 'README.md'),
      `---
id: ${runId}
name: compat-link
status: FINISHED
experiment: null
created_at: 2026-08-10T01:00:00+00:00
updated_at: 2026-08-10T01:10:00+00:00
finished_at: 2026-08-10T01:10:00+00:00
host: null
pid: null
gpus: []
archived: false
entry: ./run.sh
command: ./run.sh
wandb: null
---

## Setup

fixture

## Result

finished

## Artifacts
`,
      'utf8',
    )
    rt.index.set(await readRunDir(runDir, 'research'))
    const created = await createExperiment(rt, {
      project: 'research',
      slug: 'compat-link',
      title: 'Compatibility link',
    })
    const original = await fs.readFile(created.path, 'utf8')
    await fs.writeFile(
      created.path,
      original.replace(
        '\n## Warnings\n',
        '\n## Legacy Notes\n\nfirst\n\n## Legacy Notes\n\nsecond\n\n## Warnings\n',
      ),
      'utf8',
    )
    const fresh = await readExperimentDoc(root, 'research', created.id)
    rt.experiments.set(created.id, fresh!)

    await linkRun(rt, created.id, { run: runId })
    let after = await fs.readFile(created.path, 'utf8')
    expect(after.match(/^## Legacy Notes$/gm)).toHaveLength(2)
    expect(after).toContain(`runs: [${runId}]`)

    await unlinkRun(rt, created.id, { run: runId })
    after = await fs.readFile(created.path, 'utf8')
    expect(after.match(/^## Legacy Notes$/gm)).toHaveLength(2)
    expect(after).toContain('runs: []')
  })

  it('deletes a run-free canonical bundle without treating managed YAML as scratch', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-web-delete-v6-'))
    roots.push(root)
    const rt = fakeRuntime(root)
    const created = await createExperiment(rt, {
      project: 'research',
      slug: 'delete-bundle',
    })

    await expect(deleteExperiment(rt, created.id, false)).resolves.toMatchObject({
      deletedId: created.id,
      cascadedRuns: [],
    })
    await expect(fs.stat(join(root, 'docs', 'experiments', created.id))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('still refuses non-force deletion when an Experiment bundle has scratch files', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-web-delete-scratch-'))
    roots.push(root)
    const rt = fakeRuntime(root)
    const created = await createExperiment(rt, {
      project: 'research',
      slug: 'keep-scratch',
    })
    const directory = join(root, 'docs', 'experiments', created.id)
    await fs.writeFile(join(directory, 'analysis.py'), 'print("keep")\n', 'utf8')

    await expect(deleteExperiment(rt, created.id, false)).rejects.toMatchObject({
      status: 400,
      code: 'BAD_REQUEST',
    })
    await expect(fs.stat(join(directory, 'analysis.py'))).resolves.toBeDefined()
  })
})
