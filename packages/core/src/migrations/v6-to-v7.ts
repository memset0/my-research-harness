import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { type Dirent, promises as fs } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'
import { isRunPath } from '../experiments/run-path.js'
import { patchRunFrontMatter } from '../readme/frontmatter-patch.js'
import { formatIsoLocal } from '../time.js'
import {
  applyDigestWikiMigration,
  type DigestWikiMigrationPlan,
  planDigestWikiMigration,
  rollbackDigestWikiMigration,
  validateDigestWikiMigration,
  verifyDigestWikiMigration,
} from './digests-to-wiki.js'

export interface MembershipMigrationPlan {
  version: 1
  root: string
  files: Array<{ path: string; before: string; after: string; hash: string }>
  blockers: string[]
  warnings: string[]
  droppedClaims: string[]
  allowDirty: boolean
  keepVersion?: boolean
  digests?: DigestWikiMigrationPlan
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex')

function frontmatter(content: string): Record<string, unknown> {
  const match = /^\uFEFF?---[^\S\n]*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (!match) throw new Error('Missing or unterminated frontmatter')
  const document = parseDocument(match[1]!)
  if (document.errors.length || !isMap(document.contents)) throw new Error('Malformed frontmatter')
  return document.toJS() as Record<string, unknown>
}

async function safeFile(root: string, path: string): Promise<string> {
  if (
    !path ||
    path.includes('\\') ||
    path.startsWith('/') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Unsafe migration path')
  const target = join(root, path)
  const real = await fs.realpath(target)
  const local = relative(root, real)
  if (local === '..' || local.startsWith(`..${sep}`) || (await fs.lstat(target)).isSymbolicLink())
    throw new Error(`Unsafe symlink: ${path}`)
  return target
}

export async function planMembershipMigration(
  projectRoot: string,
  options: { allowDirty?: boolean; dropRunOnlyClaims?: boolean; keepVersion?: boolean } = {},
): Promise<MembershipMigrationPlan> {
  const root = await fs.realpath(projectRoot)
  const plan: MembershipMigrationPlan = {
    version: 1,
    root,
    files: [],
    blockers: [],
    warnings: [],
    droppedClaims: [],
    allowDirty: options.allowDirty ?? false,
    keepVersion: options.keepVersion ?? false,
  }
  const add = (path: string, before: string, after: string) => {
    plan.files.push({ path, before, after, hash: hash(before) })
  }
  const runPaths: string[] = []
  const walk = async (directory: string) => {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(join(root, directory), { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const path = `${directory}/${entry.name}`
      if (/^.+-\d{6}-\d{6}$/.test(entry.name)) runPaths.push(path)
      else await walk(path)
    }
  }
  for (const directory of ['logs', 'outputs', 'experiments']) await walk(directory)
  const byId = new Map<string, string[]>()
  for (const path of runPaths) byId.set(basename(path), [...(byId.get(basename(path)) ?? []), path])
  const resolveRef = (reference: unknown): string => {
    if (typeof reference !== 'string') throw new Error('Run reference must be a string')
    const matches = reference.includes('/')
      ? runPaths.includes(reference)
        ? [reference]
        : []
      : (byId.get(reference) ?? [])
    if (matches.length !== 1 || !isRunPath(matches[0]!))
      throw new Error(
        `Unresolved or ambiguous Run reference: ${reference}; candidates: ${matches.join(', ') || '(none)'}`,
      )
    return matches[0]!
  }
  const owners = new Map<string, string>()
  const experimentRoot = join(root, 'docs/experiments')
  const entries = await fs
    .readdir(experimentRoot, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
  for (const entry of entries) {
    if (!/^E\d{4}-.+/.test(entry.name)) continue
    const path = entry.isDirectory()
      ? `docs/experiments/${entry.name}/README.md`
      : entry.isFile() && entry.name.endsWith('.md')
        ? `docs/experiments/${entry.name}`
        : null
    if (!path) continue
    try {
      const before = await fs.readFile(await safeFile(root, path), 'utf8')
      const header = frontmatter(before)
      const id = entry.name.replace(/\.md$/, '')
      if (header.id !== undefined && header.id !== id)
        throw new Error('Experiment id differs from its directory')
      if (header.runs !== undefined && !Array.isArray(header.runs))
        throw new Error('runs must be an array')
      const runs = ((header.runs ?? []) as unknown[]).map(resolveRef)
      for (const run of runs) {
        await safeFile(root, `${run}/README.md`)
        if (owners.has(run))
          throw new Error(`Duplicate membership for ${run}: ${owners.get(run)}, ${id}`)
        owners.set(run, id)
      }
      add(
        path,
        before,
        JSON.stringify(header.runs ?? []) === JSON.stringify(runs)
          ? before
          : patchRunFrontMatter(before, { runs: JSON.stringify(runs) }),
      )
      if (entry.isDirectory()) {
        const resultsPath = `docs/experiments/${entry.name}/results.yaml`
        try {
          const source = await fs.readFile(await safeFile(root, resultsPath), 'utf8')
          const document = parseDocument(source)
          if (document.errors.length) throw new Error('Malformed results YAML')
          const replacements: Array<{ start: number; end: number; text: string }> = []
          const visit = (node: unknown): void => {
            if (isMap(node))
              for (const pair of node.items) {
                if (
                  isScalar(pair.key) &&
                  ['runs', 'attempts'].includes(String(pair.key.value)) &&
                  isSeq(pair.value)
                ) {
                  for (const item of pair.value.items) {
                    if (!isScalar(item) || !item.range)
                      throw new Error('Invalid result Run reference')
                    const canonical = resolveRef(item.value)
                    if (!runs.includes(canonical))
                      throw new Error(`Result references undeclared Run: ${canonical}`)
                    if (canonical !== item.value)
                      replacements.push({
                        start: item.range[0],
                        end: item.range[1],
                        text: JSON.stringify(canonical),
                      })
                  }
                } else visit(pair.value)
              }
            else if (isSeq(node)) for (const item of node.items) visit(item)
          }
          visit(document.contents)
          let after = source
          for (const replacement of replacements.sort((left, right) => right.start - left.start))
            after =
              after.slice(0, replacement.start) + replacement.text + after.slice(replacement.end)
          add(resultsPath, source, after)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
    } catch (error) {
      plan.blockers.push(`${path}: ${(error as Error).message}`)
    }
  }
  for (const directory of runPaths) {
    const path = `${directory}/README.md`
    try {
      const before = await fs.readFile(await safeFile(root, path), 'utf8')
      const header = frontmatter(before)
      if (header.experiment && owners.get(directory) !== header.experiment) {
        if (!owners.has(directory) && options.dropRunOnlyClaims) plan.droppedClaims.push(directory)
        else plan.blockers.push(`Legacy ownership conflict: ${directory}`)
      }
      add(path, before, patchRunFrontMatter(before, { experiment: null }))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !owners.has(directory))
        plan.warnings.push(`Unreferenced Run has no README: ${directory}`)
      else plan.blockers.push(`${path}: ${(error as Error).message}`)
    }
  }
  const markerPath = '.memon/version.json'
  if (!options.keepVersion) {
    plan.digests = await planDigestWikiMigration(root)
    plan.blockers.push(...plan.digests.blockers)
  }
  const before = await fs.readFile(await safeFile(root, markerPath), 'utf8')
  const marker = JSON.parse(before)
  if (![6, 7].includes(marker.fs_convention_version))
    plan.blockers.push('Migration requires FS v6 or already migrated v7')
  if (marker.fs_convention_version === 6 && !options.keepVersion) {
    marker.fs_convention_version = 7
    marker.last_migrated_at = formatIsoLocal(new Date())
    add(markerPath, before, `${JSON.stringify(marker, null, 2)}\n`)
  } else add(markerPath, before, before)
  return plan
}

export async function applyMembershipMigration(
  plan: MembershipMigrationPlan,
  backupDirectory: string,
): Promise<void> {
  if (plan.version !== 1 || plan.blockers.length) throw new Error('Migration plan has blockers')
  const root = await fs.realpath(plan.root)
  if (!plan.keepVersion && !plan.digests)
    throw new Error('Regenerate the v7 plan to include Digest migration')
  if (plan.digests) {
    if (plan.digests.root !== root) throw new Error('Digest migration root mismatch')
    await validateDigestWikiMigration(plan.digests)
  }
  const backup = resolve(backupDirectory)
  if (backup === root || backup.startsWith(root + sep))
    throw new Error('Backup must be outside the project')
  const inGit = (() => {
    try {
      return (
        execFileSync('git', ['rev-parse', '--show-toplevel'], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() === root
      )
    } catch {
      return false
    }
  })()
  if (inGit && !plan.allowDirty) {
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: root,
      encoding: 'utf8',
    })
    if (status.trim())
      throw new Error('Dirty worktree; explicit scoped migration approval is required')
  }
  if (new Set(plan.files.map((file) => file.path)).size !== plan.files.length)
    throw new Error('Duplicate planned file')
  const paths = new Map<string, string>()
  for (const file of plan.files) {
    if (hash(file.before) !== file.hash) throw new Error('Corrupt preimage')
    const path = await safeFile(root, file.path)
    const actual = await fs.readFile(path, 'utf8')
    if (actual !== file.before && actual !== file.after)
      throw new Error(`Stale migration plan: ${file.path}`)
    paths.set(file.path, path)
  }
  await fs.mkdir(backup, { mode: 0o700 })
  await fs.writeFile(join(backup, 'plan.json'), JSON.stringify(plan, null, 2), {
    mode: 0o600,
    flag: 'wx',
  })
  const written: typeof plan.files = []
  try {
    if (plan.digests) await applyDigestWikiMigration(plan.digests)
    for (const file of plan.files) {
      if (file.path === '.memon/version.json') {
        if (plan.digests) await verifyDigestWikiMigration(plan.digests)
        const check = await planMembershipMigration(root, {
          allowDirty: true,
          keepVersion: plan.keepVersion,
        })
        const changed = check.files.filter(
          (entry) => entry.path !== '.memon/version.json' && entry.before !== entry.after,
        )
        if (check.blockers.length || changed.length || check.digests?.documents.length)
          throw new Error(`Migration verification failed: ${check.blockers.join('; ')}`)
        for (const document of plan.digests?.documents ?? []) {
          if ((await fs.readFile(await safeFile(root, document.target), 'utf8')) !== document.after)
            throw new Error('Digest postimage changed')
        }
        for (const entry of check.files) {
          const original = plan.files.find((candidate) => candidate.path === entry.path)
          if (
            !original ||
            (entry.path !== '.memon/version.json' && entry.before !== original.after)
          )
            throw new Error(`Concurrent edit: ${entry.path}`)
        }
      }
      const path = await safeFile(root, file.path)
      const current = await fs.readFile(path, 'utf8')
      if (current === file.after) continue
      if (current !== file.before) throw new Error(`Concurrent edit: ${file.path}`)
      const temp = join(dirname(path), `.memon-migrate-${randomUUID()}`)
      try {
        await fs.writeFile(temp, file.after, { mode: (await fs.stat(path)).mode, flag: 'wx' })
        if ((await fs.readFile(path, 'utf8')) !== file.before)
          throw new Error(`Concurrent edit: ${file.path}`)
        await fs.rename(temp, path)
        written.push(file)
      } finally {
        await fs.rm(temp, { force: true })
      }
    }
    for (const file of plan.files)
      if ((await fs.readFile(paths.get(file.path)!, 'utf8')) !== file.after)
        throw new Error(`Verification failed: ${file.path}`)
  } catch (error) {
    for (const file of written.reverse()) {
      const path = paths.get(file.path)!
      if ((await fs.readFile(path, 'utf8')) === file.after) await fs.writeFile(path, file.before)
    }
    if (plan.digests) await rollbackDigestWikiMigration(plan.digests)
    throw error
  }
}

export async function rollbackMembershipMigration(backupDirectory: string): Promise<void> {
  const plan: MembershipMigrationPlan = JSON.parse(
    await fs.readFile(join(backupDirectory, 'plan.json'), 'utf8'),
  )
  if (plan.version !== 1) throw new Error('Unsupported recovery manifest')
  const root = await fs.realpath(plan.root)
  if (plan.digests) {
    if (plan.digests.root !== root) throw new Error('Digest migration root mismatch')
    await rollbackDigestWikiMigration(plan.digests, true)
  }
  for (const file of plan.files) {
    if (hash(file.before) !== file.hash) throw new Error('Corrupt preimage')
    const current = await fs.readFile(await safeFile(root, file.path), 'utf8')
    if (current !== file.before && current !== file.after)
      throw new Error(`Concurrent edit blocks rollback: ${file.path}`)
  }
  for (const file of [...plan.files].reverse()) {
    if (file.before === file.after) continue
    const path = await safeFile(root, file.path)
    const current = await fs.readFile(path, 'utf8')
    if (current === file.before) continue
    if (current !== file.after) throw new Error(`Concurrent edit blocks rollback: ${file.path}`)
    const temp = join(dirname(path), `.memon-rollback-${randomUUID()}`)
    try {
      await fs.writeFile(temp, file.before, { mode: (await fs.stat(path)).mode, flag: 'wx' })
      if ((await fs.readFile(path, 'utf8')) !== file.after)
        throw new Error(`Concurrent edit blocks rollback: ${file.path}`)
      await fs.rename(temp, path)
    } finally {
      await fs.rm(temp, { force: true })
    }
  }
  if (plan.digests) await rollbackDigestWikiMigration(plan.digests)
}
