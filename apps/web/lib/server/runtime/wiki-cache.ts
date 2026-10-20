// Live wiki cache: `<projectRoot>/docs/wiki/` two levels deep, plus the
// derived projections every wiki surface serves.
//
// Layout (see @memon/core `discoverWikiPages`):
//
//   docs/wiki/<kind>/W<NNNN>-<slug>.md          -> format 'markdown'
//   docs/wiki/<kind>/W<NNNN>-<slug>/README.md   -> format 'bundle'
//
// The DirCache runs in its opt-in depth-2 mode: the configured directory is
// `docs/wiki/` itself (so a new kind directory is noticed from its mtime),
// every kind directory is registered as a content directory of its own, and
// every page file — plain or a bundle's README — is watched individually. No
// filesystem event APIs; the shared Poller drives every refresh.
//
import { type Dirent, promises as fs } from 'node:fs'
import {
  buildWikiProject,
  type DiscoveredWikiPage,
  type Poller,
  WIKI_DIR_RELPATH,
  WIKI_PAGE_NAME_REGEX,
  type WikiBacklink,
  type WikiProjectContext,
  type WikiProjectProjection,
  type WikiSummary,
} from '@memon/core'
import { join } from '@memon/file-protocol/paths'
import { DirCache, type PutContentConflict, type PutContentResult } from './dir-cache'

/** `W<NNNN>-<slug>.md` — the single-file page form. */
const WIKI_PAGE_FILE_REGEX = /^W\d{4}-[a-z0-9][a-z0-9-]*\.md$/
const BUNDLE_README = 'README.md'
/** Depth cap for the bundle asset listing (README.md itself is depth 1). */
const BUNDLE_ASSET_MAX_DEPTH = 8
/** Safety cap so a stray data directory cannot stall a scan. */
const BUNDLE_ASSET_MAX_FILES = 5000

export interface WikiCacheProject {
  name: string
  root: string
}

/** One page's freshly-read bytes alongside its cached summary. */
export interface WikiCachePage {
  summary: WikiSummary
  content: string
  mtime: number
  hash: string
}

export interface WikiCacheDeps {
  projects: readonly WikiCacheProject[]
  /**
   * Live projection inputs for one project (Experiment index, run index,
   * hypotheses mtime, report ids). Called on every projection rebuild and
   * MUST only read in-memory state.
   */
  context: (project: WikiCacheProject) => WikiProjectContext
  /** Emitted after any list-level change (SSE `wiki-change`). */
  onChange: (project: string) => void
}

/** Cache counters. */
export interface WikiCacheStats {
  /** Projection rebuilds (pure CPU, no I/O). */
  projections: number
}

interface ProjectState {
  project: WikiCacheProject
  wikiDir: string
  /** Pre-warm invalidations must be applied by the initial projection build. */
  dirty: boolean
  projection: WikiProjectProjection | null
}

export class WikiCache {
  private readonly cache: DirCache<DiscoveredWikiPage>
  private readonly states: ProjectState[]
  private readonly byName = new Map<string, ProjectState>()
  private readonly stats: WikiCacheStats = { projections: 0 }
  /** Whether the initial page scan has completed. */
  private warmed = false

  constructor(private readonly deps: WikiCacheDeps) {
    this.states = deps.projects.map((project) => ({
      project,
      wikiDir: join(project.root, ...WIKI_DIR_RELPATH.split('/')),
      dirty: true,
      projection: null,
    }))
    for (const state of this.states) this.byName.set(state.project.name, state)

    this.cache = new DirCache<DiscoveredWikiPage>({
      name: 'wiki',
      dirs: this.states.map((state) => state.wikiDir),
      depth: 2,
      fileNameRegex: WIKI_PAGE_FILE_REGEX,
      bundleDirNameRegex: WIKI_PAGE_NAME_REGEX,
      bundleFileName: BUNDLE_README,
      parseFile: (absPath, content, mtime) => this.readRecord(absPath, content, mtime),
      onUpdate: (dir) => {
        const state = this.stateForDir(dir)
        if (!state) return
        this.rebuildProjection(state)
        this.deps.onChange(state.project.name)
      },
    })
  }

