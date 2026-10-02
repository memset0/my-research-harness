// Operator entry for the mechanical FS v7 -> v8 migration (derived index).
// See scripts/migrate-v7-to-v8.md and packages/core/migrations/v7-to-v8.md.
// Prints counts and project-relative paths only, never document content.

import { readFile, writeFile } from 'node:fs/promises'
import {
  applyDerivedIndexMigration,
  planDerivedIndexMigration,
  rollbackDerivedIndexMigration,
  verifyDerivedIndexMigration,
} from '../packages/core/dist/migrations/v7-to-v8.js'

const [mode, target, output, ...rest] = process.argv.slice(2)
const args = [output, ...rest].filter((value) => value !== undefined)
const flag = (name) => args.includes(name)
const runDirs = args.flatMap((value, index) => (value === '--run-dir' ? [args[index + 1]] : []))
const runDirOptions = runDirs.length > 0 ? { cliRunDirs: runDirs } : {}
const usage =
  'Usage: node scripts/migrate-v7-to-v8.mjs plan PROJECT PLAN [--allow-dirty] [--run-dir P]... | apply PLAN BACKUP_DIRECTORY [--acknowledge-warnings] [--no-commit] | verify PROJECT [--run-dir P]... | rollback BACKUP_DIRECTORY'

if (mode === 'plan' && target && output && !output.startsWith('--')) {
  const plan = await planDerivedIndexMigration(target, {
    allowDirty: flag('--allow-dirty'),
    ...runDirOptions,
  })
  await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  console.log(
    JSON.stringify(
      {
        from: plan.from,
        alreadyMigrated: plan.alreadyMigrated,
        git: plan.git,
        runDirs: plan.runDirs,
        declarationPresent: plan.declarationPresent,
        indexPresent: plan.indexPresent,
        counts: plan.counts,
        outsideRunDirs: plan.outsideRunDirs,
        nested: plan.nested,
        warnings: plan.warnings,
        blockers: plan.blockers,
      },
      null,
      2,
    ),
  )
  if (plan.blockers.length > 0) process.exitCode = 1
} else if (mode === 'apply' && target && output && !output.startsWith('--')) {
  const plan = JSON.parse(await readFile(target, 'utf8'))
  const result = await applyDerivedIndexMigration(plan, output, {
    acknowledgeWarnings: flag('--acknowledge-warnings'),
    commit: !flag('--no-commit'),
  })
  console.log(JSON.stringify(result, null, 2))
} else if (mode === 'verify' && target) {
  const result = await verifyDerivedIndexMigration(target, runDirOptions)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
} else if (mode === 'rollback' && target) {
  const result = await rollbackDerivedIndexMigration(target)
  console.log(JSON.stringify(result, null, 2))
} else {
  console.error(usage)
  process.exitCode = 2
}
