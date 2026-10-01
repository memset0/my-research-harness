import { createHash } from 'node:crypto'
import { join, relative, resolve, sep } from 'node:path'
import {
  addJournalInvocationDetail,
  BackendCodeReviewPatchResponseSchema,
  BackendCodeReviewResponseSchema,
  BackendCodeReviewsResponseSchema,
  BackendDocumentConflictResponseSchema,
  BackendDocumentWriteResponseSchema,
  BackendReadmeResponseSchema,
  BackendReportResponseSchema,
  BackendReportsResponseSchema,
  BackendResourceInventoryResponseSchema,
  BackendWikiBacklinksSchema,
  type BackendWikiConflictResponse,
  BackendWikiConflictResponseSchema,
  BackendWikiDocumentSchema,
  BackendWikiInventoryResponseSchema,
  BackendWikiPagesResponseSchema,
  BackendWikiReviewResponseSchema,
  type BackendWikiWriteResponse,
  BackendWikiWriteResponseSchema,
  buildWikiProject,
  type CodeReviewCompletion,
  type CodeReviewFrontMatter,
  collectWikiSourceReferences,
  type DiscoveredWikiPage,
  deriveCompletion,
  deriveWikiReview,
  discoverRuns,
  type Experiment,
  effectiveWikiId,
  extractTitle,
  formatIsoLocal,
  projectFs as fs,
  listWikiCommits,
  markJournalInvocationOutcome,
  type ProjectConfig,
  parseCodeReview,
  parseWikiFrontmatter,
  ResourceIdSchema,
  type Run,
  readWikiReviewMarks,
  removeWikiReviewMark,
  serializeWikiPage,
  toggleCommitReviewed,
  toggleTodoDone,
  updateWikiFrontmatter,
  verifiedThroughMark,
  WIKI_ID_REGEX,
  WIKI_LEGACY_ID_REGEX,
  WIKI_REVIEW_RELPATH,
  type WikiCommit,
  type WikiProjectProjection,
  type WikiReview,
  WikiReviewError,
  type WikiReviewMark,
  type WikiReviewStoreOptions,
  type WikiSourceReferences,
  type WikiSummary,
  wikiStringList,
  withJournalInvocation,
  writeFileAtomic,
  writeWikiReviewMark,
} from '@memon/core'
import { PathContainmentError, resolveContained } from './containment.js'
import {
  BackendExecutionError,
  type BackendExecutionResolver,
  gitCommandRunnerFor,
  resolveProjectExecution,
} from './execution-service.js'
import {
  containedReal,
  indexedCodeReviewInventory,
  indexedReportInventory,
  indexedWikiPages,
} from './indexed-documents.js'
import { missingOrThrow } from './missing-path.js'
import { withAutomaticProjectFileContext } from './project-file-context.js'
import { FilesystemProjectService, type InventoryListOptions } from './project-service.js'
import {
  projectReadIndex,
  type ReadPolicy,
  registerProjectRoots,
  STRICT_READ_POLICY,
  statObservation,
} from './read-index.js'
import { RUN_INVENTORY_REFRESH_MS, RunInventory, type RunInventoryWalk } from './run-inventory.js'

export class BackendDocumentServiceError extends Error {
  constructor(
    public readonly code:
      | 'PROJECT_NOT_FOUND'
      | 'RESOURCE_NOT_FOUND'
      | 'INVALID_RESOURCE'
      | 'AMBIGUOUS_RESOURCE'
      /** The Project has no usable execution target for its git reads. */
      | 'EXECUTION_UNAVAILABLE',
    message: string,
  ) {
    super(message)
    this.name = 'BackendDocumentServiceError'
  }
}

export type BackendDocumentWriteResult =
  | ReturnType<typeof BackendDocumentWriteResponseSchema.parse>
  | ReturnType<typeof BackendDocumentConflictResponseSchema.parse>

export type BackendWikiWriteResult = BackendWikiWriteResponse | BackendWikiConflictResponse

export interface BackendDocumentService {
  listReports(project: string, options?: InventoryListOptions): Promise<unknown>
  getReport(project: string, id: string): Promise<unknown>
  putReport(
    project: string,
    id: string,
    input: DocumentWriteInput,
  ): Promise<BackendDocumentWriteResult>
  listCodeReviews(project: string, options?: InventoryListOptions): Promise<unknown>
  getCodeReview(project: string, id: string): Promise<unknown>
  patchCodeReview(project: string, id: string, input: CodeReviewPatchInput): Promise<unknown>
  getReadme(project: string, resource: string): Promise<unknown>
  putReadme(
    project: string,
    resource: string,
    input: DocumentWriteInput,
  ): Promise<BackendDocumentWriteResult>
  listWiki(project: string, options?: { inventoryOnly?: boolean }): Promise<unknown>
  getWiki(project: string, id: string): Promise<unknown>
  putWiki(project: string, id: string, input: DocumentWriteInput): Promise<BackendWikiWriteResult>
  wikiBacklinks(project: string, artifact: string): Promise<unknown>
  wikiReviewLog(project: string): Promise<unknown>
  markWikiReview(project: string, sha: string, note?: string): Promise<unknown>
  unmarkWikiReview(project: string, sha: string): Promise<unknown>
}