  /** Content directories to register with the Poller (roots + kind dirs). */
  dirs(): string[] {
    return this.cache.dirs()
  }

  /** Page files to register with the Poller. */
  paths(): string[] {
    return this.cache.paths()
  }

  /** `docs/wiki/` for a configured project, or null. */
  wikiDir(project: string): string | null {
    return this.byName.get(project)?.wikiDir ?? null
  }

  /**
   * Initial scan of every project's wiki.
   * Runs before the first request lands (instrumentation.ts warmup).
   */
  async warmup(): Promise<void> {
    await this.cache.warmup()
    this.warmed = true
    for (const state of this.states) this.rebuildProjection(state)
  }

  /** Poller dispatch for Wiki directories and page files only. */
  handlePollChange(path: string, poller?: Poller): boolean {
    return this.cache.handlePollChange(path, poller)
  }

  /** Canonically ordered list projection. Never reads the filesystem. */
  getWikiList(project: string): WikiSummary[] {
    return this.projectionFor(project)?.summaries ?? []
  }

  /** One page's summary, addressed by `W<NNNN>`. */
  getWikiSummary(project: string, id: string): WikiSummary | null {
    return this.projectionFor(project)?.byId.get(id) ?? null
  }

  /** Citing pages for an artifact key (`E0017`, `E0017-slug`, `H0002`, run dir). */
  getWikiBacklinks(project: string, artifact: string): WikiBacklink[] {
    return this.projectionFor(project)?.backlinks.get(artifact) ?? []
  }

  /**
   * Raw discovered record for one page: the bundle directory, the asset
   * listing, and the absolute path the routes address.
   */
  getPageRecord(project: string, id: string): DiscoveredWikiPage | null {
    const state = this.byName.get(project)
    if (!state) return null
    const summary = this.getWikiSummary(project, id)
    if (!summary) return null
    const absPath = join(state.project.root, ...summary.path.split('/'))
    return this.cache.getAllList().find((page) => page.absolutePath === absPath) ?? null
  }

  /** Absolute path of a page's `.md` / `README.md`, or null. */
  pagePath(project: string, id: string): string | null {
    return this.getPageRecord(project, id)?.absolutePath ?? null
  }

  /**
   * Fresh content + mtime + hash for one page, alongside its cached summary.
   * The bytes are re-read so the returned mtime/hash pair is exactly the one
   * a subsequent optimistic-locked write must match.
   */
  async getWikiPage(project: string, id: string): Promise<WikiCachePage | null> {
    const summary = this.getWikiSummary(project, id)
    const absPath = this.pagePath(project, id)
    if (!summary || !absPath) return null
    const fresh = await this.cache.getContent(absPath)
    if (!fresh) return null
    return { summary, content: fresh.content, mtime: fresh.mtime, hash: fresh.hash }
  }

  /**
   * Optimistic-locked page write. The caller has already validated that the
   * new content keeps `id` and `kind`. On success the cache entry and
   * projection are refreshed in place.
   */
  async putWikiPage(
    project: string,
    id: string,
    content: string,
    expectedMtime: number,
    expectedHash: string,
  ): Promise<PutContentResult | PutContentConflict> {
    const absPath = this.pagePath(project, id)
    if (!absPath) return { ok: false, code: 'NOT_FOUND' }
    const result = await this.cache.putContent(absPath, content, expectedMtime, expectedHash)
    return result
  }

  /** Rebuild one project's in-memory projection after a cited artifact changed. */
  invalidate(project: string): void {
    const state = this.byName.get(project)
    if (!state) return
    if (this.warmed) this.rebuildProjection(state)
    else state.dirty = true
  }

