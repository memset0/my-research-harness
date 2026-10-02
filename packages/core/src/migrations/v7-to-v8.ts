// FS convention v7 -> v8: the mechanical derived-index migration.
//
// The step adds the derived index `.memon/index/` (a self-ignored, rebuildable
// cache) and advances the marker. It never reads a document for rewriting and
// never creates, edits or deletes `.memon/project.yml`: the v8 default Run
// locations cover the common layouts, and Runs outside the effective locations
// are reported by the plan for the operator to acknowledge (and, after the
// migration, to declare by hand).
//
//   plan     read-only: marker 7, worktree state, effective run_dirs, a dry-run
//            rebuild with the run-dirs audit, nested declarations.
//   apply    back up `.memon/` outside the project, rebuild the index, verify it
//            (no drift, snapshot git-ignored), write the marker 7 -> 8 last and,
//            in Git mode, commit exactly `.memon/version.json`. Any failure
//            before the marker restores the index to its previous state.
//   verify   marker 8, index present and drift-free, ignored in Git mode,
//            declaration untouched.
//   rollback marker back to 7 (revert of the migration commit in Git mode,
//            the backed-up marker bytes otherwise) and the index restored to
//            its pre-migration state.
//
// Receipts carry counts and project-relative paths only, never document
// content.

import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { rebuildIndex } from '../derived-index/rebuild.js'
import { layoutNotices, RUN_NESTED, verifyIndex } from '../derived-index/validate.js'
import {
  execFileGitCommand,
  type GitCommandRunner,
  gitCommandStdoutText,
  isGitCommandFailure,
  toGitExecFailure,
} from '../git/command.js'
import type { EffectiveRunDirs } from '../project-declaration/load.js'
import { PROJECT_DECLARATION_RELPATH } from '../project-declaration/paths.js'
import { ProjectDeclarationError } from '../project-declaration/schema.js'
import { formatIsoLocal } from '../time.js'

export const V7_TO_V8_COMMIT_MESSAGE = 'chore(memon): migrate FS convention v7 -> v8'

const MARKER = '.memon/version.json'
const INDEX = '.memon/index'
const SNAPSHOT = '.memon/index/snapshot.json'

export interface DerivedIndexMigrationPlan {
  version: 1
  migration: 'v7-to-v8'
  root: string
  /** Marker version found by the plan (7 to migrate, 8 when already migrated). */
  from: number | null
  alreadyMigrated: boolean
  /** Raw marker bytes and their hash (the preimage apply rechecks). */
  marker: { before: string | null; hash: string | null }
  git: boolean
  allowDirty: boolean
  /** CLI `--run-dir` patterns the plan was made with (absent: declaration/default). */
  cliRunDirs?: string[]
  runDirs: EffectiveRunDirs | null
  declarationPresent: boolean
  indexPresent: boolean
  counts: { runs: number; experiments: number; wiki: number }
  /** Run directories under logs/, outputs/, experiments/ the effective patterns miss. */
  outsideRunDirs: string[]
  /** Discovered or declared Run paths nested in a Run-shaped directory. */
  nested: string[]
  /** Operator-acknowledged warnings (never rewritten automatically). */
  warnings: string[]
  blockers: string[]
}

export interface PlanDerivedIndexMigrationOptions {
  allowDirty?: boolean
  cliRunDirs?: string[]
  git?: GitCommandRunner
}

export interface DerivedIndexMigrationReceipt {
  version: 1
  migration: 'v7-to-v8'
  root: string
  appliedAt: string
  /** The marker preimage restored by rollback outside Git. */
  markerBefore: string
  markerAfter: string
  /** Whether `.memon/index/` existed before apply (restored on rollback). */
  indexExisted: boolean
  commit: string | null
  counts: { runs: number; experiments: number; wiki: number }
}

export interface ApplyDerivedIndexMigrationOptions {
  git?: GitCommandRunner
  /** Commit `.memon/version.json` in Git mode (default true). */
  commit?: boolean
  /** Required when the plan carries warnings. */
  acknowledgeWarnings?: boolean
}