export interface DocumentWriteInput {
  content: string
  expectedMtime: number
  expectedHash: string
}

export type CodeReviewPatchInput =
  | { op: 'commit'; sha: string; reviewed: boolean; expectedMtime: number; expectedHash: string }
  | { op: 'todo'; index: number; done: boolean; expectedMtime: number; expectedHash: string }

interface DocumentEntry {
  id: string
  absolutePath: string
  resource: string
  title: string | null
  mtime: number
  kind: 'report' | 'code-review' | 'readme'
  format?: 'markdown' | 'bundle'
  slug?: string
  date?: string
  codeReview?: {
    scope: 'project' | 'experiment'
    experiment: string | null
    frontmatter: CodeReviewFrontMatter
    body: string
    completion: CodeReviewCompletion
  }
}

/**
 * Project artifacts a wiki page's `sources` are resolved against.
 *
 * Identity and metadata are separate on purpose: the id lists come from
 * directory entries and cover the whole project, while `experiments` / `runs`
 * carry loaded metadata for the cited targets only. A page that cites two Runs
 * costs two Run README reads, not one per Run in the project.
 */
export interface BackendWikiArtifacts {
  /** Loaded metadata for the cited Experiments. */
  experiments: readonly Experiment[]
  /** Loaded metadata for the cited Runs and cited Experiments' members. */
  runs: readonly Run[]
  /** Every Experiment id under `docs/experiments/`. */
  experimentIds: readonly string[]
  /** Every Run directory name the discovery walk found. */
  runIds: readonly string[]
  /** `docs/hypotheses.md` mtime in epoch ms; null when the file is absent. */
  hypothesesMtime: number | null
  hypothesisIds: readonly string[]
}

/** What the wiki's declared sources ask the artifact provider to load. */
export type BackendWikiArtifactReferences = WikiSourceReferences

export interface BackendWikiArtifactOptions {
  /**
   * Every Run directory of the Project, as `discoverRuns` with archived Runs
   * would return it. Omitted, the provider walks the Run roots itself.
   */
  runPaths?: () => Promise<readonly string[]>
  /** Summary-index windows of the requesting service. */
  readPolicy?: ReadPolicy
}

export type BackendWikiArtifactProvider = (
  project: ProjectConfig,
  references: BackendWikiArtifactReferences,
  options?: BackendWikiArtifactOptions,
) => Promise<BackendWikiArtifacts>

export interface FilesystemDocumentServiceOptions {
  /** Override for the on-demand artifact reads behind wiki source resolution. */
  wikiArtifacts?: BackendWikiArtifactProvider
  /**
   * Resolves where a Project's wiki git reads run — the same seam the git
   * capability uses, so review history comes from the machine that owns the
   * working copy. Defaults to the Project's own `execution` configuration; a
   * Project without one has no readable review state rather than a local
   * `git` run against a mounted copy that belongs to another machine.
   */
  execution?: BackendExecutionResolver
  /** Override for the Run-directory walk behind the shared wiki Run inventory. */
  runWalk?: RunInventoryWalk
  /** Summary-index validation windows; strict (validate every read) by default. */
  readPolicy?: ReadPolicy
}

/** Read the cited artifacts' metadata without unrelated archive-policy reads. */
export async function scanBackendWikiArtifacts(
  project: ProjectConfig,
  references: BackendWikiArtifactReferences,
  options: BackendWikiArtifactOptions = {},
): Promise<BackendWikiArtifacts> {
  return new FilesystemProjectService(
    [project],
    options.readPolicy ? { readPolicy: options.readPolicy } : {},
  ).readWikiArtifacts(project.name, references, options)
}

export class FilesystemDocumentService implements BackendDocumentService {
  private readonly projects = new Map<string, ProjectConfig>()

  private readonly wikiArtifacts: BackendWikiArtifactProvider

  private readonly resolveExecution: BackendExecutionResolver

  /** One Run-directory walk shared by every wiki projection of a Project. */
  private readonly runInventory: RunInventory | null

  private readonly policy: ReadPolicy

