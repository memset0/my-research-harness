// memon experiment schema upgrade <id> --to <N> [--apply] (FS v9).
//
// Without `--apply` this is a dry run: the description file and every member
// `result.csv` are transformed in memory through the consecutive
// `schema-upgrades/<N>-to-<N+1>.{json,py}` steps and the per-file row
// differences are printed; nothing is written and nothing is journaled. With
// `--apply` core refuses while a member Run is RUNNING, backs up every file it
// changes under `.memon/backups/schema-upgrade/`, replaces each file
// atomically after re-checking that nobody changed it since the plan,
// verifies the result and restores every file from the backup on failure.
// The rewritten files are ordinary tracked changes for the user to commit.

import {
  applySchemaUpgrade,
  MutationError,
  planSchemaUpgrade,
  resolveExperimentId,
  type SchemaUpgradePlan,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitJson, type OutputFormat } from '../lib/output.js'

export interface ExperimentSchemaUpgradeInput {
  projectRoot?: string
  cwd: string
  idOrSlug: string
  format: OutputFormat
  /** Target `experiment_schema_version` (a positive integer). */
  to: string
  apply: boolean
}

function exitWithUpgradeError(error: MutationError): never {
  const details = { ...(error.reason ? { reason: error.reason } : {}), ...error.details }
  const code =
    error.code === 'BAD_REQUEST' || error.code === 'FORBIDDEN'
      ? 'BAD_REQUEST'
      : error.code === 'NOT_FOUND' || error.code === 'CONFLICT'
        ? error.code
        : 'BAD_STATE'
  emitErrorAndExit(code, error.message, details)
}

function planOutput(plan: SchemaUpgradePlan) {
  const files = plan.files.map((file) => ({
    path: file.path,
    kind: file.kind,
    from: file.from,
    to: file.to,
    changed: file.changed,
    rows: file.rows,
    problems: file.problems,
  }))
  return {
    experimentId: plan.experimentId,
    to: plan.to,
    steps: plan.steps,
    files,
    changed: files.filter((file) => file.changed).map((file) => file.path),
    skipped: plan.skipped,
    warnings: plan.warnings,
    problems: plan.files.flatMap((file) =>
      file.problems.map((problem) => `${file.path}: ${problem}`),
    ),
  }
}

function renderPlan(plan: ReturnType<typeof planOutput>): string {
  const lines = [`${plan.experimentId}: upgrade to experiment_schema_version ${plan.to} (dry run)`]
  for (const step of plan.steps) lines.push(`step ${step.from}-to-${step.to}: ${step.file}`)
  for (const file of plan.files) {
    if (!file.changed) {
      lines.push(`  ${file.path}: unchanged (version ${file.from})`)
      continue
    }
    lines.push(`  ${file.path}: ${file.from} -> ${file.to}, ${file.rows.length} row change(s)`)
    for (const row of file.rows) {
      const label = row.stat ? `${row.path}:${row.stat}` : row.path
      if (row.change === 'added') lines.push(`    + ${label}=${row.after ?? ''}`)
      else if (row.change === 'removed') lines.push(`    - ${label}=${row.before ?? ''}`)
      else lines.push(`    ~ ${label}: ${row.before ?? ''} -> ${row.after ?? ''}`)
    }
    for (const problem of file.problems) lines.push(`    ! ${problem}`)
  }
  for (const run of plan.skipped) lines.push(`  ${run}: no result file (skipped)`)
  for (const warning of plan.warnings) lines.push(`warning: ${warning}`)
  lines.push(
    plan.changed.length === 0
      ? 'nothing to upgrade'
      : `re-run with --apply to rewrite ${plan.changed.length} file(s)`,
  )
  return `${lines.join('\n')}\n`
}

export async function runExperimentSchemaUpgrade(
  input: ExperimentSchemaUpgradeInput,
): Promise<void> {
  if (!/^[1-9]\d*$/.test(input.to))
    emitErrorAndExit('BAD_REQUEST', `--to must be a positive integer, got "${input.to}"`)
  const to = Number(input.to)
  const context = await resolveContext(input)
  const projectRoot = singleProjectRoot(context)
  const id = await resolveExperimentId(projectRoot, input.idOrSlug)
  if (!id) emitErrorAndExit('NOT_FOUND', `experiment "${input.idOrSlug}" not found`)
  let plan: SchemaUpgradePlan
  try {
    plan = await planSchemaUpgrade(projectRoot, id, to)
  } catch (error) {
    if (error instanceof MutationError) exitWithUpgradeError(error)
    throw error
  }
  const summary = planOutput(plan)
  if (!input.apply) {
    if (input.format === 'human') process.stdout.write(renderPlan(summary))
    else emitJson({ ok: true, applied: false, ...summary })
    return
  }
  let result: Awaited<ReturnType<typeof applySchemaUpgrade>>
  try {
    result = await applySchemaUpgrade(projectRoot, plan)
  } catch (error) {
    if (error instanceof MutationError) exitWithUpgradeError(error)
    throw error
  }
  const output = {
    ok: true,
    applied: result.status === 'applied',
    status: result.status,
    experimentId: id,
    to,
    backup: result.backup,
    changed: result.changed,
    skipped: plan.skipped,
    warnings: plan.warnings,
  }
  if (input.format === 'human')
    process.stdout.write(
      result.status === 'applied'
        ? `${id}: upgraded to experiment_schema_version ${to}\n${result.changed.map((path) => `  ${path}`).join('\n')}\nbackup: ${result.backup}\nreview and commit the changed files\n`
        : `${id}: already at experiment_schema_version ${to}; nothing changed\n`,
    )
  else emitJson(output)
}
