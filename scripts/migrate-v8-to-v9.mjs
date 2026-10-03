// Operator entry for the mechanical FS v8 -> v9 migration (Results model).
// See scripts/migrate-v8-to-v9.md and packages/core/migrations/v8-to-v9.md.
// Prints counts and project-relative paths only, never document content; the
// plan file (mode 0600, outside the project) holds the planned file contents.

import { readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve, sep } from 'node:path'
import {
  applyResultsMigration,
  planResultsMigration,
  rollbackResultsMigration,
  verifyResultsMigration,
} from '../packages/core/dist/migrations/v8-to-v9.js'

const LIST_LIMIT = 40
const [mode, target, output, ...rest] = process.argv.slice(2)
const args = [output, ...rest].filter((value) => value !== undefined)
const flag = (name) => args.includes(name)
const values = (name) => args.flatMap((value, index) => (value === name ? [args[index + 1]] : []))
const single = (name) => {
  const found = values(name)
  return found.length > 0 ? found[found.length - 1] : undefined
}
const runDirs = values('--run-dir')
const runDirOptions = runDirs.length > 0 ? { cliRunDirs: runDirs } : {}
const usage =
  'Usage: node scripts/migrate-v8-to-v9.mjs plan PROJECT PLAN [--sidecar-name NAME] [--resolutions FILE] [--allow-dirty] [--run-dir P]... | apply PLAN BACKUP_DIRECTORY [--no-commit] | verify PROJECT [--run-dir P]... | rollback BACKUP_DIRECTORY'

function fail(message, code = 2) {
  console.error(message)
  process.exitCode = code
}

const capped = (items) =>
  items.length > LIST_LIMIT
    ? [...items.slice(0, LIST_LIMIT), `… ${items.length - LIST_LIMIT} more (see the plan file)`]
    : items

async function outsideProject(project, path) {
  const root = await realpath(project)
  const full = resolve(await realpath(dirname(resolve(path))), basename(path))
  return full !== root && !full.startsWith(root + sep)
}

async function readResolutions(file) {
  if (file === undefined) return {}
  const parsed = JSON.parse(await readFile(file, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`${file} must be a JSON object of blocker id -> choice`)
  for (const [id, choice] of Object.entries(parsed))
    if (typeof choice !== 'string')
      throw new Error(`${file}: the resolution of ${id} must be a string`)
  return parsed
}

/** Notices grouped by code: a count and where they occur (never their text). */
function noticeSummary(notices) {
  const grouped = {}
  for (const notice of notices) {
    if (!grouped[notice.code]) grouped[notice.code] = { count: 0, at: [] }
    const entry = grouped[notice.code]
    entry.count += 1
    const where = [notice.experiment, notice.variant, notice.path, notice.run]
      .filter((part) => typeof part === 'string' && part.length > 0)
      .join(' ')
    if (where && !entry.at.includes(where)) entry.at.push(where)
  }
  for (const entry of Object.values(grouped)) entry.at = capped(entry.at)
  return grouped
}

function planSummary(plan) {
  const actions = {}
  for (const file of plan.files) actions[file.action] = (actions[file.action] ?? 0) + 1
  return {
    from: plan.from,
    alreadyMigrated: plan.alreadyMigrated,
    git: plan.git,
    allowDirty: plan.allowDirty,
    sidecarName: plan.sidecarName,
    runDirs: plan.runDirs,
    experiments: plan.experiments,
    files: {
      counts: actions,
      paths: capped(plan.files.map((file) => `${file.action} ${file.path}`)),
    },
    allowRules: plan.allowRules.map((rule) => ({
      file: rule.file,
      lines: rule.lines,
      overrides: rule.overrides,
      locations: rule.locations,
      runCount: rule.runs.length,
      runs: capped(rule.runs),
    })),
    counts: plan.counts,
    defaults: {
      // Each of the three formerly blocking situations, counted separately.
      plusMinusToStats: plan.counts.PLUS_MINUS_TO_STATS ?? 0,
      numbersAsMean: plan.counts.MIGRATED_NUMBER_AS_MEAN ?? 0,
      statsColumns: plan.counts.statsColumns ?? 0,
      cellsNotConverted: plan.counts.RESULT_CELL_NOT_CONVERTED ?? 0,
      finishedAttemptsKeptAsHistory: plan.counts.finishedAttemptsKept ?? 0,
      legacyResultFilesRenamed: (plan.legacyRenames ?? []).length,
    },
    // Every rename is listed (never capped): the migration commit and rollback cover them.
    legacyRenames: (plan.legacyRenames ?? []).map((rename) => `${rename.from} -> ${rename.to}`),
    notices: noticeSummary(plan.notices),
    expectedLintErrors: Object.fromEntries(
      Object.entries(plan.expected.lint).filter(([, errors]) => errors.length > 0),
    ),
    blockers: plan.blockers.map((blocker) => ({
      id: blocker.id,
      code: blocker.code,
      experiment: blocker.experiment,
      ...(blocker.run ? { run: blocker.run } : {}),
      message: blocker.message,
      choices: blocker.choices,
      ...(blocker.resolution ? { resolution: blocker.resolution } : {}),
    })),
    unresolved: plan.unresolved,
  }
}

try {
  if (mode === 'plan' && target && output && !output.startsWith('--')) {
    if (!(await outsideProject(target, output))) {
      fail('the plan file must live outside the project (it holds planned file contents)')
    } else {
      const sidecarName = single('--sidecar-name')
      const plan = await planResultsMigration(target, {
        allowDirty: flag('--allow-dirty'),
        ...runDirOptions,
        ...(sidecarName ? { sidecarName } : {}),
        resolutions: await readResolutions(single('--resolutions')),
      })
      await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
      console.log(JSON.stringify(planSummary(plan), null, 2))
      if (plan.unresolved.length > 0) process.exitCode = 1
    }
  } else if (mode === 'apply' && target && output && !output.startsWith('--')) {
    const plan = JSON.parse(await readFile(target, 'utf8'))
    const result = await applyResultsMigration(plan, output, { commit: !flag('--no-commit') })
    console.log(
      JSON.stringify(
        {
          status: result.status,
          commit: result.commit,
          backup: result.backup,
          changedCount: result.changed.length,
          changed: capped(result.changed),
        },
        null,
        2,
      ),
    )
  } else if (mode === 'verify' && target) {
    const result = await verifyResultsMigration(target, runDirOptions)
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
  } else if (mode === 'rollback' && target) {
    const result = await rollbackResultsMigration(target)
    console.log(JSON.stringify(result, null, 2))
  } else {
    fail(usage)
  }
} catch (error) {
  fail(`${mode ?? 'migrate'} failed: ${error instanceof Error ? error.message : String(error)}`, 1)
}