  /** Rebuild every project's projection (Experiment / report set changed). */
  invalidateAll(): void {
    for (const state of this.states) {
      if (this.warmed) this.rebuildProjection(state)
      else state.dirty = true
    }
  }

  /** Instrumentation snapshot. */
  getStats(): WikiCacheStats {
    return { ...this.stats }
  }

  // --- internals ---------------------------------------------------------

  private stateForDir(dir: string): ProjectState | undefined {
    return this.states.find((state) => dir === state.wikiDir || dir.startsWith(`${state.wikiDir}/`))
  }

  private projectionFor(project: string): WikiProjectProjection | null {
    return this.byName.get(project)?.projection ?? null
  }

  /**
   * Recompute lint, staleness and backlinks from in-memory inputs.
   * This is called by warmup/Poller mutation paths; request getters only read
   * the resulting snapshot.
   */
  private rebuildProjection(state: ProjectState): void {
    const pages = this.cache
      .getAllList()
      .filter((page) => page.absolutePath.startsWith(`${state.wikiDir}/`))
      .sort((a, b) => a.path.localeCompare(b.path))
    const ctx = this.deps.context(state.project)
    state.projection = buildWikiProject(pages, ctx)
    state.dirty = false
    this.stats.projections += 1
  }

  /**
   * Build the discovered-page record for one page file. Runs on every scan
   * and every content change; a bundle additionally gets its asset listing
   * (needed for `entry` validation and the asset route's containment check).
   */
  private async readRecord(
    absPath: string,
    content: string,
    mtime: number,
  ): Promise<DiscoveredWikiPage> {
    const state = this.states.find((candidate) => absPath.startsWith(`${candidate.wikiDir}/`))
    if (!state) throw new Error(`wiki page outside every configured wiki dir: ${absPath}`)
    const relative = absPath.slice(state.wikiDir.length + 1)
    const segments = relative.split('/')
    const kind = segments[0]
    const name = segments[1]
    if (!kind || !name || segments.length > 3) {
      throw new Error(`unexpected wiki page path: ${absPath}`)
    }
    const bundle = segments.length === 3
    const pageName = bundle ? name : name.replace(/\.md$/, '')
    const match = WIKI_PAGE_NAME_REGEX.exec(pageName)
    if (!match) throw new Error(`unexpected wiki page name: ${absPath}`)
    const bundleDir = bundle ? join(state.wikiDir, kind, name) : null
    const assets = bundleDir ? await listBundleAssets(bundleDir) : []
    return {
      id: match[1]!,
      slug: match[2]!,
      kind,
      format: bundle ? 'bundle' : 'markdown',
      path: `${WIKI_DIR_RELPATH}/${relative}`,
      absolutePath: absPath,
      bundleDir,
      content,
      mtime,
      // The page's own README mtime. Attachment mtimes are not collected here;
      // see `listBundleAssets`.
      bundleMtime: mtime,
      assets,
    }
  }
}

/**
 * Depth-limited *name* listing of a bundle directory, mirroring core
 * discovery: bundle-relative POSIX paths (README.md included), symlinked
 * directories not followed.
 *
 * Names only, deliberately. Showing a page needs to know which bundle-relative
 * paths exist (component payload probes, `entry` validation, the asset route's
 * containment check) — it does not need each attachment's metadata, and one
 * `stat` per attachment turned opening a page into a burst of filesystem calls
 * against a possibly remote mount. Asset metadata is read by the asset route
 * when a byte range is actually served.
 */
async function listBundleAssets(bundleDir: string): Promise<string[]> {
  const assets: string[] = []
  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (depth > BUNDLE_ASSET_MAX_DEPTH || assets.length >= BUNDLE_ASSET_MAX_FILES) return
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (assets.length >= BUNDLE_ASSET_MAX_FILES) return
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), rel, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      assets.push(rel)
    }
  }
  await walk(bundleDir, '', 1)
  return assets.sort((a, b) => a.localeCompare(b))
}
