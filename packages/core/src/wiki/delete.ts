import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { componentAssetsDir } from '../components/cache.js'
import { acquireIndexLease, writeSnapshot } from '../derived-index/compact.js'
import { resolveIndexPaths } from '../derived-index/paths.js'
import { parseSnapshot } from '../derived-index/schema.js'
import { withFileWriterLock } from '../file-writer-lock.js'
import { formatIsoLocal } from '../time.js'
import { MEMON_RELEASE } from '../version.js'
import {
  type WikiDeleteReference,
  type WikiDeleteTarget,
  wikiDeleteProjectName,
  wikiDeleteReferences,
} from './delete-references.js'
import { discoverWikiPages } from './discover.js'
import { parseWikiFrontmatter } from './frontmatter.js'
import { reserveWikiId } from './id-watermark.js'
import { prepareWikiInventory } from './publish.js'

export class WikiDeleteError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

export interface WikiDeleteInput {
  projectRoot: string
  page: string
  /** Deployment aliases may differ from the checkout directory name. */
  projectName?: string
  projectNames?: string[]
  otherProjectNames?: string[]
  host?: string | null
  origins?: string[]
}

export interface WikiDeleteResult {
  id: string
  deleted: string[]
  scannedDocuments: number
  /** Logical deletion succeeded; these hidden remnants can be cleaned later. */
  cleanupPending: string[]
  warnings: string[]
}

interface Fingerprint {
  path: string
  mtime: number
  size: number
  ino: number
  hash?: string
}
interface Scan {
  fingerprints: Fingerprint[]
  blockers: WikiDeleteReference[]
  documents: number
}
const within = (root: string, candidate: string) =>
  candidate === root || candidate.startsWith(`${root}${sep}`)
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const TEXT_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.markdown',
  '.html',
  '.htm',
  '.json',
  '.yaml',
  '.yml',
  '.css',
  '.svg',
])
const EXPERIMENT_OUTPUT_DIRECTORIES = new Set([
  'cache',
  'caches',
  'node_modules',
  'logs',
  'outputs',
  'data',
  'datasets',
  'checkpoints',
  'venv',
  'build',
  'dist',
  '__pycache__',
])
const MAX_DOCUMENTS = 20_000
const MAX_TEXT_BYTES = 16 * 1024 * 1024

async function contained(root: string, path: string): Promise<string> {
  const real = await fs.realpath(path)
  if (!within(root, real))
    throw new WikiDeleteError('FORBIDDEN', `path escapes the project: ${relative(root, path)}`)
  return real
}

async function optionalStat(path: string) {
  try {
    return await fs.lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function fingerprint(root: string, path: string, text?: Buffer): Promise<Fingerprint> {
  await contained(root, path)
  const stat = await fs.lstat(path)
  return {
    path,
    mtime: stat.mtimeMs,
    size: stat.size,
    ino: stat.ino,
    ...(text ? { hash: hash(text) } : {}),
  }
}

async function scanProject(root: string, target: WikiDeleteTarget): Promise<Scan> {
  const result: Scan = { fingerprints: [], blockers: [], documents: 0 }
  const seen = new Set<string>()
  const documents = new Set<string>()
  async function readDocument(path: string): Promise<void> {
    if (documents.has(path)) return
    documents.add(path)
    await contained(root, path)
    const stat = await fs.stat(path)
    if (stat.size > MAX_TEXT_BYTES)
      throw new WikiDeleteError(
        'BAD_STATE',
        `reference scan cannot safely read oversized document: ${relative(root, path)}`,
      )
    if (++result.documents > MAX_DOCUMENTS)
      throw new WikiDeleteError(
        'BAD_STATE',
        'reference scan exceeded its document bound; no files were deleted',
      )
    const bytes = await fs.readFile(path)
    if (bytes.includes(0))
      throw new WikiDeleteError(
        'BAD_STATE',
        `document is not readable text: ${relative(root, path)}`,
      )
    result.fingerprints.push(await fingerprint(root, path, bytes))
    result.blockers.push(
      ...wikiDeleteReferences(bytes.toString('utf8'), relative(root, path), target),
    )
  }
  async function walk(directory: string, experiment: boolean): Promise<void> {
    const real = await contained(root, directory)
    if (seen.has(real)) return
    seen.add(real)
    result.fingerprints.push(await fingerprint(root, directory))
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.name === '__pycache__'
      )
        continue
      // Runtime trees are not articles. Exclude them before resolving links,
      // while retaining identically named Wiki/Report categories and assets.
      if (
        experiment &&
        !relative(root, directory).split(sep).includes('details') &&
        EXPERIMENT_OUTPUT_DIRECTORIES.has(entry.name)
      )
        continue
      const path = join(directory, entry.name)
      if (target.ownedPaths.some((owned) => within(owned, path))) continue
      if (entry.isSymbolicLink()) {
        const destination = await fs.realpath(path)
        if (target.ownedPaths.some((owned) => within(owned, destination))) {
          result.blockers.push({
            source: relative(root, path),
            line: 1,
            field: 'symlink',
            reference: await fs.readlink(path),
          })
          result.fingerprints.push({
            ...(await fingerprint(root, path)),
            hash: hash(await fs.readlink(path)),
          })
          continue
        }
        await contained(root, path)
      }
      const stat = await fs.stat(path)
      if (stat.isDirectory()) {
        // Nested repositories are separate projects, not this project's articles.
        if (await optionalStat(join(path, '.git'))) continue
        await walk(path, experiment)
      } else if (stat.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        await readDocument(path)
      }
    }
  }
  // Only these three document trees define inbound-reference coverage. Do not
  // enumerate project code, configuration, Run inventories or raw outputs.
  // Fingerprint their parent as well so a newly added document root conflicts.
  result.fingerprints.push(await fingerprint(root, join(root, 'docs')))
  for (const name of ['experiments', 'wiki', 'reports']) {
    const directory = join(root, 'docs', name)
    if (await optionalStat(directory)) await walk(directory, name === 'experiments')
  }
  return result
}