  constructor(projects: readonly ProjectConfig[], options: FilesystemDocumentServiceOptions = {}) {
    for (const project of projects) {
      if (this.projects.has(project.name)) throw new Error(`duplicate Project ${project.name}`)
      this.projects.set(project.name, project)
    }
    registerProjectRoots(projects)
    this.policy = options.readPolicy ?? STRICT_READ_POLICY
    this.wikiArtifacts = options.wikiArtifacts ?? scanBackendWikiArtifacts
    this.resolveExecution = options.execution ?? resolveProjectExecution
    // An injected walk keeps its own inventory; otherwise every projection
    // shares the Project summary index's walk.
    this.runInventory = options.runWalk
      ? new RunInventory(options.runWalk, {
          refreshMs: Math.max(this.policy.walkRefreshMs, RUN_INVENTORY_REFRESH_MS),
        })
      : null
  }

  async listReports(projectName: string, options: InventoryListOptions = {}) {
    const project = this.requireProject(projectName)
    if (options.inventoryOnly) {
      return BackendResourceInventoryResponseSchema.parse({
        items: await withAutomaticProjectFileContext(() =>
          indexedReportInventory(project, this.policy),
        ),
      })
    }
    const reports = await this.discoverReports(project)
    return BackendReportsResponseSchema.parse({
      reports: reports.map((entry) => reportSummary(project, entry)),
    })
  }

  async getReport(projectName: string, id: string) {
    const project = this.requireProject(projectName)
    const reports = await withAutomaticProjectFileContext(() => this.discoverReports(project))
    const entry = exactEntry(reports, id)
    return BackendReportResponseSchema.parse({
      ...reportSummary(project, entry),
      ...(await this.read(project, entry)),
    })
  }

  async putReport(projectName: string, id: string, input: DocumentWriteInput) {
    const project = this.requireProject(projectName)
    return this.record(project, 'report write', { report: id }, async () => {
      const entry = exactEntry(await this.discoverReports(project), id)
      addJournalInvocationDetail({ kind: 'target', type: 'project', id: project.name })
      return this.write(project, entry, input)
    })
  }

  async listCodeReviews(projectName: string, options: InventoryListOptions = {}) {
    const project = this.requireProject(projectName)
    if (options.inventoryOnly) {
      return BackendResourceInventoryResponseSchema.parse({
        items: await withAutomaticProjectFileContext(() =>
          indexedCodeReviewInventory(project, this.policy),
        ),
      })
    }
    const reviews = await this.discoverCodeReviews(project)
    return BackendCodeReviewsResponseSchema.parse({
      codeReviews: reviews.map((entry) => codeReviewSummary(project, entry)),
    })
  }

  async getCodeReview(projectName: string, id: string) {
    const project = this.requireProject(projectName)
    const reviews = await withAutomaticProjectFileContext(() => this.discoverCodeReviews(project))
    const entry = exactEntry(reviews, id)
    const raw = await this.read(project, entry)
    const parsed = parseCodeReview(raw.content)
    const metadata = codeReviewMetadata(entry.id, parsed.frontmatter, parsed.body)
    return BackendCodeReviewResponseSchema.parse({
      id: entry.id,
      project: project.name,
      resource: entry.resource,
      mtime: raw.mtime,
      hash: raw.hash,
      ...metadata,
    })
  }

  async patchCodeReview(projectName: string, id: string, input: CodeReviewPatchInput) {
    const project = this.requireProject(projectName)
    return this.record(
      project,
      `code-review ${input.op} set`,
      {
        codeReview: id,
        op: input.op,
        ...(input.op === 'commit'
          ? { sha: input.sha, reviewed: input.reviewed }
          : { index: input.index, done: input.done }),
      },
      async () => {
        const entry = exactEntry(await this.discoverCodeReviews(project), id)
        const current = await this.read(project, entry)
        if (current.mtime !== input.expectedMtime || current.hash !== input.expectedHash) {
          markJournalInvocationOutcome('conflict', 'DOCUMENT_CHANGED')
          return BackendDocumentConflictResponseSchema.parse({
            error: { code: 'CONFLICT', message: 'on-disk document changed' },
            currentMtime: current.mtime,
            currentHash: current.hash,
          })
        }
        const now = formatIsoLocal(new Date())
        const next =
          input.op === 'commit'
            ? toggleCommitReviewed(current.content, input.sha, input.reviewed, now)
            : toggleTodoDone(current.content, input.index, input.done, now)
        if (next === null)
          throw new BackendDocumentServiceError('INVALID_RESOURCE', 'Invalid patch')
        const result = await this.write(project, entry, { ...input, content: next })
        const conflict = BackendDocumentConflictResponseSchema.safeParse(result)
        if (conflict.success) return conflict.data
        return BackendCodeReviewPatchResponseSchema.parse({
          ...result,
          completion: deriveCompletion(parseCodeReview(next).frontmatter),
        })
      },
    )
  }

  async getReadme(projectName: string, resource: string) {
    const project = this.requireProject(projectName)
    const entry = await this.readmeEntry(project, resource)
    return BackendReadmeResponseSchema.parse({
      resource: entry.id,
      project: project.name,
      ...(await this.read(project, entry)),
    })
  }

