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
// `fs.watch`; the shared Poller drives every refresh.
//
// Two derived layers sit on top of the raw records:
//
//   1. The project projection (`buildWikiProject`): frontmatter, lint,
//      staleness, backlinks, canonical order. Pure CPU over in-memory state,
//      rebuilt by warmup/Poller/artifact-change paths so request getters only
//      read the current snapshot.
//   2. The review snapshot (`deriveWikiReview`): git blame / status / log.
//      Refreshed ONLY off the request path — after warmup, on a wiki change,
//      on a `.memon/wiki-review.csv` change, and on a HEAD (or branch ref)
//      change. `GET /api/wiki` and `GET /api/wiki/review` read the snapshot,
//      so no request ever spawns git.

import { type Dirent, promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import {
  buildWikiProject,
  deriveWikiReview,
  isGitWorktree,
  listWikiCommits,
  readWikiReviewMarks,
  verifiedThroughMark,
  WIKI_DIR_RELPATH,
  WIKI_PAGE_NAME_REGEX,
  WIKI_REVIEW_RELPATH,
  type DiscoveredWikiPage,
  type Poller,
  type WikiBacklink,
  type WikiCommit,
  type WikiProjectContext,
  type WikiProjectProjection,
  type WikiReview,
  type WikiReviewMark,
  type WikiSummary,
} from '@memon/core'
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

/** One wiki commit as `GET /api/wiki/review` serves it. */
export interface WikiReviewCommitRow {
  sha: string
  authoredAt: string
  subject: string
  pages: string[]
  verified: boolean
  verifiedAt: string | null
  note: string | null
}

export interface WikiReviewLog {
  verifiedThrough: string | null
  commits: WikiReviewCommitRow[]
}

/**
 * The git plumbing the review snapshot needs. Injectable so a test can prove
 * that no request path reaches it.
 */
export interface WikiCacheGit {
  isGitWorktree(projectRoot: string): Promise<boolean>
  listWikiCommits(projectRoot: string): Promise<WikiCommit[] | null>
  readWikiReviewMarks(projectRoot: string): Promise<WikiReviewMark[]>
  deriveWikiReview(
    projectRoot: string,
    pagePaths: string[],
    marks: WikiReviewMark[],
  ): Promise<Map<string, WikiReview> | null>
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
  /** Emitted after a review snapshot changed (SSE `wiki-review-change`). */
  onReviewChange: (project: string) => void
  /** Injectable git plumbing — the tests count invocations through these. */
  git?: WikiCacheGit
}

/** Cache counters. `git` proves the request path never spawns a subprocess. */
export interface WikiCacheStats {
  /** Projection rebuilds (pure CPU, no I/O). */
  projections: number
  /** Review snapshot refreshes — each one runs git. */
  reviewRefreshes: number
}

interface ProjectState {
  project: WikiCacheProject
  wikiDir: string
  /** Pre-warm invalidations must be applied by the initial projection build. */
  dirty: boolean
  projection: WikiProjectProjection | null
  /** Page path -> review; null outside a git worktree. */
  reviews: ReadonlyMap<string, WikiReview> | null
  commits: WikiCommit[] | null
  marks: WikiReviewMark[]
  /** Git paths currently registered with the Poller. */
  gitPaths: string[]
  /** In-flight review refresh, with a queued follow-up when re-requested. */
  refreshing: Promise<void> | null
  refreshQueued: boolean
}

export class WikiCache {
  private readonly cache: DirCache<DiscoveredWikiPage>
  private readonly states: ProjectState[]
  private readonly byName = new Map<string, ProjectState>()
  private readonly git: WikiCacheGit
  private readonly stats: WikiCacheStats = { projections: 0, reviewRefreshes: 0 }
  /** Suppresses change-driven review refreshes while the initial scan is incomplete. */
  private warmed = false

  constructor(private readonly deps: WikiCacheDeps) {
    this.git = deps.git ?? {
      isGitWorktree,
      listWikiCommits,
      readWikiReviewMarks,
      deriveWikiReview,
    }
    this.states = deps.projects.map((project) => ({
      project,
      wikiDir: join(project.root, ...WIKI_DIR_RELPATH.split('/')),
      dirty: true,
      projection: null,
      reviews: null,
      commits: null,
      marks: [],
      gitPaths: [],
      refreshing: null,
      refreshQueued: false,
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
        if (this.warmed) void this.refreshReview(state)
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
   * Initial scan of every project's wiki plus the first review derivation.
   * Runs before the first request lands (instrumentation.ts warmup).
   */
  async warmup(): Promise<void> {
    await this.cache.warmup()
    this.warmed = true
    await Promise.all(this.states.map((state) => this.refreshReview(state)))
  }

  /**
   * Register (or re-register) the git paths whose change invalidates the
   * review snapshot: the git dir's `HEAD`, the branch ref it points at, and
   * `.memon/wiki-review.csv`. Called at warmup and whenever HEAD moves, so a
   * branch switch starts watching the new ref.
   */
  async watchGitPaths(poller: Poller): Promise<void> {
    await Promise.all(this.states.map((state) => this.watchProjectGitPaths(state, poller)))
  }

  /**
   * Poller dispatch. Claims wiki directories, wiki page files, and the git
   * paths whose change re-derives review state.
   */
  handlePollChange(path: string, poller?: Poller): boolean {
    if (this.cache.handlePollChange(path, poller)) return true
    for (const state of this.states) {
      if (!state.gitPaths.includes(path)) continue
      void this.refreshReview(state).then(() => {
        if (poller) return this.watchProjectGitPaths(state, poller)
        return undefined
      })
      return true
    }
    return false
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
   * new content keeps `id` and `kind`. On success the cache entry, projection,
   * and review snapshot are refreshed in place (the working tree just went
   * dirty).
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

  /** Cached wiki-commit log; null when the project is not a git worktree. */
  getReviewLog(project: string): WikiReviewLog | null {
    const state = this.byName.get(project)
    if (!state || state.commits === null) return null
    const markBySha = new Map(state.marks.map((mark) => [mark.sha, mark]))
    return {
      verifiedThrough: verifiedThroughMark(state.commits, state.marks)?.sha ?? null,
      commits: state.commits.map((commit) => {
        const mark = markBySha.get(commit.sha)
        return {
          sha: commit.sha,
          authoredAt: commit.authoredAt,
          subject: commit.subject,
          pages: [...commit.pages],
          verified: mark !== undefined,
          verifiedAt: mark?.verifiedAt ?? null,
          note: mark?.note ?? null,
        }
      }),
    }
  }

  /** True when the project's review snapshot says it is a git worktree. */
  isGitProject(project: string): boolean {
    return this.byName.get(project)?.commits !== null
  }

  /** Re-derive review state (and the commit log) for one project. */
  async refreshProjectReview(project: string): Promise<void> {
    const state = this.byName.get(project)
    if (state) await this.refreshReview(state)
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

  /** Instrumentation snapshot. `reviewRefreshes` counts git invocations. */
  getStats(): WikiCacheStats {
    return { ...this.stats }
  }

  // --- internals ---------------------------------------------------------

  private stateForDir(dir: string): ProjectState | undefined {
    return this.states.find(
      (state) => dir === state.wikiDir || dir.startsWith(`${state.wikiDir}/`),
    )
  }

  private projectionFor(project: string): WikiProjectProjection | null {
    return this.byName.get(project)?.projection ?? null
  }

  /**
   * Recompute lint, staleness, backlinks, and review from in-memory inputs.
   * This is called by warmup/Poller mutation paths; request getters only read
   * the resulting snapshot.
   */
  private rebuildProjection(state: ProjectState): void {
    const pages = this.cache
      .getAllList()
      .filter((page) => page.absolutePath.startsWith(`${state.wikiDir}/`))
      .sort((a, b) => a.path.localeCompare(b.path))
    const ctx = this.deps.context(state.project)
    state.projection = buildWikiProject(pages, { ...ctx, reviews: state.reviews })
    state.dirty = false
    this.stats.projections += 1
  }

  /**
   * Derive `review` for every page of one project. Coalesces concurrent
   * requests: a refresh arriving while one is in flight queues exactly one
   * follow-up, so a burst of poll ticks cannot fan out into git storms.
   */
  private async refreshReview(state: ProjectState): Promise<void> {
    if (state.refreshing) {
      state.refreshQueued = true
      return state.refreshing
    }
    state.refreshing = this.runReviewRefresh(state).finally(() => {
      state.refreshing = null
      if (state.refreshQueued) {
        state.refreshQueued = false
        void this.refreshReview(state)
      }
    })
    return state.refreshing
  }

  private async runReviewRefresh(state: ProjectState): Promise<void> {
    this.stats.reviewRefreshes += 1
    const root = state.project.root
    try {
      if (!(await this.git.isGitWorktree(root))) {
        const changed = state.commits !== null || state.reviews !== null
        state.commits = null
        state.reviews = null
        state.marks = []
        this.rebuildProjection(state)
        if (changed) this.deps.onReviewChange(state.project.name)
        return
      }
      const [commits, marks] = await Promise.all([
        this.git.listWikiCommits(root),
        this.git.readWikiReviewMarks(root),
      ])
      const pagePaths = this.cache
        .getAllList()
        .filter((page) => page.absolutePath.startsWith(`${state.wikiDir}/`))
        .map((page) => page.path)
      const reviews = await this.git.deriveWikiReview(root, pagePaths, marks)
      state.commits = commits ?? []
      state.marks = marks
      state.reviews = reviews
      this.rebuildProjection(state)
      this.deps.onReviewChange(state.project.name)
    } catch {
      // Keep the previous snapshot; the next poll tick retries.
    }
  }

  private async watchProjectGitPaths(state: ProjectState, poller: Poller): Promise<void> {
    const next = await gitWatchPaths(state.project.root)
    for (const path of state.gitPaths) {
      if (!next.includes(path)) poller.unwatch(path)
    }
    for (const path of next) {
      poller.watch(path, await fileMtimeOrZero(path))
    }
    state.gitPaths = next
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
    const state = this.states.find((candidate) =>
      absPath.startsWith(`${candidate.wikiDir}/`),
    )
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
    const listing = bundleDir
      ? await listBundleAssets(bundleDir)
      : { assets: [] as string[], newestMtime: mtime }
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
      bundleMtime: Math.max(mtime, listing.newestMtime),
      assets: listing.assets,
    }
  }
}

/**
 * `HEAD`, the branch ref it names, and `.memon/wiki-review.csv`. A missing
 * path is still returned (and watched): the Poller reports its creation.
 */
export async function gitWatchPaths(projectRoot: string): Promise<string[]> {
  const paths = [join(projectRoot, ...WIKI_REVIEW_RELPATH.split('/'))]
  const gitDirs = await resolveGitDirs(projectRoot)
  if (!gitDirs) return paths
  const headPath = join(gitDirs.worktree, 'HEAD')
  paths.push(headPath)
  try {
    const head = await fs.readFile(headPath, 'utf8')
    const ref = /^ref:\s*(\S+)\s*$/m.exec(head)?.[1]
    // A packed ref has no loose file yet; watching the path is still right —
    // it appears the moment the branch advances. Linked worktrees keep refs
    // in the common git directory rather than beside their own HEAD.
    if (ref) paths.push(join(gitDirs.common, ...ref.split('/')))
  } catch {
    // Detached or unreadable HEAD: the HEAD watch alone is enough.
  }
  return paths
}

interface GitDirectories {
  worktree: string
  common: string
}

/**
 * Find the owning worktree's `.git` while walking ancestors. Configured
 * Project roots are commonly nested below a repository root, and linked
 * worktrees use a `gitdir:` file plus a separate `commondir`.
 */
async function resolveGitDirs(projectRoot: string): Promise<GitDirectories | null> {
  let directory = resolve(projectRoot)
  while (true) {
    const dotGit = join(directory, '.git')
    try {
      const stat = await fs.stat(dotGit)
      let worktree: string
      if (stat.isDirectory()) {
        worktree = dotGit
      } else {
        const pointer = await fs.readFile(dotGit, 'utf8')
        const target = /^gitdir:\s*(.+)\s*$/m.exec(pointer)?.[1]?.trim()
        if (!target) return null
        worktree = isAbsolute(target) ? target : resolve(directory, target)
      }
      let common = worktree
      try {
        const target = (await fs.readFile(join(worktree, 'commondir'), 'utf8')).trim()
        if (target) common = isAbsolute(target) ? target : resolve(worktree, target)
      } catch {
        // Ordinary worktrees use the worktree git directory as the common dir.
      }
      return { worktree, common }
    } catch (caught) {
      if ((caught as NodeJS.ErrnoException).code !== 'ENOENT') return null
    }
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

async function fileMtimeOrZero(path: string): Promise<number> {
  try {
    const stat = await fs.stat(path)
    return stat.mtimeMs
  } catch {
    return 0
  }
}

/** Bundle assets, bundle-relative, plus the newest mtime among them. */
export interface WikiBundleListing {
  assets: string[]
  newestMtime: number
}

/**
 * Depth-limited listing of a bundle directory, mirroring core discovery:
 * bundle-relative POSIX paths (README.md included), symlinked directories not
 * followed.
 */
async function listBundleAssets(bundleDir: string): Promise<WikiBundleListing> {
  const assets: string[] = []
  let newestMtime = 0
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
      const child = join(dir, entry.name)
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(child, rel, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      assets.push(rel)
      const mtime = await fileMtimeOrZero(child)
      if (mtime > newestMtime) newestMtime = mtime
    }
  }
  await walk(bundleDir, '', 1)
  assets.sort((a, b) => a.localeCompare(b))
  return { assets, newestMtime }
}
