import { readFile, writeFile } from 'node:fs/promises'
import {
  applyMembershipMigration,
  planMembershipMigration,
  rollbackMembershipMigration,
} from '../packages/core/dist/index.js'

const [mode, target, output, ...flags] = process.argv.slice(2)
if (mode === 'plan' && target && output) {
  const plan = await planMembershipMigration(target, {
    allowDirty: flags.includes('--allow-dirty'),
    dropRunOnlyClaims: flags.includes('--drop-run-only-claims'),
    keepVersion: flags.includes('--keep-version'),
  })
  await writeFile(output, JSON.stringify(plan, null, 2), { mode: 0o600, flag: 'wx' })
  console.log(
    JSON.stringify({
      files: plan.files.filter((file) => file.before !== file.after).length,
      inspectedFiles: plan.files.length,
      digests: plan.digests?.documents.map(({ source, target }) => ({ source, target })) ?? [],
      blockers: plan.blockers,
      warnings: plan.warnings,
      droppedClaims: plan.droppedClaims.length,
    }),
  )
  if (plan.blockers.length) process.exitCode = 1
} else if (mode === 'rollback' && target) {
  await rollbackMembershipMigration(target)
  console.log('Migration preimages restored; unrelated edits preserved')
} else if (mode === 'verify' && target) {
  const plan = await planMembershipMigration(target, {
    allowDirty: true,
    keepVersion: process.argv.includes('--keep-version'),
  })
  const changes = plan.files.filter((file) => file.before !== file.after)
  console.log(
    JSON.stringify({
      blockers: plan.blockers,
      pendingFiles: [
        ...changes.map((file) => file.path),
        ...(plan.digests?.documents.map((document) => document.source) ?? []),
      ],
      warnings: plan.warnings,
    }),
  )
  if (plan.blockers.length || changes.length || plan.digests?.documents.length) process.exitCode = 1
} else if (mode === 'apply' && target && output) {
  await applyMembershipMigration(JSON.parse(await readFile(target, 'utf8')), output)
  console.log('Migration applied and file postimages verified')
} else {
  throw new Error(
    'Usage: node scripts/migrate-v6-to-v7.mjs plan PROJECT PLAN [--allow-dirty --drop-run-only-claims --keep-version] | apply PLAN BACKUP_DIRECTORY | verify PROJECT [--keep-version] | rollback BACKUP_DIRECTORY',
  )
}