  async putReadme(projectName: string, resource: string, input: DocumentWriteInput) {
    const project = this.requireProject(projectName)
    return this.record(project, 'readme write', { resource }, async () =>
      this.write(project, await this.readmeEntry(project, resource), input),
    )
  }

  /**
   * Project-wide wiki projection: discovery, source resolution, lint, and
   * derived review. Component blocks stay opaque here — the central dashboard
   * owns the registry, so no `WIKI_COMPONENT_*` diagnostic beyond the
   * structural unpinned check is produced.
   */
  async discoverWiki(projectName: string): Promise<WikiProjectProjection> {
    return this.wikiProjection(this.requireProject(projectName))
  }

  async listWiki(projectName: string, options: { inventoryOnly?: boolean } = {}) {
    const project = this.requireProject(projectName)
    if (options.inventoryOnly) {
      const pages = await withAutomaticProjectFileContext(() =>
        indexedWikiPages(project, this.policy, { assets: false }),
      )
      return BackendWikiInventoryResponseSchema.parse({
        pages: pages.map((page) => {
          const { frontmatter } = parseWikiFrontmatter(page.content)
          const legacyId = frontmatter?.legacy_id
          return {
            id: effectiveWikiId(page.id, frontmatter),
            resource: ResourceIdSchema.parse(page.path),
            legacyId:
              typeof legacyId === 'string' && WIKI_LEGACY_ID_REGEX.test(legacyId) ? legacyId : null,
          }
        }),
      })
    }
    const projection = await this.wikiProjection(project)
    return BackendWikiPagesResponseSchema.parse({
      pages: projection.summaries.map((summary) => wikiSummary(project, summary)),
    })
  }

  async getWiki(projectName: string, id: string) {
    const project = this.requireProject(projectName)
    const summary = await withAutomaticProjectFileContext(() => this.wikiPageSummary(project, id))
    return BackendWikiDocumentSchema.parse(await this.readWikiPage(project, summary))
  }

  async putWiki(
    projectName: string,
    id: string,
    input: DocumentWriteInput,
  ): Promise<BackendWikiWriteResult> {
    const project = this.requireProject(projectName)
    return this.record(project, 'wiki write', { wiki: id }, async () => {
      const summary = await this.wikiPageSummary(project, id)
      addJournalInvocationDetail({ kind: 'target', type: 'wiki', id })
      const absolutePath = wikiAbsolutePath(project, summary)
      await assertWithin(project.root, absolutePath)
      const [current, stat] = await Promise.all([
        fs.readFile(absolutePath, 'utf8'),
        fs.stat(absolutePath),
      ])
      const currentHash = sha1(current)
      if (stat.mtimeMs !== input.expectedMtime || currentHash !== input.expectedHash) {
        markJournalInvocationOutcome('conflict', 'DOCUMENT_CHANGED')
        return BackendWikiConflictResponseSchema.parse({
          error: { code: 'CONFLICT', message: 'on-disk wiki page changed' },
          currentMtime: stat.mtimeMs,
          currentHash,
          currentContent: current,
        })
      }
      const content = nextWikiContent(input.content, current, summary)
      await writeFileAtomic(absolutePath, content, { mode: stat.mode })
      addJournalInvocationDetail({
        kind: 'file-change',
        path: relative(project.root, absolutePath).split(sep).join('/'),
        before: currentHash,
        after: sha1(content),
      })
      // Re-project so the response carries the staleness, diagnostics, and
      // review state the write just produced.
      const next = await this.wikiPageSummary(project, id)
      const page = BackendWikiDocumentSchema.parse(await this.readWikiPage(project, next))
      return BackendWikiWriteResponseSchema.parse({
        ok: true,
        mtime: page.mtime,
        hash: page.hash,
        page,
      })
    })
  }

  async wikiBacklinks(projectName: string, artifact: string) {
    const project = this.requireProject(projectName)
    const projection = await this.wikiProjection(project)
    return BackendWikiBacklinksSchema.parse(projection.backlinks.get(artifact) ?? [])
  }

  async wikiReviewLog(projectName: string) {
    const project = this.requireProject(projectName)
    return this.wikiReviewResponse(project, this.wikiGitOptions(project))
  }

  async markWikiReview(projectName: string, sha: string, note?: string) {
    const project = this.requireProject(projectName)
    // The reviewed-commit marker lives in `.memon/`, not in a document, so the
    // receipt records the commit identity only — never the reviewer's note.
    return this.record(project, 'wiki review mark', { sha }, async () => {
      const options = this.wikiGitOptions(project)
      await writeWikiReviewMark(project.root, sha, note, options)
      return this.wikiReviewResponse(project, options)
    })
  }

