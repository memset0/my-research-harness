import 'server-only'

import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { extractTitle, projectFs as fs, writeFileAtomic } from '@memon/core'
import { splitFrontmatter } from '../frontmatter'

const REPORT_FILE_RE = /^R(\d{4})-([a-z0-9][a-z0-9-]*)\.md$/
const REPORT_DIR_RE = /^R(\d{4})-([a-z0-9][a-z0-9-]*)$/

export type ReportFormat = 'markdown' | 'bundle'

export interface WebReportSummary {
  id: string
  slug: string
  /** README.md for bundles, otherwise the legacy standalone Markdown file. */
  path: string
  mtime: number
  title: string | null
  format: ReportFormat
}

export interface ReportEntry extends WebReportSummary {
  /** Directory against which relative bundle resources are resolved. */
  rootPath: string
}

export interface ReportContent extends WebReportSummary {
  hash: string
  content: string
}

export type ReportWriteResult =
  | { ok: true; mtime: number; hash: string }
  | {
      ok: false
      code: 'CONFLICT' | 'NOT_FOUND' | 'ERROR'
      currentMtime?: number
      currentHash?: string
      currentContent?: string
      message?: string
    }

/**
 * Discover both report layouts without forcing legacy Markdown reports to
 * migrate:
 *
 *   R0001-summary.md
 *   R0002-dashboard/README.md
 *
 * Bundle directories are deliberately not recursive. Their other files are
 * resources owned by that report, not additional reports.
 */
