// Explicit FS9 -> FS10 conversion. Never runs as a read/update side effect.
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { writeFileAtomic } from '../atomic-write.js'
import { parseExperimentReadme } from '../experiments/parse.js'
import { withFileWriterLock } from '../file-writer-lock.js'
import { execFileGitCommand } from '../git/command.js'
import { isRunPath } from '../ids.js'
import {
  lintExperimentDescription,
  parseExperimentDescription,
  serializeExperimentDescription,
} from '../results/description.js'
import { resolveRunRealPath } from '../results/ignore.js'
import { initializeExperimentResearch } from '../results/research.js'
import { formatIsoLocal } from '../time.js'

export const V9_TO_V10_COMMIT_MESSAGE = 'chore(memon): migrate FS convention v9 -> v10'
const MARKER = '.memon/version.json'
const EXPERIMENTS = 'docs/experiments'
const REASON = 'Initialize research history from FS9; no scientific version boundaries inferred'
const digest = (raw: string) => createHash('sha256').update(raw).digest('hex')

interface Source {
  path: string
  hash: string | null
  mtime: number | null
}
interface Conversion extends Source {
  before: string
  after: string
  mode: number
}
export interface ResearchMigrationPlan {
  migration: 'v9-to-v10'
  root: string
  plannedAt: string
  allowDirty: boolean
  alreadyMigrated: boolean
  experiments: string[]
  files: Conversion[]
  guards: Source[]
  blockers: string[]
}
interface Receipt {
  migration: 'v9-to-v10'
  root: string
  files: Conversion[]
}