export interface ApplyDerivedIndexMigrationResult {
  status: 'migrated' | 'refreshed'
  commit: string | null
  counts: { runs: number; experiments: number; wiki: number }
  backup: string | null
}

export interface VerifyDerivedIndexMigrationResult {
  ok: boolean
  marker: number | null
  problems: string[]
  drift: number
}

const GIT_TIMEOUT_MS = 30_000
const GIT_MAX_BUFFER = 64 * 1024 * 1024
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

async function readText(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw error
  }
}

async function exists(path: string): Promise<boolean> {
  return fs.lstat(path).then(
    () => true,
    () => false,
  )
}

function markerVersion(raw: string | null): number | null {
  if (raw === null) return null
  try {
    const value = (JSON.parse(raw) as { fs_convention_version?: unknown }).fs_convention_version
    return typeof value === 'number' && Number.isInteger(value) ? value : null
  } catch {
    return null
  }
}

async function runGit(git: GitCommandRunner, root: string, args: string[]) {
  return git('git', args, { cwd: root, timeoutMs: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER })
}

async function gitMode(git: GitCommandRunner, root: string): Promise<boolean> {
  const toplevel = await runGit(git, root, ['rev-parse', '--show-toplevel']).catch(() => null)
  if (toplevel === null || isGitCommandFailure(toplevel)) return false
  return (await fs.realpath(gitCommandStdoutText(toplevel).trim()).catch(() => '')) === root
}

async function gitOk(git: GitCommandRunner, root: string, args: string[]): Promise<string> {
  const result = await runGit(git, root, args)
  if (isGitCommandFailure(result))
    throw new Error(`git ${args[0]} failed: ${toGitExecFailure(result).err.message}`)
  return gitCommandStdoutText(result)
}

/** Read-only plan of the v7 -> v8 step for `projectRoot`. */
export async function planDerivedIndexMigration(
  projectRoot: string,
  options: PlanDerivedIndexMigrationOptions = {},
): Promise<DerivedIndexMigrationPlan> {
  const git = options.git ?? execFileGitCommand
  const root = await fs.realpath(projectRoot)
  const markerRaw = await readText(join(root, MARKER))
  const from = markerVersion(markerRaw)
  const plan: DerivedIndexMigrationPlan = {
    version: 1,
    migration: 'v7-to-v8',
    root,
    from,
    alreadyMigrated: from === 8,
    marker: { before: markerRaw, hash: markerRaw === null ? null : hash(markerRaw) },
    git: await gitMode(git, root),
    allowDirty: options.allowDirty ?? false,
    ...(options.cliRunDirs && options.cliRunDirs.length > 0
      ? { cliRunDirs: [...options.cliRunDirs] }
      : {}),
    runDirs: null,
    declarationPresent: await exists(join(root, PROJECT_DECLARATION_RELPATH)),
    indexPresent: await exists(join(root, INDEX)),
    counts: { runs: 0, experiments: 0, wiki: 0 },
    outsideRunDirs: [],
    nested: [],
    warnings: [],
    blockers: [],
  }
  if (markerRaw === null) {
    plan.blockers.push(
      `${MARKER} is missing; the project is not at FS v7 (run memon install-skills)`,
    )
  } else if (from === null) {
    plan.blockers.push(`${MARKER} is not a valid FS marker`)
  } else if (from !== 7 && from !== 8) {
    plan.blockers.push(`${MARKER} records FS v${from}; this step migrates v7 -> v8 only`)
  }
  if (plan.git && !plan.allowDirty) {
    const status = await gitOk(git, root, ['status', '--porcelain', '--untracked-files=normal'])
    if (status.trim()) {
      plan.blockers.push(
        'the Git worktree is dirty; commit or stash your own edits, or re-plan with --allow-dirty after scoped approval',
      )
    }
  }
  try {
    const dry = await rebuildIndex(root, {
      role: 'migration',
      dryRun: true,
      auditRunDirs: true,
      ...(plan.cliRunDirs ? { cliRunDirs: plan.cliRunDirs } : {}),
    })
    plan.runDirs = dry.runDirs
    plan.counts = dry.counts
    plan.outsideRunDirs = dry.audit?.outside ?? []
    const declared = layoutNotices(
      Object.values(dry.snapshot?.experiments ?? {}),
      dry.runDirs.patterns,
    )
      .filter((notice) => notice.code === RUN_NESTED)
      .map((notice) => notice.path)
    plan.nested = [...new Set([...dry.nested, ...declared])].sort()
  } catch (error) {
    if (!(error instanceof ProjectDeclarationError)) throw error
    plan.blockers.push(`${error.message}; fix ${PROJECT_DECLARATION_RELPATH} and plan again`)
    return plan
  }
  if (plan.outsideRunDirs.length > 0) {
    plan.warnings.push(
      `${plan.outsideRunDirs.length} Run director${plan.outsideRunDirs.length === 1 ? 'y lies' : 'ies lie'} outside the effective run_dirs (${plan.runDirs?.patterns.join(', ')}) and will no longer be listed by Run walks: ${plan.outsideRunDirs.join(', ')}. Declared Experiment members still resolve by path. Remedy after the migration: run \`memon project init\`, edit run_dirs in ${PROJECT_DECLARATION_RELPATH}, commit it separately and run \`memon index rebuild\`; or declare run_dirs in the central Project configuration; or accept that these Runs leave walks.`,
    )
  }
  if (plan.nested.length > 0) {
    plan.warnings.push(
      `RUN_NESTED: ${plan.nested.join(', ')} ${plan.nested.length === 1 ? 'is' : 'are'} nested inside a Run-shaped directory; Run directories do not nest and nested Runs are never discovered. Move them to a run_dirs location by hand; the migration changes nothing.`,
    )
  }
  return plan
}