async function inspectOwned(
  root: string,
  path: string,
  files: Fingerprint[] = [],
): Promise<Fingerprint[]> {
  await contained(root, path)
  const stat = await fs.lstat(path)
  if (stat.isSymbolicLink()) {
    files.push({ ...(await fingerprint(root, path)), hash: hash(await fs.readlink(path)) })
  } else if (stat.isDirectory()) {
    files.push(await fingerprint(root, path))
    for (const name of (await fs.readdir(path)).sort())
      await inspectOwned(root, join(path, name), files)
  } else if (stat.isFile()) {
    // Byte-hash document sources; native binary assets are protected by their
    // containing directory and file identity/mtime/size, without loading them.
    files.push(
      await fingerprint(
        root,
        path,
        TEXT_EXTENSIONS.has(extname(path)) ? await fs.readFile(path) : undefined,
      ),
    )
  } else throw new WikiDeleteError('BAD_STATE', `unsupported bundle entry: ${relative(root, path)}`)
  return files
}

async function recheck(root: string, entries: Fingerprint[]): Promise<void> {
  for (const old of entries) {
    try {
      await contained(root, old.path)
      const stat = await fs.lstat(old.path)
      if (
        stat.mtimeMs !== old.mtime ||
        stat.size !== old.size ||
        stat.ino !== old.ino ||
        (old.hash !== undefined &&
          hash(
            stat.isSymbolicLink() ? await fs.readlink(old.path) : await fs.readFile(old.path),
          ) !== old.hash)
      ) {
        throw new Error('changed')
      }
    } catch {
      throw new WikiDeleteError(
        'CONFLICT',
        `reference source changed while checking deletion: ${relative(root, old.path)}`,
      )
    }
  }
}

/** Guarded local/SSHFS deletion. All cooperating writers share the source lock. */
export async function deleteWikiPage(input: WikiDeleteInput): Promise<WikiDeleteResult> {
  const root = await fs.realpath(input.projectRoot)
  for (const rel of ['.memon', '.memon/index', '.memon/locks'])
    if (await optionalStat(join(root, rel))) await contained(root, join(root, rel))
  return withFileWriterLock(root, async () => {
    try {
      return await deleteLocked(root, input)
    } catch (error) {
      if (error instanceof WikiDeleteError) throw error
      throw new WikiDeleteError('BAD_STATE', `Wiki deletion stopped: ${(error as Error).message}`)
    }
  })
}