export async function discoverReports(reportsDir: string): Promise<ReportEntry[]> {
  let dirents: Dirent[]
  try {
    dirents = await fs.readdir(reportsDir, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  const entries: ReportEntry[] = []
  for (const dirent of dirents) {
    const fileMatch = dirent.isFile() ? REPORT_FILE_RE.exec(dirent.name) : null
    const dirMatch = dirent.isDirectory() ? REPORT_DIR_RE.exec(dirent.name) : null
    if (!fileMatch && !dirMatch) continue

    const id = `R${(fileMatch ?? dirMatch)![1]}`
    const slug = (fileMatch ?? dirMatch)![2]!
    const rootPath = dirMatch ? join(reportsDir, dirent.name) : reportsDir
    const path = dirMatch ? join(rootPath, 'README.md') : join(reportsDir, dirent.name)

    let stat: Awaited<ReturnType<typeof fs.stat>>
    let content: string
    try {
      stat = await fs.stat(path)
      if (!stat.isFile()) continue
      const [realRoot, realPath] = await Promise.all([fs.realpath(rootPath), fs.realpath(path)])
      if (!isWithin(realRoot, realPath)) continue
      content = await fs.readFile(path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw err
    }

    entries.push({
      id,
      slug,
      path,
      rootPath,
      mtime: stat.mtimeMs,
      title: extractReportTitle(content),
      format: dirMatch ? 'bundle' : 'markdown',
    })
  }

  return entries.sort((a, b) => b.id.localeCompare(a.id) || a.path.localeCompare(b.path))
}

export async function findReport(reportsDir: string, id: string): Promise<ReportEntry | null> {
  const matches = (await discoverReports(reportsDir)).filter((entry) => entry.id === id)
  if (matches.length === 0) return null
  // IDs are globally unique by convention. During a malformed partial
  // migration prefer the bundle: it is the newer canonical representation,
  // while the list still exposes both entries so the collision is visible.
  return matches.find((entry) => entry.format === 'bundle') ?? matches[0]!
}

export async function readReport(entry: ReportEntry): Promise<ReportContent | null> {
  try {
    await assertEntryWithinRoot(entry)
    const stat = await fs.stat(entry.path)
    if (!stat.isFile()) return null
    const content = await fs.readFile(entry.path, 'utf8')
    return {
      id: entry.id,
      slug: entry.slug,
      path: entry.path,
      mtime: stat.mtimeMs,
      title: extractReportTitle(content),
      format: entry.format,
      hash: sha1(content),
      content,
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** Prefer the visible Markdown H1; fall back to the Report frontmatter title. */
export function extractReportTitle(content: string): string | null {
  const heading = extractTitle(content)
  if (heading) return heading
  const title = splitFrontmatter(content).frontmatter?.title
  return typeof title === 'string' && title.trim() !== '' ? title.trim() : null
}

export async function writeReport(
  entry: ReportEntry,
  content: string,
  expectedMtime: number,
  expectedHash: string,
): Promise<ReportWriteResult> {
  let stat: Awaited<ReturnType<typeof fs.stat>>
  let currentContent: string
  try {
    await assertEntryWithinRoot(entry)
    stat = await fs.stat(entry.path)
    currentContent = await fs.readFile(entry.path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, code: 'NOT_FOUND' }
    }
    return { ok: false, code: 'ERROR', message: (err as Error).message }
  }

  const currentHash = sha1(currentContent)
  if (stat.mtimeMs !== expectedMtime || currentHash !== expectedHash) {
    return {
      ok: false,
      code: 'CONFLICT',
      currentMtime: stat.mtimeMs,
      currentHash,
      currentContent,
    }
  }

  try {
    await writeFileAtomic(entry.path, content)
    const nextStat = await fs.stat(entry.path)
    return { ok: true, mtime: nextStat.mtimeMs, hash: sha1(content) }
  } catch (err) {
    return { ok: false, code: 'ERROR', message: (err as Error).message }
  }
}

async function assertEntryWithinRoot(entry: ReportEntry): Promise<void> {
  const [realRoot, realPath] = await Promise.all([
    fs.realpath(entry.rootPath),
    fs.realpath(entry.path),
  ])
  if (!isWithin(realRoot, realPath)) {
    throw new ReportResourceError('OUTSIDE_REPORT', 'report document symlink escapes its directory')
  }
}

export class ReportResourceError extends Error {
  constructor(
    public readonly code: 'BAD_PATH' | 'NOT_FOUND' | 'OUTSIDE_REPORT' | 'NOT_A_FILE',
    message: string,
  ) {
    super(message)
    this.name = 'ReportResourceError'
  }
}

/**
 * Resolve a resource beneath a bundle with lexical *and* realpath checks.
 * The realpath check is essential: a symlink stored inside a report must not
 * become an escape hatch to arbitrary server files.
 */
export async function resolveReportResource(
  entry: ReportEntry,
  pathSegments: string[],
): Promise<{
  path: string
  contentType: string
  mtimeMs: number
  size: number
  version: string
}> {
  if (entry.format !== 'bundle') {
    throw new ReportResourceError('NOT_FOUND', 'standalone Markdown reports have no resource tree')
  }
  if (pathSegments.length === 0) {
    throw new ReportResourceError('BAD_PATH', 'resource path is required')
  }

  for (const segment of pathSegments) {
    if (
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('/') ||
      segment.includes('\\') ||
      segment.includes('\0')
    ) {
      throw new ReportResourceError('BAD_PATH', 'invalid report resource path')
    }
    // Reject encoded dot/slash variants too. Next normally decodes dynamic
    // params, while the headless node dispatcher passes URL segments through;
    // defense here must cover both call paths.
    let decoded = segment
    for (let pass = 0; pass < 2; pass++) {
      try {
        const next = decodeURIComponent(decoded)
        if (next === decoded) break
        decoded = next
      } catch {
        throw new ReportResourceError('BAD_PATH', 'invalid encoded report resource path')
      }
      if (
        decoded === '.' ||
        decoded === '..' ||
        decoded.includes('/') ||
        decoded.includes('\\') ||
        decoded.includes('\0')
      ) {
        throw new ReportResourceError('BAD_PATH', 'invalid encoded report resource path')
      }
    }
  }
  // README is the bundle's canonical document and is served by the Report
  // content API, not as an opaque asset. This also avoids two URLs with
  // subtly different caching semantics for the same source document.
  if (pathSegments.length === 1 && pathSegments[0]!.toLowerCase() === 'readme.md') {
    throw new ReportResourceError('NOT_FOUND', 'report README is not an asset')
  }

  const lexicalRoot = resolve(entry.rootPath)
  const lexicalTarget = resolve(lexicalRoot, ...pathSegments)
  if (!isWithin(lexicalRoot, lexicalTarget)) {
    throw new ReportResourceError('OUTSIDE_REPORT', 'resource path escapes its report directory')
  }

  let realRoot: string
  let realTarget: string
  try {
    ;[realRoot, realTarget] = await Promise.all([
      fs.realpath(lexicalRoot),
      fs.realpath(lexicalTarget),
    ])
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ReportResourceError('NOT_FOUND', 'report resource does not exist')
    }
    throw err
  }
  if (!isWithin(realRoot, realTarget)) {
    throw new ReportResourceError('OUTSIDE_REPORT', 'resource symlink escapes its report directory')
  }

  const stat = await fs.stat(realTarget)
  if (!stat.isFile()) {
    throw new ReportResourceError('NOT_A_FILE', 'report resource is not a file')
  }
  return {
    path: realTarget,
    contentType: contentTypeFor(realTarget),
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    // Weak metadata validator: inexpensive enough for low-frequency HEAD
    // polling and changes whenever the resolved entry's size or mtime changes.
    version: sha1(`${stat.size}:${stat.mtimeMs}`),
  }
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep))
}

export function contentTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.yaml':
    case '.yml':
      return 'application/yaml; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.avif':
      return 'image/avif'
    case '.ico':
      return 'image/x-icon'
    case '.pdf':
      return 'application/pdf'
    case '.wasm':
      return 'application/wasm'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    case '.ttf':
      return 'font/ttf'
    case '.otf':
      return 'font/otf'
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.xml':
      return 'application/xml; charset=utf-8'
    case '.map':
      return 'application/json; charset=utf-8'
    case '.csv':
      return 'text/csv; charset=utf-8'
    case '.txt':
    case '.md':
      return 'text/plain; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

function sha1(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}