async function writeMarker(root: string, content: string): Promise<void> {
  const path = join(root, MARKER)
  const temp = join(dirname(path), `.memon-migrate-${randomUUID()}`)
  try {
    await fs.writeFile(temp, content, { flag: 'wx', mode: (await fs.stat(path)).mode })
    await fs.rename(temp, path)
  } finally {
    await fs.rm(temp, { force: true })
  }
}

async function restoreIndex(root: string, backup: string, existed: boolean): Promise<void> {
  await fs.rm(join(root, INDEX), { recursive: true, force: true })
  if (existed) await fs.cp(join(backup, 'memon', 'index'), join(root, INDEX), { recursive: true })
}

/** Rebuild + verify the index; throws with the reason when it is not usable. */
async function buildVerifiedIndex(
  plan: DerivedIndexMigrationPlan,
  root: string,
  git: GitCommandRunner,
) {
  const cli = plan.cliRunDirs ? { cliRunDirs: plan.cliRunDirs } : {}
  const rebuilt = await rebuildIndex(root, { role: 'migration', ...cli })
  if (rebuilt.status !== 'rebuilt')
    throw new Error(
      rebuilt.status === 'conflict'
        ? 'another process holds the derived-index lease; retry when it is released'
        : `index rebuild failed (${rebuilt.status})`,
    )
  const verified = await verifyIndex(root, cli)
  if (verified.drift.length > 0)
    throw new Error(
      `index verification reported ${verified.drift.length} INDEX_DRIFT record(s): ${verified.drift
        .slice(0, 5)
        .map((record) => `${record.kind} ${record.key} ${record.field}`)
        .join('; ')}`,
    )
  if (plan.git) {
    const ignored = await runGit(git, root, ['check-ignore', '-q', SNAPSHOT])
    if (isGitCommandFailure(ignored)) throw new Error(`${SNAPSHOT} is not ignored by Git`)
  }
  return rebuilt
}

/**
 * Apply a reviewed plan. Backs up `.memon/` to `backupDirectory` (outside the
 * project), rebuilds and verifies the index, then writes the marker last and
 * commits it in Git mode. On a migrated project it only refreshes the index.
 */