async function deleteLocked(root: string, input: WikiDeleteInput): Promise<WikiDeleteResult> {
  const pages = await discoverWikiPages(root, { inventoryOnly: true })
  const matches = pages.filter((page) => page.id === input.page || page.slug === input.page)
  if (matches.length !== 1)
    throw new WikiDeleteError(
      matches.length ? 'CONFLICT' : 'NOT_FOUND',
      `expected one Wiki page for ${input.page}; found ${matches.length}`,
    )
  const page = matches[0]!
  if (
    pages.some(
      (other) => other.path !== page.path && (other.id === page.id || other.slug === page.slug),
    )
  )
    throw new WikiDeleteError('CONFLICT', `duplicate Wiki identity or slug for ${page.id}`)
  const ownRoot = page.bundleDir ?? page.absolutePath
  const ownedPaths = [ownRoot]
  const componentAssets = componentAssetsDir(page.absolutePath)
  if (!page.bundleDir && (await optionalStat(componentAssets))) ownedPaths.push(componentAssets)
  const metadata = parseWikiFrontmatter(page.content, page.path).frontmatter
  const reportIds: string[] = []
  async function reportIdentities(directory: string, depth = 0): Promise<void> {
    if (!(await optionalStat(directory))) return
    await contained(root, directory)
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const id = /^(R\d{4})-[a-z0-9][a-z0-9-]*(?:\.md)?$/.exec(entry.name)?.[1]
      const path = join(directory, entry.name)
      if (
        id &&
        ((entry.isFile() && entry.name.endsWith('.md')) ||
          (entry.isDirectory() &&
            ((await optionalStat(join(path, 'README.md'))) ||
              (await optionalStat(join(path, 'manifest.json'))))))
      )
        reportIds.push(id)
      else if (entry.isDirectory() && depth === 0) await reportIdentities(path, 1)
    }
  }
  await reportIdentities(join(root, 'docs/reports'))
  const target: WikiDeleteTarget = {
    projectRoot: root,
    projectName: input.projectName ?? wikiDeleteProjectName(root),
    id: page.id,
    slug: page.slug,
    legacyId: typeof metadata?.legacy_id === 'string' ? metadata.legacy_id : undefined,
    ownedPaths,
    projectNames: input.projectNames,
    otherProjectNames: input.otherProjectNames,
    host: input.host,
    origins: input.origins,
    reportIds,
  }
  const owned = (await Promise.all(ownedPaths.map((path) => inspectOwned(root, path)))).flat()
  await prepareWikiInventory(root)
  const scan = await scanProject(root, target)
  if (scan.blockers.length) {
    const ambiguous = scan.blockers.filter((reference) => reference.ambiguous).length
    const confirmed = scan.blockers.length - ambiguous
    throw new WikiDeleteError(
      confirmed ? 'WIKI_REFERENCED' : 'WIKI_REFERENCE_AMBIGUOUS',
      `${page.id}: ${confirmed} inbound references${ambiguous ? ` and ${ambiguous} links with unresolved project scope` : ''}; repair or resolve them before deleting`,
      { references: scan.blockers },
    )
  }

  // Publish only the inventory removal, never run result aggregation. An absent
  // legacy cache can be initialized; a corrupt registered cache is a repair error.
  const indexPath = resolveIndexPaths(root).snapshot
  const lease = await acquireIndexLease(root, { role: 'cli' })
  if (!lease)
    throw new WikiDeleteError('CONFLICT', 'inventory publication is busy; no files were deleted')
  const moved: Array<{ from: string; to: string }> = []
  const warnings: string[] = []
  let published = false
  let failure: unknown
  try {
    const parsed = parseSnapshot(JSON.parse(await fs.readFile(indexPath, 'utf8')))
    if (!parsed.ok)
      throw new WikiDeleteError('BAD_STATE', 'invalid inventory; run memon refresh before deletion')
    await recheck(root, owned)
    // Index/lock writes only affect the ignored .memon subtree, not scanned documents.
    await recheck(root, scan.fingerprints)
    await reserveWikiId(root, Math.max(...pages.map((p) => Number(p.id.slice(1)))), false)
    if (!(await lease.held()))
      throw new WikiDeleteError('CONFLICT', 'inventory publication lease expired')
    for (const from of ownedPaths) {
      const to = join(dirname(from), `.deleted-${basename(from)}-${randomUUID()}`)
      await fs.rename(from, to)
      moved.push({ from, to })
    }
    for (const key of Object.keys(parsed.value.wiki))
      if (ownedPaths.some((owned) => within(owned, resolve(root, key))))
        delete parsed.value.wiki[key]
    parsed.value.generated_at = formatIsoLocal(new Date())
    parsed.value.generator = { role: 'cli', release: MEMON_RELEASE }
    await writeSnapshot(root, parsed.value)
    published = true
  } catch (error) {
    failure = error
    for (const move of moved.reverse()) await fs.rename(move.to, move.from)
    throw error
  } finally {
    try {
      await lease.release()
    } catch (error) {
      const message = `Inventory lease could not be released: ${(error as Error).message}`
      if (published) warnings.push(message)
      else if (failure instanceof Error) failure.message += `; ${message}`
    }
  }
  const cleanupPending: string[] = []
  for (const move of moved) {
    try {
      await fs.rm(move.to, { recursive: true, force: true })
    } catch {
      cleanupPending.push(relative(root, move.to))
    }
  }
  return {
    id: page.id,
    deleted: ownedPaths.map((p) => relative(root, p)),
    scannedDocuments: scan.documents,
    cleanupPending,
    warnings,
  }
}
