// Two-level discovery of `<projectRoot>/docs/wiki/`.
//
//   docs/wiki/<kind>/W<NNNN>-<slug>.md          -> format 'markdown'
//   docs/wiki/<kind>/W<NNNN>-<slug>/README.md   -> format 'bundle'
//
// Exactly two levels: files sitting directly under `docs/wiki/`, entries whose
// name does not match `W<NNNN>-<slug>`, and anything nested deeper than a
// bundle's `README.md` are ignored. A `<kind>` directory outside WIKI_KINDS is
// still discovered (kind = directory name); the lint pass turns that into
// WIKI_UNKNOWN_KIND.

import type { Dirent } from 'node:fs'
import * as path from '@memon/file-protocol/paths'
import { throwIfSourceFailure } from '../project-file-store/errors.js'
import { projectFs as fs } from '../project-file-store.js'

import { WIKI_DIR_RELPATH, WIKI_PAGE_NAME_REGEX, type WikiPageFormat } from './types.js'

/** Depth cap for the bundle asset listing (README.md itself is depth 1). */
const BUNDLE_ASSET_MAX_DEPTH = 8
/** Safety cap so a stray data directory cannot stall discovery. */
const BUNDLE_ASSET_MAX_FILES = 5000
/** Component execution caches live beside a page in `<stem>__assets/`. */
const COMPONENT_ASSETS_SUFFIX = '__assets'

export interface DiscoveredWikiPage {
  /** Page id taken from the file / directory name (`W<NNNN>`). */
  id: string
  /** Slug portion of the file / directory name. */
  slug: string
  /** Enclosing directory name, canonical or not. */
  kind: string
  format: WikiPageFormat
  /** Project-relative POSIX path of the `.md` / `README.md`. */
  path: string
  /** Absolute path of the `.md` / `README.md`. */
  absolutePath: string
  /** Absolute path of the bundle directory; null for the single-file form. */
  bundleDir: string | null
  /** File content, frontmatter included. */
  content: string
  /** README mtime in epoch ms — the optimistic-locking key for writes. */
  mtime: number
  /** Newest mtime across the page file and (for a bundle) its assets. */
  bundleMtime: number
  /**
   * Bundle-relative POSIX paths of every file inside the bundle (README.md
   * included). Empty for the single-file form; used for `entry` validation
   * and by the asset route.
   */
  assets: string[]
}

export interface DiscoverWikiPagesOptions {
  /** Read page identity/frontmatter without walking bundle attachments. */
  inventoryOnly?: boolean
}

/**
 * Scan a project's wiki. Returns the pages ordered by kind directory then
 * page name so callers get a stable list without re-sorting. Missing
 * `docs/wiki/` yields an empty array.
 */
