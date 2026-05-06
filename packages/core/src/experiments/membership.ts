// Compute experiment ↔ run membership and surface the three anomaly
// classes (ORPHAN_RUN, PHANTOM_RUN_REF, MISMATCH_EXPERIMENT_REF) per
// `experiment-membership-anomalies` capability.
//
// Inputs are the discovered experiment-doc index and the discovered
// run index (both already parsed). Output is a per-experiment confirmed-
// member list and a flat anomaly list scoped by project.

import type {
  Experiment,
  ExperimentMembershipAnomaly,
  Run,
} from '../types.js'

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
  /** ISO8601 with offset; default `new Date().toISOString()`-with-local-offset. */
  detectedAt?: string
}

/**
 * Membership = intersection: a run is a confirmed member of experiment E
 * iff `run.frontMatter.experiment === E.id` AND `E.frontMatter.runs[]`
 * contains the run's dir base name. Single-sided claims are anomalies.
 */
export function computeMembership(input: MembershipInput): MembershipResult {
  const detectedAt = input.detectedAt ?? new Date().toISOString()
  const project = input.project

  const expById = new Map<string, Experiment>()
  for (const exp of input.experiments) expById.set(exp.id, exp)

  const runByDir = new Map<string, Run>()
  for (const run of input.runs) runByDir.set(run.id, run)

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
      if (run.frontMatter.experiment !== exp.id) {
        anomalies.push({
          code: 'MISMATCH_EXPERIMENT_REF',
          project,
          experimentId: exp.id,
          runId: runDirName,
          message:
            run.frontMatter.experiment === null || run.frontMatter.experiment === ''
              ? `experiment ${exp.id} lists run "${runDirName}" but the run's experiment field is empty`
              : `experiment ${exp.id} lists run "${runDirName}" but the run says it belongs to ${run.frontMatter.experiment}`,
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
  //   - DUPLICATE_RUN_SLUG: two run dirs share the same `<slug>` portion
  //     (the part before `-yymmdd-hhmmss`); harmless but worth surfacing
  //     since it can confuse search.
  //   - RUN_SLUG_PREFIX_VIOLATION: a confirmed-member run's slug doesn't
  //     start with its parent exp's slug. The CLI emits this as a soft
  //     warning at link-time; here we surface it for already-bound runs
  //     too so doctor can see the full set.
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

  const runSlugBuckets = new Map<string, Run[]>()
  const runDirRe = /^(?<slug>[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*)-\d{6}-\d{6}$/
  for (const run of input.runs) {
    const m = runDirRe.exec(run.id)
    if (!m?.groups) continue
    const slug = m.groups.slug!
    const arr = runSlugBuckets.get(slug) ?? []
    arr.push(run)
    runSlugBuckets.set(slug, arr)
  }
  for (const [slug, arr] of runSlugBuckets) {
    if (arr.length <= 1) continue
    for (const run of arr) {
      anomalies.push({
        code: 'DUPLICATE_RUN_SLUG',
        project,
        experimentId: null,
        runId: run.id,
        message: `run "${run.id}" shares slug "${slug}" with ${arr
          .filter((r) => r.id !== run.id)
          .map((r) => r.id)
          .join(', ')}`,
        detectedAt,
      })
    }
  }
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

  // For every run, check whether its `experiment` field is honored on the
  // other side. We look for orphans (no experiment claim) and mismatches
  // not already reported above (a run claims E_a but E_a doesn't list it).
  for (const run of input.runs) {
    const claimed = run.frontMatter.experiment
    if (!claimed) {
      anomalies.push({
        code: 'ORPHAN_RUN',
        project,
        experimentId: null,
        runId: run.id,
        message: `run "${run.id}" has no experiment binding (frontmatter experiment: empty)`,
        detectedAt,
      })
      continue
    }
    const exp = expById.get(claimed)
    if (!exp) {
      // The run claims a non-existent experiment. We treat this as
      // ORPHAN_RUN — there is no exp to resolve to and no E.runs[] entry
      // to compare against. (PHANTOM is reserved for the reverse direction.)
      anomalies.push({
        code: 'ORPHAN_RUN',
        project,
        experimentId: claimed,
        runId: run.id,
        message: `run "${run.id}" claims experiment ${claimed} but no such experiment was discovered`,
        detectedAt,
      })
      continue
    }
    if (!exp.frontMatter.runs.includes(run.id)) {
      anomalies.push({
        code: 'MISMATCH_EXPERIMENT_REF',
        project,
        experimentId: claimed,
        runId: run.id,
        message: `run "${run.id}" claims experiment ${claimed} but ${claimed}.runs[] does not include this run`,
        detectedAt,
      })
    }
  }

  return { confirmedMembers, anomalies }
}