  async unmarkWikiReview(projectName: string, sha: string) {
    const project = this.requireProject(projectName)
    return this.record(project, 'wiki review unmark', { sha }, async () => {
      const options = this.wikiGitOptions(project)
      await removeWikiReviewMark(project.root, sha, options)
      return this.wikiReviewResponse(project, options)
    })
  }

  private async wikiReviewResponse(project: ProjectConfig, options: WikiReviewStoreOptions) {
    // An explicit review request answers with git's state or with a failure:
    // an unreachable target must never look like an unverified-but-known log.
    const commits = await listWikiCommits(project.root, options)
    if (commits === null) {
      throw new BackendDocumentServiceError('RESOURCE_NOT_FOUND', 'Project is not a git worktree')
    }
    const marks = await readWikiReviewMarks(project.root)
    return BackendWikiReviewResponseSchema.parse(wikiReviewProjection(commits, marks))
  }

  /**
   * Git command seam for this Project's wiki review reads and writes.
   * `{ exec: undefined }` means core runs git itself, which is correct only
   * for a Project that declares local execution.
   */
  private wikiGitOptions(project: ProjectConfig): WikiReviewStoreOptions {
    try {
      return { exec: gitCommandRunnerFor(this.resolveExecution(project)) }
    } catch (error) {
      if (error instanceof BackendExecutionError) {
        throw new BackendDocumentServiceError('EXECUTION_UNAVAILABLE', error.message)
      }
      throw error
    }
  }

  /**
   * Derived review for the projection, or `null` — reported as
   * `review: null`, "not checked" — when this Project's git state cannot be
   * read at all: no execution target, or a target that failed to answer.
   *
   * Neither failure may reach the client as a review: a page with no history
   * to compare against is not a verified page, and a wiki whose git is
   * unreachable is still worth reading.
   */
  private async wikiReviews(
    project: ProjectConfig,
    pagePaths: string[],
    marks: WikiReviewMark[],
  ): Promise<Map<string, WikiReview> | null> {
    try {
      return await deriveWikiReview(project.root, pagePaths, marks, this.wikiGitOptions(project))
    } catch (error) {
      if (
        (error instanceof BackendDocumentServiceError && error.code === 'EXECUTION_UNAVAILABLE') ||
        (error instanceof WikiReviewError && error.code === 'GIT_UNAVAILABLE')
      ) {
        return null
      }
      throw error
    }
  }

  /**
   * The Project-wide wiki projection: the pages themselves, plus exactly the
   * artifact facts their `sources` and `@` references need. Metadata is loaded
   * for cited targets only; existence of everything else comes from directory
   * entries, so listing a wiki never costs a Run or Report body.
   */
  private async wikiProjection(project: ProjectConfig): Promise<WikiProjectProjection> {
    const pages = await indexedWikiPages(project, this.policy, { assets: true })
    return this.projectWiki(project, pages, pages)
  }

  /**
   * One page's summary, projected with the same lint and identity inventories
   * as the list but with evidence loaded for this page's own citations only:
   * opening a page must not cost every other page's evidence. Only the
   * requested summary leaves this method — the sibling summaries in the
   * underlying projection were built without their sources and would
   * understate staleness.
   */
  private async wikiPageSummary(project: ProjectConfig, id: string): Promise<WikiSummary> {
    if (!WIKI_ID_REGEX.test(id)) {
      throw new BackendDocumentServiceError('INVALID_RESOURCE', 'Wiki id must match W<NNNN>')
    }
    const pages = await indexedWikiPages(project, this.policy, { assets: true })
    const cited = pages.filter(
      (page) => effectiveWikiId(page.id, parseWikiFrontmatter(page.content).frontmatter) === id,
    )
    return requireWikiPage(await this.projectWiki(project, pages, cited), id)
  }

  /**
   * Shared projection body. `cited` selects whose declared sources are
   * resolved against loaded metadata; every page is still parsed, linted and
   * ordered, and identity inventories always cover the whole Project.
   */
  private async projectWiki(
    project: ProjectConfig,
    pages: readonly DiscoveredWikiPage[],
    cited: readonly DiscoveredWikiPage[],
  ): Promise<WikiProjectProjection> {
    // An empty wiki must not cost a Project scan or a git invocation.
    if (pages.length === 0) {
      return buildWikiProject([], { experiments: [], runs: [], hypothesesMtime: null })
    }
    const references = collectWikiSourceReferences(
      cited.flatMap((page) =>
        wikiStringList(parseWikiFrontmatter(page.content).frontmatter?.sources),
      ),
    )
    const [artifacts, reportIds, marks] = await Promise.all([
      this.wikiArtifacts(project, references, {
        runPaths: () => this.wikiRunPaths(project),
        readPolicy: this.policy,
      }),
      this.listReportIds(project),
      this.indexedReviewMarks(project),
    ])
    // A single-page projection keeps only the cited summary, so only its
    // review is derived: git blame per page is the other per-page cost.
    const reviews = await this.wikiReviews(
      project,
      (cited === pages ? pages : cited).map((page) => page.path),
      marks,
    )
    return buildWikiProject(pages, {
      experiments: artifacts.experiments,
      runs: artifacts.runs,
      experimentIds: artifacts.experimentIds,
      runIds: artifacts.runIds,
      hypothesesMtime: artifacts.hypothesesMtime,
      hypothesisIds: artifacts.hypothesisIds,
      reportIds,
      reviews,
    })
  }