async function git(root: string, args: string[]) {
  return execFileGitCommand('git', args, {
    cwd: root,
    timeoutMs: 30_000,
    maxBuffer: 16 * 1024 * 1024,
    cache: 'bypass',
  })
}
async function checkWorktree(root: string, allowDirty: boolean) {
  const probe = await git(root, ['rev-parse', '--show-toplevel'])
  if (probe.code !== 0) return
  if ((await fs.realpath(String(probe.stdout).trim())) !== root)
    throw new Error(
      'Migration requires the project Git root, not a directory inside another repository',
    )
  const status = await git(root, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (status.code !== 0) throw new Error('Cannot inspect the working tree')
  if (!allowDirty && String(status.stdout).trim())
    throw new Error('Dirty worktree; review changes before migration')
}

// Reuse the existing physical-containment probe before touching every source.
async function contained(root: string, path: string): Promise<string | null> {
  if (path.startsWith('/') || path.split('/').some((part) => part === '..' || part === '.'))
    throw new Error(`Invalid project-relative path: ${path}`)
  const found = await resolveRunRealPath(root, path)
  if (found.kind === 'outside') throw new Error(`Path escapes project root: ${path}`)
  if (found.kind === 'missing') {
    // A missing leaf can still have an escaping symlink in its parent chain.
    if (path.includes('/')) await contained(root, path.slice(0, path.lastIndexOf('/')))
    return null
  }
  return join(root, found.real)
}
async function source(
  root: string,
  path: string,
): Promise<{ guard: Source; raw: string | null; mode: number }> {
  const file = await contained(root, path)
  if (file === null) return { guard: { path, hash: null, mtime: null }, raw: null, mode: 0o600 }
  const stat = await fs.stat(file)
  if (!stat.isFile()) throw new Error(`Expected file: ${path}`)
  const raw = await fs.readFile(file, 'utf8')
  const after = await fs.stat(file)
  if (stat.mtimeMs !== after.mtimeMs || stat.size !== after.size)
    throw new Error(`Concurrent edit: ${path}`)
  return { guard: { path, hash: digest(raw), mtime: after.mtimeMs }, raw, mode: stat.mode & 0o777 }
}
async function experimentIds(root: string): Promise<string[]> {
  const directory = await contained(root, EXPERIMENTS)
  if (directory === null) return []
  return (await fs.readdir(directory)).filter((id) => /^E\d{4}-[a-z0-9][a-z0-9-]*$/.test(id)).sort()
}
function parseDescription(raw: string, path: string) {
  const parsed = parseExperimentDescription(raw, path)
  if (!parsed.data)
    throw new Error(`${path}: ${parsed.parseErrors.map((p) => p.message).join('; ')}`)
  return parsed.data
}

/** Read-only plan. Contents belong in an operator-private file outside the project. */
export async function planResearchMigration(
  projectRoot: string,
  options: { allowDirty?: boolean; now?: Date } = {},
): Promise<ResearchMigrationPlan> {
  const root = await fs.realpath(projectRoot)
  const plan: ResearchMigrationPlan = {
    migration: 'v9-to-v10',
    root,
    plannedAt: formatIsoLocal(options.now ?? new Date()),
    allowDirty: options.allowDirty === true,
    alreadyMigrated: false,
    experiments: [],
    files: [],
    guards: [],
    blockers: [],
  }
  try {
    await checkWorktree(root, plan.allowDirty)
    const marker = await source(root, MARKER)
    if (marker.raw === null) throw new Error(`${MARKER} is required`)
    const metadata = JSON.parse(marker.raw) as Record<string, unknown>
    if (metadata.fs_convention_version !== 9 && metadata.fs_convention_version !== 10)
      throw new Error('Expected FS9 or already converted FS10')
    plan.alreadyMigrated = metadata.fs_convention_version === 10
    plan.guards.push(marker.guard)
    plan.experiments = await experimentIds(root)
    const owners = new Map<string, string>()
    const physicalOwners = new Set<string>()
    const descriptionTargets = new Set<string>()
    for (const id of plan.experiments) {
      const base = `${EXPERIMENTS}/${id}`
      const readme = await source(root, `${base}/README.md`)
      if (readme.raw === null) throw new Error(`${base}/README.md is required`)
      plan.guards.push(readme.guard)
      const parsed = parseExperimentReadme(readme.raw, id)
      if (parsed.parseErrors.length || parsed.parseWarnings.some((issue) => issue.field === 'runs'))
        throw new Error(`${base}/README.md has invalid membership or does not parse`)
      const runs = parsed.frontMatter.runs
      if (new Set(runs).size !== runs.length) throw new Error(`${id}: duplicate Run membership`)
      for (const run of runs) {
        if (!isRunPath(run)) throw new Error(`${id}: noncanonical Run path ${run}`)
        if (owners.has(run)) throw new Error(`${run} is owned by multiple Experiments`)
        owners.set(run, id)
        const physical = await contained(root, run)
        if (physical !== null) {
          if (physicalOwners.has(physical)) throw new Error(`${run}: aliased Run membership`)
          physicalOwners.add(physical)
        }
        for (const leaf of ['README.md', 'result.csv']) {
          plan.guards.push((await source(root, `${run}/${leaf}`)).guard)
        }
      }
      const path = `${base}/experiment.json`
      const record = await source(root, path)
      if (record.raw === null) throw new Error(`${path} is required; do not invent missing Results`)
      const physicalDescription = await contained(root, path)
      if (physicalDescription === null || descriptionTargets.has(physicalDescription))
        throw new Error(`${path}: aliased description`)
      descriptionTargets.add(physicalDescription)
      plan.guards.push(record.guard)
      const description = parseDescription(record.raw, path)
      const problems = lintExperimentDescription(description, {
        readmeRuns: runs,
        file: path,
      }).filter((item) => item.severity === 'error')
      if (problems.length) throw new Error(`${id}: ${problems.map((p) => p.message).join('; ')}`)
      if (plan.alreadyMigrated) {
        if (!description.research) throw new Error(`${path}: FS10 marker with legacy description`)
      } else {
        if (description.research) throw new Error(`${path}: mixed FS9/FS10 state requires recovery`)
        const next = initializeExperimentResearch(description, runs, plan.plannedAt, REASON)
        const after = serializeExperimentDescription(next)
        parseDescription(after, path)
        plan.files.push({ ...record.guard, before: record.raw, after, mode: record.mode })
      }
    }
    if (!plan.alreadyMigrated) {
      metadata.fs_convention_version = 10
      metadata.last_migrated_at = plan.plannedAt
      plan.files.push({
        ...marker.guard,
        before: marker.raw,
        after: `${JSON.stringify(metadata, null, 2)}\n`,
        mode: marker.mode,
      })
    }
  } catch (error) {
    plan.blockers.push((error as Error).message)
  }
  return plan
}

async function checkGuard(root: string, guard: Source) {
  const current = await source(root, guard.path)
  if (current.guard.hash !== guard.hash || current.guard.mtime !== guard.mtime)
    throw new Error(`Concurrent edit: ${guard.path}`)
}
async function replace(root: string, file: Conversion, content: string) {
  const target = await contained(root, file.path)
  if (target === null) throw new Error(`Missing replacement target: ${file.path}`)
  await writeFileAtomic(target, content, { fs, mode: file.mode })
}
function validateReceipt(receipt: Receipt) {
  if (receipt.migration !== 'v9-to-v10' || !Array.isArray(receipt.files))
    throw new Error('Unsupported migration receipt')
  const seen = new Set<string>()
  for (const file of receipt.files) {
    if (
      (file.path !== MARKER &&
        !/^docs\/experiments\/E\d{4}-[a-z0-9-]+\/experiment\.json$/.test(file.path)) ||
      seen.has(file.path)
    )
      throw new Error('Unexpected migration target')
    seen.add(file.path)
  }
}

/** Apply only a reviewed plan, preserving recoverable preimages. No implicit Git commit. */
export async function applyResearchMigration(plan: ResearchMigrationPlan, backupDirectory: string) {
  validateReceipt(plan)
  if (plan.blockers.length) throw new Error(`Migration blocked: ${plan.blockers.join('; ')}`)
  const root = await fs.realpath(plan.root)
  if (plan.alreadyMigrated) {
    const verified = await verifyResearchMigration(root)
    if (!verified.ok) throw new Error(verified.problems.join('; '))
    return { status: 'unchanged' as const, files: [] as string[], backup: null }
  }
  const backup = resolve(backupDirectory)
  const backupParent = await fs.realpath(dirname(backup))
  const rel = relative(root, join(backupParent, backup.slice(backup.lastIndexOf(sep) + 1)))
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..'))
    throw new Error('Backup directory must be outside the project')
  await checkWorktree(root, plan.allowDirty)
  return withFileWriterLock(root, async () => {
    // Rebuild the plan under the writer lock: reject tampering, new bundles and stale sources.
    const fresh = await planResearchMigration(root, {
      allowDirty: true,
      now: new Date(plan.plannedAt),
    })
    if (
      fresh.blockers.length ||
      JSON.stringify(fresh.files) !== JSON.stringify(plan.files) ||
      JSON.stringify(fresh.experiments) !== JSON.stringify(plan.experiments) ||
      JSON.stringify(fresh.guards.map((guard) => guard.path)) !==
        JSON.stringify(plan.guards.map((guard) => guard.path))
    )
      throw new Error('Stale or modified migration plan; generate and review a new plan')
    for (const guard of plan.guards) await checkGuard(root, guard)
    await fs.mkdir(backup, { mode: 0o700 })
    const receipt: Receipt = { migration: 'v9-to-v10', root, files: plan.files }
    await fs.writeFile(join(backup, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    })
    const written: Conversion[] = []
    try {
      for (const file of plan.files) {
        // Marker is last. Revalidate every new description and unchanged source before it moves.
        if (file.path === MARKER) {
          for (const guard of plan.guards.filter((g) => !plan.files.some((f) => f.path === g.path)))
            await checkGuard(root, guard)
          const problems = await verifyDescriptions(root)
          if (problems.length) throw new Error(problems.join('; '))
        }
        await checkGuard(root, file)
        await replace(root, file, file.after)
        written.push(file)
      }
      const verified = await verifyResearchMigration(root)
      if (!verified.ok) throw new Error(verified.problems.join('; '))
      return { status: 'migrated' as const, files: plan.files.map((file) => file.path), backup }
    } catch (error) {
      const conflicts: string[] = []
      for (const file of [...written].filter((file) => file.path !== MARKER).reverse()) {
        if ((await source(root, file.path)).raw !== file.after) {
          conflicts.push(file.path)
          continue
        }
        await replace(root, file, file.before)
      }
      if (conflicts.length)
        throw new Error(
          `Migration failed; concurrent edits need recovery from ${backup}: ${conflicts.join(', ')}`,
          { cause: error },
        )
      const marker = written.find((file) => file.path === MARKER)
      if (marker) {
        if ((await source(root, marker.path)).raw !== marker.after)
          throw new Error(`Concurrent edit blocks marker recovery; use ${backup}`, { cause: error })
        await replace(root, marker, marker.before)
      }
      throw error
    }
  })
}

async function verifyDescriptions(root: string): Promise<string[]> {
  const problems: string[] = []
  const owners = new Set<string>()
  for (const id of await experimentIds(root)) {
    try {
      const base = `${EXPERIMENTS}/${id}`
      const raw = (await source(root, `${base}/experiment.json`)).raw
      const readme = (await source(root, `${base}/README.md`)).raw
      if (raw === null || readme === null) throw new Error(`${id}: missing required document`)
      const parsed = parseExperimentReadme(readme, id)
      if (parsed.parseErrors.length || parsed.parseWarnings.some((issue) => issue.field === 'runs'))
        throw new Error(`${id}: invalid README or membership`)
      const description = parseDescription(raw, `${base}/experiment.json`)
      if (!description.research) throw new Error(`${id}: legacy description`)
      for (const run of parsed.frontMatter.runs) {
        if (!isRunPath(run) || owners.has(run))
          throw new Error(`${id}: invalid/duplicate Run membership`)
        owners.add(run)
        await contained(root, run)
      }
      problems.push(
        ...lintExperimentDescription(description, { readmeRuns: parsed.frontMatter.runs })
          .filter((item) => item.severity === 'error')
          .map((item) => `${id}: ${item.message}`),
      )
    } catch (error) {
      problems.push((error as Error).message)
    }
  }
  return problems
}
export async function verifyResearchMigration(projectRoot: string) {
  const root = await fs.realpath(projectRoot)
  const problems = await verifyDescriptions(root)
  try {
    const raw = (await source(root, MARKER)).raw
    if (raw === null || JSON.parse(raw).fs_convention_version !== 10)
      problems.push('FS10 marker is missing')
  } catch (error) {
    problems.push((error as Error).message)
  }
  return { ok: problems.length === 0, problems }
}

/** Restore preimages only if every target still has its preimage or exact postimage. */
export async function rollbackResearchMigration(backupDirectory: string) {
  const receipt = JSON.parse(
    await fs.readFile(join(backupDirectory, 'receipt.json'), 'utf8'),
  ) as Receipt
  validateReceipt(receipt)
  const root = await fs.realpath(receipt.root)
  return withFileWriterLock(root, async () => {
    for (const file of receipt.files) {
      const raw = (await source(root, file.path)).raw
      if (raw !== file.before && raw !== file.after)
        throw new Error(`Concurrent edit blocks rollback: ${file.path}`)
    }
    // Restore descriptions before lowering the marker; interruption is safe to resume.
    for (const file of receipt.files) {
      if ((await source(root, file.path)).raw !== file.before)
        await replace(root, file, file.before)
    }
    return { status: 'restored' as const, files: receipt.files.map((file) => file.path) }
  })
}
