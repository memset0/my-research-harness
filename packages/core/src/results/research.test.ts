import { promises as fs } from 'node:fs'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nodeMutationFs, readDocumentState } from '../experiments/mutations.js'
import {
  parseExperimentDescription,
  patchExperimentDescription,
  serializeExperimentDescription,
} from './description.js'
import {
  advanceExperimentResearchVersion,
  assertResearchDescriptionEdit,
  enrollResearchRun,
  initializeExperimentResearch,
  setExperimentVariantDeprecation,
} from './research.js'
import { applySchemaUpgrade, planSchemaUpgrade } from './schema-upgrade.js'
import { generateResultsSummary } from './summary.js'
import { writeRunResult } from './writer.js'

const A = 'logs/trial-261001-100000'
const B = 'logs/trial-261002-100000'
const EXP = 'E0001-trial'
const NOW = '2026-10-01T09:00:00+08:00'
afterEach(removeTempDirs)
const legacy = () =>
  parseExperimentDescription(
    JSON.stringify({
      experiment_schema_version: 1,
      columns: [{ path: 'metrics.score', label: 'Score', type: 'number' }],
      variants: [
        {
          id: 'V0001',
          name: 'baseline',
          runs: [A],
          values: { 'params.rate': 1 },
          frozen: { values: [{ path: 'metrics.score', value: 99 }] },
        },
      ],
      custom: { retained: true },
    }),
  ).data!
async function fixture() {
  const description = initializeExperimentResearch(legacy(), [A], NOW, 'Initial')
  const project = await createTempProject({
    experiments: {
      [EXP]: {
        'README.md': `---\nid: ${EXP}\nslug: trial\ntitle: Trial\nstatus: OPEN\nruns: [${A}]\n---\n`,
        'experiment.json': serializeExperimentDescription(description),
      },
    },
  })
  const target = {
    projectRoot: project.root,
    experimentId: EXP,
    readmePath: project.path('docs/experiments', EXP, 'README.md'),
  }
  const path = project.path('docs/experiments', EXP, 'experiment.json')
  const state = await readDocumentState(nodeMutationFs, path)
  const lock = { expectedMtime: state.mtime, expectedHash: state.hash, now: NOW }
  return { project, description, target, path, lock }
}
function summarize(description: ReturnType<typeof legacy>, researchVersion?: number) {
  return generateResultsSummary({
    experimentId: EXP,
    experimentDir: `docs/experiments/${EXP}`,
    description: parseExperimentDescription(serializeExperimentDescription(description)),
    researchVersion,
    members: [A, B]
      .filter((path) => description.research!.run_versions[path])
      .map((path) => ({
        path,
        record: { status: 'FINISHED' as const, deprecated: false, stop_reason: null },
        result: `path,stat,value\n$experiment_schema_version,,${path === A ? 1 : 2}\nmetrics.score,,${path === A ? 90 : 7}\nparams.rate,,${path === A ? 1 : 2}\n`,
      })),
    inputs: {},
    newestInputMtime: null,
    generatedAt: NOW,
    generator: { release: '10.0.0', role: 'test' },
  })
}

