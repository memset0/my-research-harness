// Explicit operator entry. Software deployment never invokes this script.
import { readFile, writeFile } from 'node:fs/promises'
import {
  applyResearchMigration,
  planResearchMigration,
  rollbackResearchMigration,
  verifyResearchMigration,
} from '../packages/core/dist/migrations/v9-to-v10.js'

const [mode, target, output, ...flags] = process.argv.slice(2)
if (mode === 'plan' && target && output) {
  const plan = await planResearchMigration(target, { allowDirty: flags.includes('--allow-dirty') })
  await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  console.log(
    JSON.stringify(
      {
        migration: plan.migration,
        alreadyMigrated: plan.alreadyMigrated,
        experiments: plan.experiments,
        files: plan.files.map(({ path }) => path),
        blockers: plan.blockers,
      },
      null,
      2,
    ),
  )
  if (plan.blockers.length) process.exitCode = 1
} else if (mode === 'apply' && target && output) {
  console.log(
    JSON.stringify(
      await applyResearchMigration(JSON.parse(await readFile(target, 'utf8')), output),
      null,
      2,
    ),
  )
} else if (mode === 'verify' && target) {
  const result = await verifyResearchMigration(target)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
} else if (mode === 'rollback' && target) {
  console.log(JSON.stringify(await rollbackResearchMigration(target), null, 2))
} else {
  console.error(
    'Usage: node scripts/migrate-v9-to-v10.mjs plan PROJECT PLAN [--allow-dirty] | apply PLAN NEW_EXTERNAL_BACKUP_DIRECTORY | verify PROJECT | rollback BACKUP_DIRECTORY',
  )
  process.exitCode = 2
}