  /** Every Run directory for `@` resolution; at least the wiki's 15 s reuse. */
  private wikiRunPaths(project: ProjectConfig): Promise<readonly string[]> {
    if (this.runInventory) return this.runInventory.get(project.name)
    return withAutomaticProjectFileContext(() =>
      projectReadIndex(project.root).walk(
        project,
        Math.max(this.policy.walkRefreshMs, RUN_INVENTORY_REFRESH_MS),
        (target) => discoverRuns(target, { includeArchived: true }),
      ),
    )
  }

  /** Review marks, re-read only when the marks file's fingerprint changed. */
  private async indexedReviewMarks(project: ProjectConfig): Promise<WikiReviewMark[]> {
    const marks = await projectReadIndex(project.root).observe(
      `wiki-review-marks:${project.root}`,
      this.policy.listMaxAgeMs,
      () => statObservation(join(project.root, WIKI_REVIEW_RELPATH)),
      () => readWikiReviewMarks(project.root),
    )
    return marks ?? []
  }

  private async readWikiPage(project: ProjectConfig, summary: WikiSummary) {
    const absolutePath = wikiAbsolutePath(project, summary)
    await assertWithin(project.root, absolutePath)
    const [content, stat] = await Promise.all([
      fs.readFile(absolutePath, 'utf8'),
      fs.stat(absolutePath),
    ])
    return {
      ...wikiSummary(project, summary),
      mtime: stat.mtimeMs,
      hash: sha1(content),
      content,
    }
  }

  private requireProject(name: string): ProjectConfig {
    const project = this.projects.get(name)
    if (!project) throw new BackendDocumentServiceError('PROJECT_NOT_FOUND', 'Project not found')
    return project
  }

  private async readmeEntry(project: ProjectConfig, resource: string): Promise<DocumentEntry> {
    const id = ResourceIdSchema.safeParse(resource)
    if (!id.success) throw new BackendDocumentServiceError('INVALID_RESOURCE', 'Invalid resource')
    const legacyExperiment = /^docs\/experiments\/E\d{4}-[a-z0-9-]+\.md$/.test(id.data)
    if (id.data !== 'README.md' && !id.data.endsWith('/README.md') && !legacyExperiment) {
      throw new BackendDocumentServiceError('INVALID_RESOURCE', 'Resource is not a README')
    }
    const absolutePath = resolve(project.root, resource)
    await assertWithin(project.root, absolutePath)
    const stat = await missingOrThrow(fs.stat(absolutePath))
    if (!stat?.isFile()) throw notFound()
    return {
      id: id.data,
      absolutePath,
      resource: id.data,
      title: null,
      mtime: stat.mtimeMs,
      kind: 'readme',
    }
  }

  private async read(project: ProjectConfig, entry: DocumentEntry) {
    await assertWithin(project.root, entry.absolutePath)
    const [content, stat] = await Promise.all([
      fs.readFile(entry.absolutePath, 'utf8'),
      fs.stat(entry.absolutePath),
    ])
    return {
      mtime: stat.mtimeMs,
      hash: sha1(content),
      content,
    }
  }

  /**
   * Shared managed-document write. It runs inside the caller's ledger
   * invocation and reports what actually happened through the ambient
   * invocation: a stale optimistic lock is a `conflict` receipt, a completed
   * write contributes its typed file change.
   */
  private async write(project: ProjectConfig, entry: DocumentEntry, input: DocumentWriteInput) {
    const current = await this.read(project, entry)
    if (current.mtime !== input.expectedMtime || current.hash !== input.expectedHash) {
      markJournalInvocationOutcome('conflict', 'DOCUMENT_CHANGED')
      return BackendDocumentConflictResponseSchema.parse({
        error: { code: 'CONFLICT', message: 'on-disk document changed' },
        currentMtime: current.mtime,
        currentHash: current.hash,
      })
    }
    const original = await fs.stat(entry.absolutePath)
    await writeFileAtomic(entry.absolutePath, input.content, { mode: original.mode })
    const stat = await fs.stat(entry.absolutePath)
    addJournalInvocationDetail({
      kind: 'file-change',
      path: entry.resource,
      before: current.hash,
      after: sha1(input.content),
    })
    return BackendDocumentWriteResponseSchema.parse({
      ok: true,
      mtime: stat.mtimeMs,
      hash: sha1(input.content),
    })
  }