describe('research versions', () => {
  it('rejects malformed historical deprecation and closed timestamps before rendering', async () => {
    const { target, lock } = await fixture()
    const advanced = (
      await advanceExperimentResearchVersion(nodeMutationFs, target, {
        ...lock,
        expectedVersion: 1,
        reason: 'Correction',
      })
    ).description
    const invalid = structuredClone(advanced)
    const variant = (
      invalid.research!.versions[0]!.snapshot!.variants as Record<string, Record<string, unknown>>
    ).V0001!
    variant.deprecated = true
    variant.deprecation = { reason: 'Withdrawn', deprecated_at: 123 }
    expect(parseExperimentDescription(serializeExperimentDescription(invalid)).data).toBeNull()
    const timestamp = structuredClone(advanced)
    timestamp.research!.versions[0]!.closed_at = 'not-a-date'
    expect(parseExperimentDescription(serializeExperimentDescription(timestamp)).data).toBeNull()
    const missingReason = structuredClone(advanced)
    ;(
      missingReason.research!.versions[0]!.snapshot!.variants as Record<
        string,
        Record<string, unknown>
      >
    ).V0001!.deprecated = true
    expect(
      parseExperimentDescription(serializeExperimentDescription(missingReason)).data,
    ).toBeNull()
  })

  it('guards generic patches and inconsistent closed snapshot associations', async () => {
    const { description, target, lock } = await fixture()
    expect(() =>
      patchExperimentDescription(serializeExperimentDescription(description), (next) =>
        next.variants.push({
          id: 'V0002',
          name: 'new',
          runs: [],
          values: {},
          deprecated: true,
          deprecation: { reason: 'bypass', deprecated_at: NOW },
        }),
      ),
    ).toThrow('dedicated')
    const changed = (
      await advanceExperimentResearchVersion(nodeMutationFs, target, {
        ...lock,
        expectedVersion: 1,
        reason: 'Correction',
      })
    ).description
    changed.research!.run_versions[A] = 2
    expect(
      parseExperimentDescription(serializeExperimentDescription(changed)).parseErrors[0]!.message,
    ).toContain('snapshot association')
  })

  it('upgrades only current CSV and preserves historical schema for late result writes', async () => {
    const { project, target, path, lock } = await fixture()
    const advanced = (
      await advanceExperimentResearchVersion(nodeMutationFs, target, {
        ...lock,
        expectedVersion: 1,
        reason: 'Corrected protocol',
      })
    ).description
    const next = enrollResearchRun(advanced, B, 2, 'New execution', 'created', NOW, 'V0001')
    await fs.writeFile(path, serializeExperimentDescription(next))
    await fs.writeFile(
      target.readmePath,
      `---\nid: ${EXP}\nslug: trial\ntitle: Trial\nstatus: OPEN\nruns: [${A}, ${B}]\n---\n`,
    )
    for (const run of [A, B]) {
      await fs.mkdir(project.path(run), { recursive: true })
      await fs.writeFile(project.path(run, 'README.md'), '---\nstatus: FINISHED\n---\n')
      await fs.writeFile(
        project.path(run, 'result.csv'),
        'path,stat,value\n$experiment_schema_version,,1\nmetrics.score,,7\n',
      )
    }
    const before = await fs.readFile(project.path(A, 'result.csv'), 'utf8')
    await fs.mkdir(project.path('docs/experiments', EXP, 'schema-upgrades'), { recursive: true })
    await fs.writeFile(
      project.path('docs/experiments', EXP, 'schema-upgrades/1-to-2.json'),
      JSON.stringify({
        from: 1,
        to: 2,
        operations: [{ op: 'rename', from: 'metrics.score', to: 'metrics.quality' }],
      }),
    )
    const plan = await planSchemaUpgrade(project.root, EXP, 2)
    expect(plan.skipped).toContain(A)
    await applySchemaUpgrade(project.root, plan)
    expect(await fs.readFile(project.path(A, 'result.csv'), 'utf8')).toBe(before)
    expect(await fs.readFile(project.path(B, 'result.csv'), 'utf8')).toContain('metrics.quality')
    await writeRunResult({
      projectRoot: project.root,
      runDir: project.path(A),
      set: [{ path: 'metrics.score', value: 9 }],
    })
    expect(await fs.readFile(project.path(A, 'result.csv'), 'utf8')).toContain(
      '$experiment_schema_version,,1',
    )
  })

  it('keeps legacy deprecation-like custom fields opaque and preserves malformed-parser failures', () => {
    const raw = JSON.parse(serializeExperimentDescription(legacy()))
    raw.variants[0].deprecated = true
    raw.variants[0].deprecation = 'user-defined legacy text'
    const parsed = parseExperimentDescription(JSON.stringify(raw)).data!
    expect(parsed.variants[0]!.deprecated).toBeUndefined()
    expect(parsed.variants[0]!.extra).toMatchObject({
      deprecated: true,
      deprecation: 'user-defined legacy text',
    })
    expect(JSON.parse(serializeExperimentDescription(parsed)).variants[0].deprecated).toBe(true)
    expect(
      parseExperimentDescription('{"experiment_schema_version":1,"variants":[null]}').data,
    ).toBeNull()
  })

  it('serializes concurrent advance calls and rejects physical path escape', async () => {
    const { project, target, lock } = await fixture()
    const outcomes = await Promise.allSettled(
      [1, 2].map(() =>
        advanceExperimentResearchVersion(nodeMutationFs, target, {
          ...lock,
          expectedVersion: 1,
          reason: 'Correction',
        }),
      ),
    )
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const outside = await createTempProject({
      files: { 'README.md': 'outside', 'experiment.json': '{}' },
    })
    await fs.symlink(outside.root, project.path('escape'))
    await expect(
      advanceExperimentResearchVersion(
        nodeMutationFs,
        { ...target, readmePath: project.path('escape/README.md') },
        { ...lock, expectedVersion: 1, reason: 'Escape' },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
  it('imports a historical association only into its existing snapshot identity', async () => {
    const { target, lock } = await fixture()
    const advanced = (
      await advanceExperimentResearchVersion(nodeMutationFs, target, {
        ...lock,
        expectedVersion: 1,
        reason: 'Correction',
      })
    ).description
    const imported = enrollResearchRun(
      advanced,
      B,
      1,
      'Recovered original execution',
      'historical',
      NOW,
      'V0001',
    )
    expect(imported.variants[0]!.runs).toContain(B)
    expect(
      (imported.research!.versions[0]!.snapshot!.variants as Record<string, { runs: string[] }>)
        .V0001!.runs,
    ).toContain(B)
    expect(() => enrollResearchRun(advanced, B, 1, 'Import', 'historical', NOW, 'V9999')).toThrow(
      'Unknown Variant',
    )
  })

  it('round trips keyed variants while retaining legacy arrays and custom fields', () => {
    const old = legacy()
    expect(Array.isArray(JSON.parse(serializeExperimentDescription(old)).variants)).toBe(true)
    const current = initializeExperimentResearch(old, [A], NOW, 'Initial')
    const raw = JSON.parse(serializeExperimentDescription(current))
    expect(raw.variants.V0001.id).toBeUndefined()
    expect(raw.custom).toEqual({ retained: true })
    expect(parseExperimentDescription(JSON.stringify(raw)).data).toEqual(current)
    delete raw.research
    expect(parseExperimentDescription(JSON.stringify(raw)).data).toBeNull()
  })
  it('advances atomically and prevents stale retry while excluding every old result and frozen fallback', async () => {
    const { target, lock } = await fixture()
    const changed = await advanceExperimentResearchVersion(nodeMutationFs, target, {
      ...lock,
      expectedVersion: 1,
      reason: 'Invalid old protocol',
    })
    expect(changed.currentVersion).toBe(2)
    expect(changed.description.variants[0]!.runs).toEqual([A])
    expect(changed.description.variants[0]!.frozen).toBeUndefined()
    expect(changed.description.research!.versions[0]!.snapshot).toBeDefined()
    await expect(
      advanceExperimentResearchVersion(nodeMutationFs, target, {
        ...lock,
        expectedVersion: 1,
        reason: 'Retry',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    const summary = summarize(changed.description)
    expect(summary.variants[0]).toMatchObject({ status: 'PLANNED', evidence: [] })
    expect(summary.variants[0]!.cells['metrics.score']).toBeUndefined()
    expect(summary.variants[0]!.others[0]!.exclusion_reason).toBe('historical_version')
  })
  it('isolates schema validation and uses snapshot plans for history', async () => {
    const { target, lock } = await fixture()
    const advanced = (
      await advanceExperimentResearchVersion(nodeMutationFs, target, {
        ...lock,
        expectedVersion: 1,
        reason: 'New protocol',
      })
    ).description
    const next = enrollResearchRun(advanced, B, 2, 'New execution', 'created', NOW)
    next.experimentSchemaVersion = 2
    next.variants[0]!.runs.push(B)
    next.variants[0]!.values['params.rate'] = 2
    const current = summarize(next)
    expect(current.outcome).toBe('ok')
    expect(current.variants[0]!.evidence).toEqual([B])
    expect(current.variants[0]!.cells['metrics.score']).toMatchObject({ value: 7 })
    const historical = summarize(next, 1)
    expect(historical.variants[0]!.evidence).toEqual([A])
    expect(historical.diagnostics.some((d) => d.code === 'VARIANT_PARAM_MISMATCH')).toBe(false)
    expect(historical.historical_results?.[A]).toContain('90')
  })
  it('rejects relabel, current historical imports and generic ledger mutation', () => {
    const description = initializeExperimentResearch(legacy(), [A], NOW, 'Initial')
    expect(() => enrollResearchRun(description, A, 2, 'Promote', 'created')).toThrow(
      'cannot be changed',
    )
    expect(() => enrollResearchRun(description, B, 1, 'Import', 'historical')).toThrow(
      'cannot enroll current',
    )
    const next = structuredClone(description)
    next.research!.run_versions[A] = 2
    expect(() => assertResearchDescriptionEdit(description, next)).toThrow('dedicated')
    const deleted = structuredClone(description)
    deleted.variants = []
    expect(() => assertResearchDescriptionEdit(description, deleted)).toThrow('cannot be deleted')
  })
  it('deprecates without changing attribution and restores with retained reason', async () => {
    const { target, lock } = await fixture()
    const deprecated = await setExperimentVariantDeprecation(nodeMutationFs, target, {
      ...lock,
      variantId: 'V0001',
      deprecated: true,
      reason: 'Withdrawn',
    })
    expect(summarize(deprecated.description).variants[0]!.evidence).toEqual([])
    const restored = await setExperimentVariantDeprecation(nodeMutationFs, target, {
      expectedMtime: deprecated.mtime,
      expectedHash: deprecated.hash,
      now: NOW,
      variantId: 'V0001',
      deprecated: false,
      reason: 'Reviewed',
    })
    expect(restored.description.variants[0]!.deprecation_history?.[0]).toMatchObject({
      reason: 'Withdrawn',
      restore_reason: 'Reviewed',
    })
    expect(restored.description.research!.run_versions[A]).toBe(1)
  })
})
