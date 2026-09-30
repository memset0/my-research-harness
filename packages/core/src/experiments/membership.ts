import { relative } from 'node:path'
import { formatIsoLocal } from '../time.js'
import type { Experiment, ExperimentMembershipAnomaly, Run } from '../types.js'

export interface MembershipResult {
  /** Map from experiment id to confirmed member run dir base names. */
  confirmedMembers: Map<string, string[]>
  /** All anomalies, ordered by detectedAt asc (caller may reverse). */
  anomalies: ExperimentMembershipAnomaly[]
}

export interface MembershipInput {
  experiments: Experiment[]
  runs: Run[]
  /**
   * Project name used for the anomaly records' `project` field. Inputs
   * are assumed to be already filtered to a single project.
   */
  project: string
  projectRoot?: string
  /** ISO8601 with the local offset; defaults to now. */
  detectedAt?: string
}

export function computeMembership(input: MembershipInput): MembershipResult {
  const detectedAt = input.detectedAt ?? formatIsoLocal(new Date())
  const project = input.project

  const runByDir = new Map<string, Run>()
  for (const run of input.runs)
    runByDir.set(
      input.projectRoot ? relative(input.projectRoot, run.path).split('\\').join('/') : run.id,
      run,
    )

  const legacyBuckets = new Map<string, Run[]>()
  for (const run of input.runs)
    legacyBuckets.set(run.id, [...(legacyBuckets.get(run.id) ?? []), run])
  for (const [id, candidates] of legacyBuckets)
    if (candidates.length === 1) runByDir.set(id, candidates[0]!)
  const ownersByPath = new Map<string, Set<string>>()
  for (const experiment of input.experiments) {
    for (const reference of experiment.frontMatter.runs) {
      const run = runByDir.get(reference)
      if (!run) continue
      const owners = ownersByPath.get(run.path) ?? new Set<string>()
      owners.add(experiment.id)
      ownersByPath.set(run.path, owners)
    }
  }
  const confirmedMembers = new Map<string, string[]>()
  const anomalies: ExperimentMembershipAnomaly[] = []

  // For every experiment, walk its `runs[]` and classify each entry.
  for (const exp of input.experiments) {
    const confirmed: string[] = []
    for (const runDirName of exp.frontMatter.runs) {
      const run = runByDir.get(runDirName)
      if (!run) {
        anomalies.push({
          code: 'PHANTOM_RUN_REF',
          project,
          experimentId: exp.id,
          runId: runDirName,
          message: `experiment ${exp.id} lists run "${runDirName}" but the run dir was not discovered`,
          detectedAt,
        })
        continue
      }
      const owners = ownersByPath.get(run.path)!
      if (owners.size > 1) {
        anomalies.push({
          code: 'MISMATCH_EXPERIMENT_REF',
          project,
          experimentId: exp.id,
          runId: runDirName,
          message: `Run path has multiple Experiment owners: ${runDirName}`,
          detectedAt,
        })
        continue
      }
      confirmed.push(runDirName)
    }
    confirmedMembers.set(exp.id, confirmed)
  }

  // v3 task 5.5: surface slug-uniqueness anomalies at the project-join
  // level so they show up in /api/anomalies + memon doctor (rather than
  // only in the create-time error path).
  //
  //   - DUPLICATE_EXPERIMENT_SLUG: two exp docs share the same slug —
  //     normally impossible (the create-time allocator forbids it), but
  //     possible if someone manually copies a file.
  //   - EXPERIMENT_SLUG_PREFIX_COLLISION: one exp slug is a prefix of
  //     another (e.g. `fsdp` and `fsdp-collective`) — ambiguous when
  //     resolving run ids by prefix to their parent exp.
  //   - RUN_SLUG_PREFIX_VIOLATION: a confirmed-member run's slug doesn't
  //     start with its parent exp's slug. The CLI emits this as a soft
  //     warning at link-time; here we surface it for already-bound runs
  //     too so doctor can see the full set.
  //
  // Run slugs MAY repeat across different timestamps within a project
  // (two attempts of the same investigation share a slug); the
  // timestamp suffix already disambiguates the dir name, so we DO NOT
  // emit a `DUPLICATE_RUN_SLUG` anomaly.
  const expSlugBuckets = new Map<string, Experiment[]>()
  for (const exp of input.experiments) {
    const slug = exp.frontMatter.slug
    if (!slug) continue
    const arr = expSlugBuckets.get(slug) ?? []
    arr.push(exp)
    expSlugBuckets.set(slug, arr)
  }
  for (const [slug, arr] of expSlugBuckets) {
    if (arr.length <= 1) continue
    for (const exp of arr) {
      anomalies.push({
        code: 'DUPLICATE_EXPERIMENT_SLUG',
        project,
        experimentId: exp.id,
        runId: null,
        message: `experiment ${exp.id} shares slug "${slug}" with ${arr
          .filter((e) => e.id !== exp.id)
          .map((e) => e.id)
          .join(', ')}`,
        detectedAt,
      })
    }
  }
  const sortedSlugs = Array.from(expSlugBuckets.keys()).sort()
  for (let i = 0; i < sortedSlugs.length; i++) {
    const a = sortedSlugs[i]!
    for (let j = i + 1; j < sortedSlugs.length; j++) {
      const b = sortedSlugs[j]!
      if (b.startsWith(`${a}-`)) {
        // a is a prefix of b — flag both exps so they show up in any per-id view.
        for (const exp of [...(expSlugBuckets.get(a) ?? []), ...(expSlugBuckets.get(b) ?? [])]) {
          anomalies.push({
            code: 'EXPERIMENT_SLUG_PREFIX_COLLISION',
            project,
            experimentId: exp.id,
            runId: null,
            message: `experiment slug "${exp.frontMatter.slug}" collides with prefix "${a}"`,
            detectedAt,
          })
        }
      }
    }
  }

  const runDirRe = /^(?<slug>[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*)-\d{6}-\d{6}$/
  for (const exp of input.experiments) {
    for (const runDir of exp.frontMatter.runs) {
      const run = runByDir.get(runDir)
      if (!run) continue // PHANTOM already reported
      const m = runDirRe.exec(run.id)
      if (!m?.groups) continue
      const runSlug = m.groups.slug!
      if (!runSlug.startsWith(exp.frontMatter.slug)) {
        anomalies.push({
          code: 'RUN_SLUG_PREFIX_VIOLATION',
          project,
          experimentId: exp.id,
          runId: run.id,
          message: `run slug "${runSlug}" does not start with experiment slug "${exp.frontMatter.slug}"`,
          detectedAt,
        })
      }
    }
  }

  return { confirmedMembers, anomalies }
}
