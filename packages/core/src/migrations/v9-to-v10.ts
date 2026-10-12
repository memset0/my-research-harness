// Explicit FS9 -> FS10 conversion. Never runs as a read/update side effect.
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { load } from 'js-yaml'
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
import { EXPERIMENT_LIFECYCLE_VALUES, type ExperimentLifecycle } from '../types.js'

export const V9_TO_V10_COMMIT_MESSAGE = 'chore(memon): migrate FS convention v9 -> v10'
const MARKER = '.memon/version.json'
const EXPERIMENTS = 'docs/experiments'
const REASON = 'Initialize research history from FS9; no scientific version boundaries inferred'
const digest = (raw: string) => createHash('sha256').update(raw).digest('hex')
const LIFECYCLES = EXPERIMENT_LIFECYCLE_VALUES
type Lifecycle = ExperimentLifecycle

/** Change only owned scalar frontmatter lines; preserve every body/custom byte. */
function normalizeLifecycle(raw: string, id: string, chosen: Lifecycle | undefined, now: string) {
  const front = /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(raw)
  if (!front) throw new Error(`${id}: missing YAML frontmatter`)
  const fields = load(front[2]!) as Record<string, unknown>
  const canonical = LIFECYCLES.includes(fields.status as Lifecycle)
  const status =
    chosen ??
    (canonical
      ? fields.status
      : fields.status === 'OPEN' && fields.archived !== true
        ? 'ACTIVE'
        : undefined)
  if (!LIFECYCLES.includes(status as Lifecycle))
    throw new Error(
      `${id}: explicit lifecycle decision required (ACTIVE, PAUSED, ARCHIVED, RETIRED)`,
    )
  if (canonical && !Object.hasOwn(fields, 'archived') && status === fields.status) return raw
  const lines = front[2]!.split(/(?<=\n)/)
  let changedStatus = false
  let changedTime = false
  const newline = front[1]!.includes('\r\n') ? '\r\n' : '\n'
  const next = lines
    .flatMap((line) => {
      if (/^archived\s*:/.test(line)) return []
      if (/^status\s*:/.test(line)) {
        changedStatus = true
        return [`status: ${status}${line.endsWith('\n') ? newline : ''}`]
      }
      if (/^updated_at\s*:/.test(line)) {
        changedTime = true
        return [`updated_at: '${now}'${line.endsWith('\n') ? newline : ''}`]
      }
      return [line]
    })
    .join('')
  if (!changedStatus) throw new Error(`${id}: expected a top-level scalar status field`)
  const body = changedTime ? next : `${next}${newline}updated_at: '${now}'`
  const converted = front[1] + body + front[3] + raw.slice(front[0].length)
  const check = load(body) as Record<string, unknown>
  if (check.status !== status || Object.hasOwn(check, 'archived'))
    throw new Error(`${id}: unsupported lifecycle frontmatter layout`)
  return converted
}

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
interface RetainedDiagnostic {
  experiment: string
  code: string
  message: string
  severity: string
  file: string
  field?: string
}
function retainedDiagnostic(
  experiment: string,
  diagnostic: ReturnType<typeof lintExperimentDescription>[number],
): RetainedDiagnostic {
  return {
    experiment,
    code: diagnostic.code,
    message: diagnostic.message,
    severity: diagnostic.severity,
    file: diagnostic.file,
    ...(diagnostic.field ? { field: diagnostic.field } : {}),
  }
}
const PRESERVED_DIAGNOSTICS = new Set(['RESULT_VALUE_TYPE_MISMATCH', 'UNASSIGNED_EXPERIMENT_RUN'])
export interface ResearchMigrationPlan {
  migration: 'v9-to-v10'
  root: string
  plannedAt: string
  allowDirty: boolean
  alreadyMigrated: boolean
  lifecycles: Record<string, Lifecycle>
  retainedDiagnostics: RetainedDiagnostic[]
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
  // Reviewed scoped dirty-tree mode guards the exact source paths below. Do not
  // repeatedly enumerate unrelated execution payloads in a large research tree.
  if (allowDirty) return
  const status = await git(root, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (status.code !== 0) throw new Error('Cannot inspect the working tree')
  if (String(status.stdout).trim())
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
  options: { allowDirty?: boolean; now?: Date; lifecycles?: Record<string, Lifecycle> } = {},
): Promise<ResearchMigrationPlan> {
  const root = await fs.realpath(projectRoot)
  const plan: ResearchMigrationPlan = {
    migration: 'v9-to-v10',
    root,
    plannedAt: formatIsoLocal(options.now ?? new Date()),
    allowDirty: options.allowDirty === true,
    alreadyMigrated: false,
    lifecycles: { ...options.lifecycles },
    retainedDiagnostics: [],
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
    const sourceIsFs10 = metadata.fs_convention_version === 10
    plan.guards.push(marker.guard)
    plan.experiments = await experimentIds(root)
    for (const [id, lifecycle] of Object.entries(plan.lifecycles)) {
      if (!plan.experiments.includes(id) || !LIFECYCLES.includes(lifecycle))
        throw new Error(`Invalid lifecycle mapping: ${id}`)
    }
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
      const nextReadme = normalizeLifecycle(readme.raw, id, plan.lifecycles[id], plan.plannedAt)
      if (nextReadme !== readme.raw)
        plan.files.push({
          ...readme.guard,
          before: readme.raw,
          after: nextReadme,
          mode: readme.mode,
        })
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
      const diagnostics = lintExperimentDescription(description, {
        readmeRuns: runs,
        file: path,
      }).filter((item) => item.severity === 'error')
      const problems = diagnostics.filter((item) => !PRESERVED_DIAGNOSTICS.has(item.code))
      if (problems.length) throw new Error(`${id}: ${problems.map((p) => p.message).join('; ')}`)
      plan.retainedDiagnostics.push(...diagnostics.map((item) => retainedDiagnostic(id, item)))
      if (sourceIsFs10) {
        if (!description.research) throw new Error(`${path}: FS10 marker with legacy description`)
      } else {
        if (description.research) throw new Error(`${path}: mixed FS9/FS10 state requires recovery`)
        const next = initializeExperimentResearch(description, runs, plan.plannedAt, REASON)
        const after = serializeExperimentDescription(next)
        const decoded = parseDescription(after, path)
        const afterDiagnostics = lintExperimentDescription(decoded, {
          readmeRuns: runs,
          file: path,
        }).filter((item) => item.severity === 'error')
        if (JSON.stringify(afterDiagnostics) !== JSON.stringify(diagnostics))
          throw new Error(`${id}: conversion changed existing diagnostics`)
        plan.files.push({ ...record.guard, before: record.raw, after, mode: record.mode })
      }
    }
    plan.alreadyMigrated = sourceIsFs10 && plan.files.length === 0
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
        !/^docs\/experiments\/E\d{4}-[a-z0-9-]+\/(experiment\.json|README\.md)$/.test(file.path)) ||
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
      lifecycles: plan.lifecycles,
    })
    if (
      fresh.blockers.length ||
      JSON.stringify(fresh.files) !== JSON.stringify(plan.files) ||
      JSON.stringify(fresh.experiments) !== JSON.stringify(plan.experiments) ||
      JSON.stringify(fresh.retainedDiagnostics) !== JSON.stringify(plan.retainedDiagnostics) ||
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
          for (const previous of written)
            if ((await source(root, previous.path)).raw !== previous.after)
              throw new Error(`Concurrent edit after conversion: ${previous.path}`)
          for (const guard of plan.guards.filter((g) => !plan.files.some((f) => f.path === g.path)))
            await checkGuard(root, guard)
          const { problems, retainedDiagnostics } = await verifyDescriptions(root)
          if (problems.length) throw new Error(problems.join('; '))
          if (JSON.stringify(retainedDiagnostics) !== JSON.stringify(plan.retainedDiagnostics))
            throw new Error('Conversion changed retained diagnostics')
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

async function verifyDescriptions(root: string) {
  const problems: string[] = []
  const retainedDiagnostics: RetainedDiagnostic[] = []
  const owners = new Set<string>()
  for (const id of await experimentIds(root)) {
    try {
      const base = `${EXPERIMENTS}/${id}`
      const raw = (await source(root, `${base}/experiment.json`)).raw
      const readme = (await source(root, `${base}/README.md`)).raw
      if (raw === null || readme === null) throw new Error(`${id}: missing required document`)
      const parsed = parseExperimentReadme(readme, id)
      if (normalizeLifecycle(readme, id, undefined, formatIsoLocal(new Date())) !== readme)
        throw new Error(`${id}: lifecycle normalization is required`)
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
      for (const diagnostic of lintExperimentDescription(description, {
        readmeRuns: parsed.frontMatter.runs,
        file: `${base}/experiment.json`,
      })) {
        if (diagnostic.severity !== 'error') continue
        if (PRESERVED_DIAGNOSTICS.has(diagnostic.code))
          retainedDiagnostics.push(retainedDiagnostic(id, diagnostic))
        else problems.push(`${id}: ${diagnostic.message}`)
      }
    } catch (error) {
      problems.push((error as Error).message)
    }
  }
  return { problems, retainedDiagnostics }
}
export async function verifyResearchMigration(projectRoot: string) {
  const root = await fs.realpath(projectRoot)
  const { problems, retainedDiagnostics } = await verifyDescriptions(root)
  try {
    const raw = (await source(root, MARKER)).raw
    if (raw === null || JSON.parse(raw).fs_convention_version !== 10)
      problems.push('FS10 marker is missing')
  } catch (error) {
    problems.push((error as Error).message)
  }
  return {
    ok: problems.length === 0,
    problems,
    ...(retainedDiagnostics.length ? { retainedDiagnostics } : {}),
  }
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