export async function applyDerivedIndexMigration(
  plan: DerivedIndexMigrationPlan,
  backupDirectory: string | null,
  options: ApplyDerivedIndexMigrationOptions = {},
): Promise<ApplyDerivedIndexMigrationResult> {
  const git = options.git ?? execFileGitCommand
  if (plan.version !== 1 || plan.migration !== 'v7-to-v8')
    throw new Error('Not a v7-to-v8 migration plan')
  if (plan.blockers.length > 0)
    throw new Error(`Migration plan has blockers: ${plan.blockers.join('; ')}`)
  if (plan.warnings.length > 0 && !options.acknowledgeWarnings)
    throw new Error('The plan carries warnings; acknowledge them explicitly before applying')
  const root = await fs.realpath(plan.root)
  if (root !== plan.root) throw new Error('Migration root mismatch')
  const markerRaw = await readText(join(root, MARKER))
  if (markerRaw === null || hash(markerRaw) !== plan.marker.hash)
    throw new Error(`Stale migration plan: ${MARKER} changed since planning`)
  if ((await exists(join(root, PROJECT_DECLARATION_RELPATH))) !== plan.declarationPresent)
    throw new Error(`Stale migration plan: ${PROJECT_DECLARATION_RELPATH} appeared or disappeared`)

  if (plan.alreadyMigrated) {
    const rebuilt = await buildVerifiedIndex(plan, root, git)
    return { status: 'refreshed', commit: null, counts: rebuilt.counts, backup: null }
  }
  if (backupDirectory === null) throw new Error('A backup directory is required')
  const backup = resolve(backupDirectory)
  if (backup === root || backup.startsWith(root + sep))
    throw new Error('Backup must be outside the project')
  if (plan.git && !plan.allowDirty) {
    const status = await gitOk(git, root, ['status', '--porcelain', '--untracked-files=normal'])
    if (status.trim())
      throw new Error('Dirty worktree; explicit scoped migration approval is required')
  }

  await fs.mkdir(backup, { mode: 0o700 })
  await fs.cp(join(root, '.memon'), join(backup, 'memon'), { recursive: true })
  const indexExisted = await exists(join(root, INDEX))
  const marker = JSON.parse(markerRaw) as Record<string, unknown>
  marker.fs_convention_version = 8
  marker.last_migrated_at = formatIsoLocal(new Date())
  const markerAfter = `${JSON.stringify(marker, null, 2)}\n`
  const receipt: DerivedIndexMigrationReceipt = {
    version: 1,
    migration: 'v7-to-v8',
    root,
    appliedAt: marker.last_migrated_at as string,
    markerBefore: markerRaw,
    markerAfter,
    indexExisted,
    commit: null,
    counts: plan.counts,
  }
  const writeReceipt = () =>
    fs.writeFile(join(backup, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, {
      mode: 0o600,
    })
  await fs.writeFile(join(backup, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  })
  await writeReceipt()

  let markerWritten = false
  try {
    const rebuilt = await buildVerifiedIndex(plan, root, git)
    receipt.counts = rebuilt.counts
    // The marker is the last project write, after verification.
    if ((await readText(join(root, MARKER))) !== markerRaw)
      throw new Error(`Concurrent edit: ${MARKER}`)
    await writeMarker(root, markerAfter)
    markerWritten = true
    if (plan.git && options.commit !== false) {
      await gitOk(git, root, ['add', '--', MARKER])
      await gitOk(git, root, ['commit', '--only', '-m', V7_TO_V8_COMMIT_MESSAGE, '--', MARKER])
      receipt.commit = (await gitOk(git, root, ['rev-parse', 'HEAD'])).trim()
    }
    await writeReceipt()
    return { status: 'migrated', commit: receipt.commit, counts: receipt.counts, backup }
  } catch (error) {
    if (!markerWritten) {
      await restoreIndex(root, backup, indexExisted)
    } else if (receipt.commit === null && (await readText(join(root, MARKER))) === markerAfter) {
      // The commit failed after the marker moved: put marker 7 back.
      await writeMarker(root, markerRaw)
      if (plan.git) await runGit(git, root, ['reset', '-q', '--', MARKER]).catch(() => null)
      await restoreIndex(root, backup, indexExisted)
    }
    throw error
  }
}

/** Check a migrated project: marker 8, a drift-free and ignored index, no declaration created. */
export async function verifyDerivedIndexMigration(
  projectRoot: string,
  options: { cliRunDirs?: string[]; git?: GitCommandRunner; declarationExpected?: boolean } = {},
): Promise<VerifyDerivedIndexMigrationResult> {
  const git = options.git ?? execFileGitCommand
  const root = await fs.realpath(projectRoot)
  const problems: string[] = []
  const marker = markerVersion(await readText(join(root, MARKER)))
  if (marker !== 8)
    problems.push(`${MARKER} records ${marker === null ? 'no version' : `v${marker}`}, not v8`)
  if (!(await exists(join(root, SNAPSHOT)))) problems.push(`${SNAPSHOT} is missing`)
  if ((await readText(join(root, INDEX, '.gitignore'))) !== '*\n')
    problems.push(`${INDEX}/.gitignore must contain "*"`)
  let drift = 0
  try {
    const verified = await verifyIndex(
      root,
      options.cliRunDirs ? { cliRunDirs: options.cliRunDirs } : {},
    )
    drift = verified.drift.length
    if (drift > 0) problems.push(`${drift} INDEX_DRIFT record(s); run memon index rebuild`)
  } catch (error) {
    if (!(error instanceof ProjectDeclarationError)) throw error
    problems.push(error.message)
  }
  if (await gitMode(git, root)) {
    const ignored = await runGit(git, root, ['check-ignore', '-q', SNAPSHOT])
    if (isGitCommandFailure(ignored)) problems.push(`${SNAPSHOT} is not ignored by Git`)
  }
  if (
    options.declarationExpected === false &&
    (await exists(join(root, PROJECT_DECLARATION_RELPATH)))
  )
    problems.push(`${PROJECT_DECLARATION_RELPATH} exists although the migration must not create it`)
  return { ok: problems.length === 0, marker, problems, drift }
}

/**
 * Undo an applied migration from its backup directory: marker back to 7 (a
 * `git revert` of the migration commit while it is HEAD-reachable, otherwise
 * the backed-up marker bytes) and the index restored to its pre-migration
 * state. Refuses a marker changed since the migration.
 */
export async function rollbackDerivedIndexMigration(
  backupDirectory: string,
  options: { git?: GitCommandRunner } = {},
): Promise<{ marker: 'reverted' | 'restored' | 'unchanged'; revertCommit: string | null }> {
  const git = options.git ?? execFileGitCommand
  const backup = resolve(backupDirectory)
  const receipt = JSON.parse(
    await fs.readFile(join(backup, 'receipt.json'), 'utf8'),
  ) as DerivedIndexMigrationReceipt
  if (receipt.version !== 1 || receipt.migration !== 'v7-to-v8')
    throw new Error('Unsupported recovery receipt')
  const root = await fs.realpath(receipt.root)
  const current = await readText(join(root, MARKER))
  let markerState: 'reverted' | 'restored' | 'unchanged' = 'unchanged'
  let revertCommit: string | null = null
  if (current === receipt.markerBefore) {
    markerState = 'unchanged'
  } else if (current !== receipt.markerAfter) {
    throw new Error(`Concurrent edit blocks rollback: ${MARKER} changed since the migration`)
  } else if (receipt.commit !== null && (await gitMode(git, root))) {
    const contained = await runGit(git, root, [
      'merge-base',
      '--is-ancestor',
      receipt.commit,
      'HEAD',
    ])
    if (isGitCommandFailure(contained))
      throw new Error(`The migration commit ${receipt.commit} is not in HEAD; revert it by hand`)
    await gitOk(git, root, ['revert', '--no-edit', receipt.commit])
    revertCommit = (await gitOk(git, root, ['rev-parse', 'HEAD'])).trim()
    if ((await readText(join(root, MARKER))) !== receipt.markerBefore)
      throw new Error(`git revert did not restore ${MARKER}`)
    markerState = 'reverted'
  } else {
    await writeMarker(root, receipt.markerBefore)
    markerState = 'restored'
  }
  await restoreIndex(root, backup, receipt.indexExisted)
  return { marker: markerState, revertCommit }
}