export async function discoverWikiPages(
  projectRoot: string,
  options: DiscoverWikiPagesOptions = {},
): Promise<DiscoveredWikiPage[]> {
  const wikiDir = path.join(projectRoot, WIKI_DIR_RELPATH)
  let kindEntries: Dirent[]
  try {
    kindEntries = await fs.readdir(wikiDir, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  const discovered = await Promise.all(
    [...kindEntries]
      .filter((entry) => entry.isDirectory() && entry.name !== 'assets')
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .map(async (kindEntry) => {
        const kind = kindEntry.name
        const kindDir = path.join(wikiDir, kind)
        let pageEntries: Dirent[]
        try {
          pageEntries = await fs.readdir(kindDir, { withFileTypes: true })
        } catch (error) {
          throwIfSourceFailure(error)
          return []
        }
        return Promise.all(
          [...pageEntries]
            // `<page>__assets/` holds component execution caches, not a page.
            .filter((entry) => !entry.name.endsWith(COMPONENT_ASSETS_SUFFIX))
            .sort((a, b) => (a.name < b.name ? -1 : 1))
            .map((pageEntry) =>
              pageEntry.isDirectory()
                ? readBundlePage(projectRoot, kind, kindDir, pageEntry.name, options.inventoryOnly)
                : readMarkdownPage(projectRoot, kind, kindDir, pageEntry.name),
            ),
        )
      }),
  )
  return discovered.flat(2).filter((page): page is DiscoveredWikiPage => page !== null)
}

async function readMarkdownPage(
  projectRoot: string,
  kind: string,
  kindDir: string,
  entryName: string,
): Promise<DiscoveredWikiPage | null> {
  if (!entryName.endsWith('.md')) return null
  const match = WIKI_PAGE_NAME_REGEX.exec(entryName.slice(0, -'.md'.length))
  if (!match) return null
  const absolutePath = path.join(kindDir, entryName)
  const read = await readPageFile(absolutePath)
  if (!read) return null
  return {
    id: match[1]!,
    slug: match[2]!,
    kind,
    format: 'markdown',
    path: toProjectRelative(projectRoot, absolutePath),
    absolutePath,
    bundleDir: null,
    content: read.content,
    mtime: read.mtime,
    bundleMtime: read.mtime,
    assets: [],
  }
}

async function readBundlePage(
  projectRoot: string,
  kind: string,
  kindDir: string,
  entryName: string,
  inventoryOnly = false,
): Promise<DiscoveredWikiPage | null> {
  const match = WIKI_PAGE_NAME_REGEX.exec(entryName)
  if (!match) return null
  const bundleDir = path.join(kindDir, entryName)
  const absolutePath = path.join(bundleDir, 'README.md')
  const read = await readPageFile(absolutePath)
  if (!read) return null
  const { assets, newestMtime } = inventoryOnly
    ? { assets: [], newestMtime: read.mtime }
    : await listBundleAssets(bundleDir)
  return {
    id: match[1]!,
    slug: match[2]!,
    kind,
    format: 'bundle',
    path: toProjectRelative(projectRoot, absolutePath),
    absolutePath,
    bundleDir,
    content: read.content,
    mtime: read.mtime,
    bundleMtime: Math.max(read.mtime, newestMtime),
    assets,
  }
}

async function readPageFile(
  absolutePath: string,
): Promise<{ content: string; mtime: number } | null> {
  try {
    const stat = await fs.stat(absolutePath)
    if (!stat.isFile()) return null
    return { content: await fs.readFile(absolutePath, 'utf8'), mtime: stat.mtimeMs }
  } catch (error) {
    throwIfSourceFailure(error)
    return null
  }
}

/**
 * Depth-limited listing of a bundle directory. Symlinked directories are not
 * followed (`withFileTypes` reports the link itself, and `isDirectory()` is
 * false for it), which keeps a self-referential link from looping.
 */
async function listBundleAssets(
  bundleDir: string,
): Promise<{ assets: string[]; newestMtime: number }> {
  const assets: string[] = []
  let newestMtime = 0
  const queue: { dir: string; prefix: string; depth: number }[] = [
    { dir: bundleDir, prefix: '', depth: 1 },
  ]
  while (queue.length > 0) {
    const { dir, prefix, depth } = queue.shift()!
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (error) {
      throwIfSourceFailure(error)
      continue
    }
    const directories: { dir: string; prefix: string; depth: number }[] = []
    const files: { absolute: string; relative: string }[] = []
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (depth < BUNDLE_ASSET_MAX_DEPTH) {
          directories.push({
            dir: path.join(dir, entry.name),
            prefix: relative,
            depth: depth + 1,
          })
        }
      } else if (entry.isFile() && assets.length + files.length < BUNDLE_ASSET_MAX_FILES) {
        files.push({ absolute: path.join(dir, entry.name), relative })
      }
    }
    queue.push(...directories)
    const mtimes = await Promise.all(
      files.map(async (file) => {
        try {
          return (await fs.stat(file.absolute)).mtimeMs
        } catch (error) {
          throwIfSourceFailure(error)
          return 0
        }
      }),
    )
    assets.push(...files.map((file) => file.relative))
    newestMtime = Math.max(newestMtime, ...mtimes)
    if (assets.length >= BUNDLE_ASSET_MAX_FILES) return { assets, newestMtime }
  }
  assets.sort()
  return { assets, newestMtime }
}

function toProjectRelative(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).split(path.sep).join('/')
}