  /**
   * The invocation-ledger boundary for document writes. One receipt per
   * service invocation — including the ones that conflict or fail — with
   * identities and enums as parameters, never document bodies.
   */
  private record<T>(
    project: ProjectConfig,
    command: string,
    parameters: Record<string, unknown>,
    action: () => Promise<T>,
  ): Promise<T> {
    // One request, one receipt: never absorbed into an outer long-lived scope.
    return withJournalInvocation(project.root, { command, origin: 'web', parameters }, action, {
      standalone: true,
    })
  }

  /**
   * Report ids only, for `@R<NNNN>` reference resolution. Canonically named
   * files and bundle directories provide identities without opening them;
   * the detail reader validates the selected document when requested.
   */
  private async listReportIds(project: ProjectConfig): Promise<string[]> {
    return (await indexedReportInventory(project, this.policy)).map((item) => item.id)
  }

  /**
   * Reports from the indexed inventory: each document's title is parsed once
   * per fingerprint and its path must stay inside the Project.
   */
  private async discoverReports(project: ProjectConfig): Promise<DocumentEntry[]> {
    const age = this.policy.listMaxAgeMs
    const items = await indexedReportInventory(project, this.policy)
    const entries = await Promise.all(
      items.map(async (item): Promise<DocumentEntry | null> => {
        const absolutePath = join(project.root, ...item.resource.split('/'))
        if ((await containedReal(project, this.policy, absolutePath)) === null) return null
        const summary = await projectReadIndex(project.root).file(
          absolutePath,
          'report-title',
          age,
          (content, stat) =>
            stat.isFile() ? { title: extractTitle(content), mtime: stat.mtimeMs } : null,
        )
        if (!summary) return null
        return {
          id: item.id,
          absolutePath,
          resource: item.resource,
          title: summary.title,
          mtime: summary.mtime,
          kind: 'report',
          format: item.resource.endsWith('/README.md') ? 'bundle' : 'markdown',
          slug: item.slug,
        }
      }),
    )
    return entries
      .filter((entry): entry is DocumentEntry => entry !== null)
      .sort((a, b) => b.id.localeCompare(a.id))
  }

  /**
   * Code reviews from the indexed inventory, each parsed once per fingerprint.
   * An unparseable review is skipped, as before.
   */
  private async discoverCodeReviews(project: ProjectConfig): Promise<DocumentEntry[]> {
    const age = this.policy.listMaxAgeMs
    const items = await indexedCodeReviewInventory(project, this.policy)
    const entries = await Promise.all(
      items.map(async (item): Promise<DocumentEntry | null> => {
        const absolutePath = join(project.root, ...item.resource.split('/'))
        if ((await containedReal(project, this.policy, absolutePath)) === null) return null
        const parsed = await projectReadIndex(project.root).file(
          absolutePath,
          'code-review',
          age,
          (content, stat) => {
            if (!stat.isFile()) return null
            try {
              const review = parseCodeReview(content)
              return {
                title: review.frontmatter.title || null,
                mtime: stat.mtimeMs,
                metadata: codeReviewMetadata(item.id, review.frontmatter, review.body),
              }
            } catch {
              return null
            }
          },
        )
        if (!parsed) return null
        return {
          id: item.id,
          absolutePath,
          resource: item.resource,
          title: parsed.title,
          mtime: parsed.mtime,
          kind: 'code-review',
          codeReview: parsed.metadata,
        }
      }),
    )
    return entries
      .filter((entry): entry is DocumentEntry => entry !== null)
      .sort((a, b) => b.id.localeCompare(a.id))
  }
}

/**
 * Backend list/detail envelope: the core projection minus its project-local
 * `path`, which crosses the boundary as the opaque `resource`.
 */
function wikiSummary(project: ProjectConfig, summary: WikiSummary) {
  const { path, ...rest } = summary
  return { ...rest, project: project.name, resource: path }
}

function requireWikiPage(projection: WikiProjectProjection, id: string): WikiSummary {
  if (!WIKI_ID_REGEX.test(id)) {
    throw new BackendDocumentServiceError('INVALID_RESOURCE', 'Wiki id must match W<NNNN>')
  }
  const summary = projection.byId.get(id)
  if (!summary) throw new BackendDocumentServiceError('RESOURCE_NOT_FOUND', 'Wiki page not found')
  return summary
}

function wikiAbsolutePath(project: ProjectConfig, summary: WikiSummary): string {
  return join(project.root, ...summary.path.split('/'))
}

/**
 * Validate an incoming page against the one on disk and stamp `updated_at`.
 * Identity (`id`, `kind`) moves only through `memon wiki move`, and the
 * deprecated per-page review columns are never client-writable.
 */
