// Document discovery served from the Project summary index.
//
// These mirror core's wiki discovery and the document service's former
// inventories, but every directory listing, page body and real path is an
// index observation: a warm request re-validates fingerprints instead of
// re-reading bodies, and inside a list window it touches nothing at all.

import type { Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'
import {
  type BackendResourceInventoryItem,
  type DiscoveredWikiPage,
  projectFs as fs,
  type ProjectConfig,
  ResourceIdSchema,
  WIKI_DIR_RELPATH,
  WIKI_PAGE_NAME_REGEX,
} from '@memon/core'
import { isContained } from './containment.js'
import { digest, type ListedEntry, projectReadIndex, type ReadPolicy } from './read-index.js'
import { realProjectRoot } from './request-scope.js'

/** Same bounds as core's bundle asset listing. */
const BUNDLE_ASSET_MAX_DEPTH = 8
const BUNDLE_ASSET_MAX_FILES = 5000
const COMPONENT_ASSETS_SUFFIX = '__assets'

const byName = (left: { name: string }, right: { name: string }) =>
  left.name < right.name ? -1 : left.name > right.name ? 1 : 0

/**
 * Wiki pages as core's `discoverWikiPages` returns them (kind order, then
 * page name). `assets: false` skips the bundle asset listing, as the
 * inventory does.
 */
export async function indexedWikiPages(
  project: ProjectConfig,
  policy: ReadPolicy,
  options: { assets: boolean },
): Promise<DiscoveredWikiPage[]> {
  const index = projectReadIndex(project.root)
  const age = policy.listMaxAgeMs
  const wikiDir = join(project.root, ...WIKI_DIR_RELPATH.split('/'))
  const kinds = await index.listing(wikiDir, age)
  if (!kinds) return []
  const perKind = await Promise.all(
    kinds
      .filter((entry) => entry.type === 'dir' && entry.name !== 'assets')
      .sort(byName)
      .map(async (kindEntry) => {
        const kind = kindEntry.name
        const kindDir = join(wikiDir, kind)
        const entries = (await index.listing(kindDir, age)) ?? []
        return Promise.all(
          entries
            .filter((entry) => !entry.name.endsWith(COMPONENT_ASSETS_SUFFIX))
            .sort(byName)
            .map((entry) => indexedWikiPage(project, policy, kind, kindDir, entry, options.assets)),
        )
      }),
  )
  return perKind.flat().filter((page): page is DiscoveredWikiPage => page !== null)
}

/** The summary-index key of a wiki page file (see `ProjectReadIndex.file`). */
export function wikiPageKey(absolutePath: string): string {
  return `file:${absolutePath}#wiki-page`
}

async function indexedWikiPage(
  project: ProjectConfig,
  policy: ReadPolicy,
  kind: string,
  kindDir: string,
  entry: ListedEntry,
  withAssets: boolean,
): Promise<DiscoveredWikiPage | null> {
  const bundle = entry.type === 'dir'
  const stem = bundle ? entry.name : entry.name.endsWith('.md') ? entry.name.slice(0, -3) : null
  const match = stem === null ? null : WIKI_PAGE_NAME_REGEX.exec(stem)
  if (!match) return null
  const bundleDir = bundle ? join(kindDir, entry.name) : null
  const absolutePath = bundleDir ? join(bundleDir, 'README.md') : join(kindDir, entry.name)
  const page = await projectReadIndex(project.root).file(
    absolutePath,
    'wiki-page',
    policy.listMaxAgeMs,
    (content, stat) => (stat.isFile() ? { content, mtime: stat.mtimeMs } : null),
  )
  if (!page) return null
  const assets =
    bundleDir && withAssets ? await indexedBundleAssets(project, policy, bundleDir) : null
  return {
    id: match[1]!,
    slug: match[2]!,
    kind,
    format: bundle ? 'bundle' : 'markdown',
    path: relative(project.root, absolutePath).split(sep).join('/'),
    absolutePath,
    bundleDir,
    content: page.content,
    mtime: page.mtime,
    bundleMtime: Math.max(page.mtime, assets?.newestMtime ?? 0),
    assets: assets?.assets ?? [],
  }
}

interface BundleAssets {
  assets: string[]
  newestMtime: number
}

/** Core's depth-limited bundle listing, re-walked only when its window passed. */
async function indexedBundleAssets(
  project: ProjectConfig,
  policy: ReadPolicy,
  bundleDir: string,
): Promise<BundleAssets> {
  const assets = await projectReadIndex(project.root).observe<BundleAssets, BundleAssets>(
    `tree:${bundleDir}`,
    policy.listMaxAgeMs,
    async () => {
      const listed = await listBundleAssets(bundleDir)
      return {
        fingerprint: digest([String(listed.newestMtime), ...listed.assets]),
        observed: listed,
      }
    },
    async (listed) => listed!,
  )
  return assets ?? { assets: [], newestMtime: 0 }
}

async function listBundleAssets(bundleDir: string): Promise<BundleAssets> {
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
    } catch {
      continue
    }
    const directories: { dir: string; prefix: string; depth: number }[] = []
    const files: { absolute: string; relative: string }[] = []
    for (const entry of entries) {
      const relativeName = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (depth < BUNDLE_ASSET_MAX_DEPTH) {
          directories.push({ dir: join(dir, entry.name), prefix: relativeName, depth: depth + 1 })
        }
      } else if (entry.isFile() && assets.length + files.length < BUNDLE_ASSET_MAX_FILES) {
        files.push({ absolute: join(dir, entry.name), relative: relativeName })
      }
    }
    queue.push(...directories)
    const mtimes = await Promise.all(
      files.map(async (file) => {
        try {
          return (await fs.stat(file.absolute)).mtimeMs
        } catch {
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

/**
 * The real path of `lexical` when it exists inside the real Project root;
 * `null` when it is absent or escapes. Other failures propagate.
 */
export async function containedReal(
  project: ProjectConfig,
  policy: ReadPolicy,
  lexical: string,
): Promise<string | null> {
  const real = await projectReadIndex(project.root).realpath(lexical, policy.listMaxAgeMs)
  if (real === null) return null
  return isContained(await realProjectRoot(project.root), real) ? real : null
}

/**
 * A child directory named in a listing of a contained parent: a real
 * directory is contained lexically; a symlink is resolved and judged by its
 * real path; anything else is not a directory.
 */
async function childDirectory(
  project: ProjectConfig,
  policy: ReadPolicy,
  parent: string,
  entry: ListedEntry | undefined,
): Promise<boolean> {
  if (!entry) return false
  if (entry.type === 'dir') return true
  if (entry.type !== 'link') return false
  return (await containedReal(project, policy, join(parent, entry.name))) !== null
}

const CODE_REVIEW_FILE = /^\d{4}-\d{2}-\d{2}-([a-z0-9][a-z0-9-]*)\.md$/
const EXPERIMENT_FOLDER = /^E\d{4}-[a-z0-9-]+$/

/** Code-review identities from listings: one real path for `docs/`. */
export async function indexedCodeReviewInventory(
  project: ProjectConfig,
  policy: ReadPolicy,
): Promise<BackendResourceInventoryItem[]> {
  const index = projectReadIndex(project.root)
  const age = policy.listMaxAgeMs
  const docs = join(project.root, 'docs')
  if ((await containedReal(project, policy, docs)) === null) return []
  const docsEntries = new Map(((await index.listing(docs, age)) ?? []).map((e) => [e.name, e]))
  const candidates: Array<{ relativePath: string; slug: string }> = []
  const collect = (entries: readonly ListedEntry[] | null, prefix: string) => {
    for (const entry of entries ?? []) {
      const match = entry.type === 'file' ? CODE_REVIEW_FILE.exec(entry.name) : null
      if (match) candidates.push({ relativePath: `${prefix}/${entry.name}`, slug: match[1]! })
    }
  }
  const flat = join(docs, 'code-review')
  if (await childDirectory(project, policy, docs, docsEntries.get('code-review'))) {
    collect(await index.listing(flat, age), 'code-review')
  }
  const experiments = join(docs, 'experiments')
  if (await childDirectory(project, policy, docs, docsEntries.get('experiments'))) {
    const folders = ((await index.listing(experiments, age)) ?? []).filter(
      (entry) => entry.type === 'dir' && EXPERIMENT_FOLDER.test(entry.name),
    )
    await Promise.all(
      folders.map(async (folder) => {
        const folderPath = join(experiments, folder.name)
        // One real-path probe per Experiment folder (cached in the window):
        // listing the folder itself would cost a stat per scratch file.
        if ((await containedReal(project, policy, join(folderPath, 'code-review'))) === null) return
        collect(
          await index.listing(join(folderPath, 'code-review'), age),
          `experiments/${folder.name}/code-review`,
        )
      }),
    )
  }
  return candidates
    .map(({ relativePath, slug }) => ({
      id: relativePath.replace(/\.md$/, ''),
      slug,
      resource: ResourceIdSchema.parse(`docs/${relativePath}`),
    }))
    .sort((left, right) => right.id.localeCompare(left.id))
}

const REPORT_FILE = /^R(\d{4})-([a-z0-9][a-z0-9-]*)\.md$/
const REPORT_BUNDLE = /^R(\d{4})-([a-z0-9][a-z0-9-]*)$/

/** Report identities from one listing of a contained `docs/reports`. */
export async function indexedReportInventory(
  project: ProjectConfig,
  policy: ReadPolicy,
): Promise<BackendResourceInventoryItem[]> {
  const directory = join(project.root, 'docs', 'reports')
  if ((await containedReal(project, policy, directory)) === null) return []
  const entries =
    (await projectReadIndex(project.root).listing(directory, policy.listMaxAgeMs)) ?? []
  const items: BackendResourceInventoryItem[] = []
  for (const entry of entries) {
    const file = entry.type === 'file' ? REPORT_FILE.exec(entry.name) : null
    const bundle = entry.type === 'dir' ? REPORT_BUNDLE.exec(entry.name) : null
    const match = file ?? bundle
    if (!match) continue
    items.push({
      id: `R${match[1]}`,
      slug: match[2]!,
      resource: ResourceIdSchema.parse(`docs/reports/${entry.name}${bundle ? '/README.md' : ''}`),
    })
  }
  return items.sort(
    (left, right) => right.id.localeCompare(left.id) || left.resource.localeCompare(right.resource),
  )
}