function nextWikiContent(content: string, current: string, summary: WikiSummary): string {
  const next = parseWikiFrontmatter(content)
  if (!next.frontmatter) {
    throw new BackendDocumentServiceError(
      'INVALID_RESOURCE',
      'Wiki page frontmatter is missing or unreadable',
    )
  }
  const previous = parseWikiFrontmatter(current).frontmatter
  const previousId = typeof previous?.id === 'string' ? previous.id : summary.id
  const previousKind = typeof previous?.kind === 'string' ? previous.kind : summary.kind
  if (next.frontmatter.id !== previousId || next.frontmatter.kind !== previousKind) {
    throw new BackendDocumentServiceError(
      'INVALID_RESOURCE',
      'Wiki page identity changes only through a move',
    )
  }
  for (const key of ['reviewed_at', 'reviewed_hash'] as const) {
    if (next.frontmatter[key] !== previous?.[key]) {
      throw new BackendDocumentServiceError(
        'INVALID_RESOURCE',
        `Wiki page write must not change ${key}`,
      )
    }
  }
  return serializeWikiPage(
    updateWikiFrontmatter(next.frontmatter, { updated_at: formatIsoLocal(new Date()) }),
    next.body,
  )
}

function wikiReviewProjection(commits: WikiCommit[], marks: WikiReviewMark[]) {
  const marksBySha = new Map(marks.map((mark) => [mark.sha, mark]))
  return {
    verifiedThrough: verifiedThroughMark(commits, marks)?.sha ?? null,
    commits: commits.map((commit) => {
      const mark = marksBySha.get(commit.sha)
      return {
        sha: commit.sha,
        authoredAt: commit.authoredAt,
        subject: commit.subject,
        pages: commit.pages,
        verified: mark !== undefined,
        ...(mark ? { verifiedAt: mark.verifiedAt } : {}),
        ...(mark?.note ? { note: mark.note } : {}),
      }
    }),
  }
}

function reportSummary(project: ProjectConfig, entry: DocumentEntry) {
  if (entry.kind !== 'report' || !entry.slug || !entry.format) {
    throw new BackendDocumentServiceError('INVALID_RESOURCE', 'Invalid report metadata')
  }
  return {
    id: entry.id,
    project: project.name,
    resource: entry.resource,
    slug: entry.slug,
    title: entry.title,
    mtime: entry.mtime,
    format: entry.format,
  }
}

function codeReviewMetadata(id: string, frontmatter: CodeReviewFrontMatter, body: string) {
  const experimentMatch = /^experiments\/(E\d{4}-[a-z0-9-]+)\/code-review\//.exec(id)
  return {
    scope: experimentMatch ? ('experiment' as const) : ('project' as const),
    experiment: frontmatter.experiment ?? experimentMatch?.[1] ?? null,
    title: frontmatter.title,
    date: id.split('/').at(-1)?.slice(0, 10) ?? '',
    createdAt: frontmatter.createdAt,
    updatedAt: frontmatter.updatedAt,
    completion: deriveCompletion(frontmatter),
    frontmatter,
    body,
  }
}

function codeReviewSummary(project: ProjectConfig, entry: DocumentEntry) {
  if (entry.kind !== 'code-review' || !entry.codeReview) {
    throw new BackendDocumentServiceError('INVALID_RESOURCE', 'Invalid code-review metadata')
  }
  const { frontmatter: _frontmatter, body: _body, ...metadata } = entry.codeReview
  return {
    id: entry.id,
    project: project.name,
    resource: entry.resource,
    mtime: entry.mtime,
    ...metadata,
  }
}

async function assertWithin(projectRoot: string, target: string): Promise<void> {
  try {
    await resolveContained(projectRoot, target)
  } catch (error) {
    if (error instanceof PathContainmentError) {
      throw new BackendDocumentServiceError('INVALID_RESOURCE', 'Resource escapes Project')
    }
    throw error
  }
}

/**
 * Containment check for discovery, where a path that vanished between listing
 * and resolution is simply skipped. An unreadable path is not skipped: only
 * absence yields `false`, everything else propagates.
 */
async function _existsWithin(projectRoot: string, target: string): Promise<boolean> {
  try {
    return (await resolveContained(projectRoot, target, { allowMissing: true })) !== null
  } catch (error) {
    if (error instanceof PathContainmentError) return false
    throw error
  }
}

function notFound(): BackendDocumentServiceError {
  return new BackendDocumentServiceError('RESOURCE_NOT_FOUND', 'Document not found')
}

function exactEntry(entries: readonly DocumentEntry[], id: string): DocumentEntry {
  const matches = entries.filter((entry) => entry.id === id)
  if (matches.length === 0) throw notFound()
  if (matches.length > 1) {
    throw new BackendDocumentServiceError(
      'AMBIGUOUS_RESOURCE',
      'Document identifier is ambiguous within Project',
    )
  }
  return matches[0]!
}

function sha1(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}
