import { createHash } from 'node:crypto'
import {
  addJournalInvocationDetail,
  assertExperimentReadmeWritable,
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
  type BackendWikiWriteResponse,
  BackendWikiWriteResponseSchema,
  buildWikiProject,
  buildWikiSummary,
  type CodeReviewCompletion,
  type CodeReviewFrontMatter,
  type ContentFields,
  changedByteSpan,
  collectWikiSourceReferences,
  type DiscoveredWikiPage,
  DocumentTitleError,
  deriveCompletion,
  discoverRuns,
  EXPERIMENT_REF_REGEX,
  type Experiment,
  effectiveWikiId,
  extractTitle,
  formatIsoLocal,
  projectFs as fs,
  type IndexRole,
  type MutationFs,
  markJournalInvocationOutcome,
  normalizeDocumentTitle,
  type ProjectConfig,
  parseCodeReview,
  parseContent,
  parseExperimentDescription,
  parseExperimentReadme,
  parseWikiFrontmatter,
  publishMutationEvent,
  publishReportCatalog,
  ResourceIdSchema,
  type Run,
  researchDescriptionProblem,
  SCOPED_EDIT_MAX_SPAN,
  serializeWikiPage,
  setCatalogEntryTitle,
  setManifestTitle,
  setMarkdownTitle,
  toggleCommitReviewed,
  toggleTodoDone,
  updateWikiFrontmatter,
  WIKI_ID_REGEX,
  WIKI_LEGACY_ID_REGEX,
  type WikiProjectProjection,
  type WikiSourceReferences,
  type WikiSummary,
  wikiStringList,
  withFileWriterLock,
  withJournalInvocation,
  writeFileAtomic,
  writeProjectCatalog,
} from '@memon/core'
import { isFileAccessError } from '@memon/file-protocol'
import { dirname, isFileURI, join, relative, resolve, sep } from '@memon/file-protocol/paths'
import { PathContainmentError, resolveContained } from './containment.js'
import {
  containedReal,
  indexedCodeReviewInventory,
  indexedReportInventory,
  indexedWikiPages,
} from './indexed-documents.js'
import { missingOrThrow } from './missing-path.js'
import { BackendMutationError } from './mutation-service.js'
import { hasUnrefreshedDocument, registeredCatalog } from './project-catalogs.js'
import { withAutomaticProjectFileContext } from './project-file-context.js'
import { FilesystemProjectService, type InventoryListOptions } from './project-service.js'
import {
  projectReadIndex,
  type ReadPolicy,
  registerProjectRoots,
  STRICT_READ_POLICY,
} from './read-index.js'
import { RUN_INVENTORY_REFRESH_MS, RunInventory, type RunInventoryWalk } from './run-inventory.js'

export class BackendDocumentServiceError extends Error {
  constructor(
    public readonly code:
      | 'PROJECT_NOT_FOUND'
      | 'RESOURCE_NOT_FOUND'
      | 'RESOURCE_NOT_REFRESHED'
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
  setReportTitle(
    project: string,
    id: string,
    input: { title: unknown },
  ): Promise<{ title: string | null }>
  setWikiTitle(
    project: string,
    id: string,
    input: { title: unknown },
  ): Promise<{ title: string | null }>
  wikiBacklinks(project: string, artifact: string): Promise<unknown>
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
  contentFields?: ContentFields
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
}

/** What the wiki's declared sources ask the artifact provider to load. */
export interface BackendWikiArtifactReferences extends WikiSourceReferences {
  /**
   * Numeric `E<NNNN>` prefixes cited with a Variant (`E0001/V0002`): only
   * these need the managed Results document. Absent means every cited
   * Experiment may need it (its full bundle is read).
   */
  variantExperiments?: string[]
}

/** The references of declared wiki sources, with the Variant-citing Experiments. */
export function wikiArtifactReferences(sources: readonly string[]): BackendWikiArtifactReferences {
  const variantExperiments = new Set<string>()
  for (const source of sources) {
    const match = EXPERIMENT_REF_REGEX.exec(source)
    if (match?.[3] !== undefined) variantExperiments.add(match[1]!)
  }
  return { ...collectWikiSourceReferences(sources), variantExperiments: [...variantExperiments] }
}

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
  /** Override for the Run-directory walk behind the shared wiki Run inventory. */
  runWalk?: RunInventoryWalk
  /** Summary-index validation windows; strict (validate every read) by default. */
  readPolicy?: ReadPolicy
  /**
   * Writer role of the derived-index events a Run or Experiment README write
   * publishes (`central` on the central instance, `standalone` otherwise).
   */
  indexRole?: IndexRole
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

  /** One Run-directory walk shared by every wiki projection of a Project. */
  private readonly runInventory: RunInventory | null

  private readonly policy: ReadPolicy

  private readonly indexRole: IndexRole

  constructor(projects: readonly ProjectConfig[], options: FilesystemDocumentServiceOptions = {}) {
    for (const project of projects) {
      if (this.projects.has(project.name)) throw new Error(`duplicate Project ${project.name}`)
      this.projects.set(project.name, project)
    }
    registerProjectRoots(projects)
    this.policy = options.readPolicy ?? STRICT_READ_POLICY
    this.indexRole = options.indexRole ?? 'standalone'
    this.wikiArtifacts = options.wikiArtifacts ?? scanBackendWikiArtifacts
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

  /** Lightweight gateway lookup: document metadata only, no evidence or asset walks. */
  async getContentPresentation(
    projectName: string,
    kind: 'wiki' | 'report',
    id: string,
  ): Promise<ContentFields> {
    const project = this.requireProject(projectName)
    if (!(kind === 'wiki' ? /^W\d{4}$/ : /^R\d{4}$/).test(id))
      throw new BackendDocumentServiceError('INVALID_RESOURCE', 'Invalid content identity')
    const catalog = await registeredCatalog(project, kind === 'wiki' ? 'wiki' : 'reports')
    const inventory = catalog
      ? catalog.entries
      : kind === 'wiki'
        ? (await indexedWikiPages(project, this.policy, { assets: false, id })).map((page) => ({
            id: page.id,
            resource: page.path,
          }))
        : await indexedReportInventory(project, this.policy, id)
    const matches = inventory.filter((item) => item.id === id)
    if (matches.length === 0)
      throw await missingDocument(project, kind === 'wiki' ? 'wiki' : 'reports', id)
    if (matches.length !== 1)
      throw new BackendDocumentServiceError(
        matches.length ? 'AMBIGUOUS_RESOURCE' : 'RESOURCE_NOT_FOUND',
        'Content identity must resolve to one document',
      )
    const resource = matches[0]!.resource
    const absolute = await resolveContained(
      project.root,
      join(project.root, ...resource.split('/')),
    )
    if (!absolute)
      throw new BackendDocumentServiceError('RESOURCE_NOT_FOUND', 'Content document not found')
    const content = await fs.readFile(absolute, 'utf8')
    const parsed = parseContent(content, resource)
    if (parsed.metadata.id !== undefined && parsed.metadata.id !== id)
      throw new BackendDocumentServiceError(
        'INVALID_RESOURCE',
        'Manifest identity disagrees with its directory',
      )
    return parsed.fields
  }

  async getReport(projectName: string, id: string) {
    const project = this.requireProject(projectName)
    const reports = await withAutomaticProjectFileContext(() => this.discoverReports(project, id))
    if (!reports.some((entry) => entry.id === id))
      throw await missingDocument(project, 'reports', id)
    const entry = exactEntry(reports, id)
    return BackendReportResponseSchema.parse({
      ...reportSummary(project, entry),
      ...(await this.read(project, entry)),
    })
  }

  async putReport(projectName: string, id: string, input: DocumentWriteInput) {
    const project = this.requireProject(projectName)
    return this.record(project, 'report write', { report: id }, () =>
      withFileWriterLock(project.root, async () => {
        const entry = exactEntry(await this.discoverReports(project, id), id)
        addJournalInvocationDetail({ kind: 'target', type: 'project', id: project.name })
        return this.write(project, entry, input)
      }),
    )
  }

  /** Rename a Report's display title; only the title bytes change. */
  async setReportTitle(projectName: string, id: string, input: { title: unknown }) {
    const project = this.requireProject(projectName)
    const title = documentTitle(input.title)
    const entry = exactEntry(await this.discoverReports(project, id), id)
    const mtime = await rewriteTitle(project, entry.absolutePath, entry.resource, title)
    await patchCatalogTitle(project, 'reports', id, title, mtime)
    return this.getReport(projectName, id)
  }

  /** Rename a Wiki page's display title; only the title bytes change. */
  async setWikiTitle(projectName: string, id: string, input: { title: unknown }) {
    const project = this.requireProject(projectName)
    const title = documentTitle(input.title)
    const summary = await this.wikiPageSummary(project, id)
    const absolutePath = wikiAbsolutePath(project, summary)
    await assertWithin(project.root, absolutePath)
    const mtime = await rewriteTitle(project, absolutePath, summary.path, title)
    await patchCatalogTitle(project, 'wiki', id, title, mtime)
    return this.getWiki(projectName, id)
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
   * Project-wide wiki projection: discovery, source resolution and lint. Component blocks stay opaque here — the central dashboard
   * owns the registry, so no `WIKI_COMPONENT_*` diagnostic beyond the
   * structural unpinned check is produced.
   */
  async discoverWiki(projectName: string): Promise<WikiProjectProjection> {
    return this.wikiProjection(this.requireProject(projectName))
  }

  async listWiki(projectName: string, options: { inventoryOnly?: boolean } = {}) {
    const project = this.requireProject(projectName)
    const catalog = await registeredCatalog(project, 'wiki')
    if (catalog)
      return options.inventoryOnly
        ? BackendWikiInventoryResponseSchema.parse({
            pages: catalog.entries.map((item) => ({
              id: item.id,
              resource: item.resource,
              legacyId: item.summary.legacyId ?? null,
            })),
          })
        : BackendWikiPagesResponseSchema.parse({
            pages: catalog.entries.map((item) =>
              wikiSummary(project, item.summary as unknown as WikiSummary),
            ),
          })
    if (options.inventoryOnly) {
      const pages = await withAutomaticProjectFileContext(() =>
        indexedWikiPages(project, this.policy, { assets: false }),
      )
      return BackendWikiInventoryResponseSchema.parse({
        pages: pages.map((page) => {
          const { frontmatter } = parseWikiFrontmatter(page.content, page.path)
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
    return this.record(project, 'wiki write', { wiki: id }, () =>
      withFileWriterLock(project.root, async () => {
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
        const catalog = await registeredCatalog(project, 'wiki')
        if (catalog) {
          const parsed = parseWikiFrontmatter(content, summary.path)
          const next = {
            ...buildWikiSummary({
              location: { ...summary, mtime: (await fs.stat(absolutePath)).mtimeMs },
              frontmatter: parsed.frontmatter,
              body: parsed.body,
            }),
            ...parseContent(content, summary.path, summary.kind).fields,
          }
          await writeProjectCatalog(
            project.root,
            'wiki',
            catalog.entries.map((item) =>
              item.id === id ? { ...item, summary: { ...next } } : item,
            ),
          )
        }
        // Re-project so the response carries the updated staleness and diagnostics.
        const next = await this.wikiPageSummary(project, id)
        const page = BackendWikiDocumentSchema.parse(await this.readWikiPage(project, next))
        return BackendWikiWriteResponseSchema.parse({
          ok: true,
          mtime: page.mtime,
          hash: page.hash,
          page,
        })
      }),
    )
  }

  async wikiBacklinks(projectName: string, artifact: string) {
    const project = this.requireProject(projectName)
    const projection = await this.wikiProjection(project)
    return BackendWikiBacklinksSchema.parse(projection.backlinks.get(artifact) ?? [])
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
    const catalog = await registeredCatalog(project, 'wiki')
    if (catalog) {
      const item = catalog.entries.find((item) => item.id === id)
      if (!item) throw await missingDocument(project, 'wiki', id, 'Wiki page not found')
      return item.summary as unknown as WikiSummary
    }
    const pages = await indexedWikiPages(project, this.policy, { assets: true })
    const cited = pages.filter(
      (page) =>
        effectiveWikiId(page.id, parseWikiFrontmatter(page.content, page.path).frontmatter) === id,
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
      return buildWikiProject([], { experiments: [], runs: [] })
    }
    const references = wikiArtifactReferences(
      cited.flatMap((page) =>
        wikiStringList(parseWikiFrontmatter(page.content, page.path).frontmatter?.sources),
      ),
    )
    const [artifacts, reportIds] = await Promise.all([
      this.wikiArtifacts(project, references, {
        runPaths: () => this.wikiRunPaths(project),
        readPolicy: this.policy,
      }),
      this.listReportIds(project),
    ])
    return buildWikiProject(pages, {
      experiments: artifacts.experiments,
      runs: artifacts.runs,
      experimentIds: artifacts.experimentIds,
      runIds: artifacts.runIds,
      reportIds,
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

  private async readWikiPage(project: ProjectConfig, summary: WikiSummary) {
    const absolutePath = wikiAbsolutePath(project, summary)
    await assertWithin(project.root, absolutePath)
    const [content, stat] = await Promise.all([
      fs.readFile(absolutePath, 'utf8'),
      fs.stat(absolutePath),
    ])
    const { frontmatter, body } = parseWikiFrontmatter(content, summary.path)
    const current = {
      ...buildWikiSummary({ location: { ...summary, mtime: stat.mtimeMs }, frontmatter, body }),
      ...parseContent(content, summary.path, summary.kind).fields,
      stale: summary.stale,
      staleSources: summary.staleSources,
      diagnostics: summary.diagnostics,
    }
    return {
      ...wikiSummary(project, current),
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
    return withFileWriterLock(project.root, () => this.writeLocked(project, entry, input))
  }

  private async writeLocked(
    project: ProjectConfig,
    entry: DocumentEntry,
    input: DocumentWriteInput,
  ) {
    const current = await this.read(project, entry)
    if (current.mtime !== input.expectedMtime || current.hash !== input.expectedHash) {
      markJournalInvocationOutcome('conflict', 'DOCUMENT_CHANGED')
      return BackendDocumentConflictResponseSchema.parse({
        error: { code: 'CONFLICT', message: 'on-disk document changed' },
        currentMtime: current.mtime,
        currentHash: current.hash,
      })
    }
    if (/^docs\/experiments\/E[0-9]{4}-[^/]+\/README\.md$/.test(entry.resource)) {
      try {
        await assertExperimentReadmeWritable(
          {
            fs: fs as unknown as MutationFs,
            experiment: { id: entry.id, path: entry.absolutePath },
            index: { projectRoot: project.root, role: this.indexRole },
          },
          current.content,
          input.content,
        )
      } catch (error) {
        throw new BackendDocumentServiceError('INVALID_RESOURCE', (error as Error).message)
      }

      const descriptionPath = join(dirname(entry.absolutePath), 'experiment.json')
      const contained = await resolveContained(project.root, descriptionPath, {
        allowMissing: true,
      })
      const raw = contained ? await missingOrThrow(fs.readFile(contained, 'utf8')) : null
      if (raw !== null && raw !== undefined) {
        const parsed = parseExperimentDescription(raw)
        let researchShape = /"research"\s*:/.test(raw)
        try {
          const shape = JSON.parse(raw) as { variants?: unknown }
          researchShape ||= shape.variants !== undefined && !Array.isArray(shape.variants)
        } catch {
          /* Existing malformed legacy JSON remains repairable through legacy README writes. */
        }
        if (!parsed.data && researchShape)
          throw new BackendDocumentServiceError(
            'INVALID_RESOURCE',
            'Invalid research description; repair it before changing membership',
          )
        const members = parseExperimentReadme(input.content, entry.id).frontMatter.runs
        const problem = parsed.data ? researchDescriptionProblem(parsed.data, members) : null
        if (problem) throw new BackendDocumentServiceError('INVALID_RESOURCE', problem)
      }
    }
    if (entry.resource.endsWith('/manifest.json')) {
      const parsed = parseContent(input.content, entry.resource)
      if (parsed.errors.length)
        throw new BackendDocumentServiceError('INVALID_RESOURCE', parsed.errors.join('; '))
    }
    const original = await fs.stat(entry.absolutePath)
    await writeFileAtomic(entry.absolutePath, input.content, { mode: original.mode })
    projectReadIndex(project.root).invalidate()
    const stat = await fs.stat(entry.absolutePath)
    // FS v8 writer obligation: a Run or Experiment README written here is
    // published to the derived index (Reports and code reviews are not
    // indexed and publish nothing). A publishing failure never fails the write.
    await publishMutationEvent(
      { projectRoot: project.root, role: this.indexRole, publishSnapshot: true },
      'readme.write',
      [{ path: entry.absolutePath, after: input.content }],
    )
    if (entry.kind === 'report') await publishReportCatalog(project.root)
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
  private async discoverReports(project: ProjectConfig, id?: string): Promise<DocumentEntry[]> {
    const catalog = await registeredCatalog(project, 'reports')
    if (catalog)
      return catalog.entries
        .filter((item) => !id || item.id === id)
        .map((item) => ({
          id: item.id,
          slug: item.slug,
          resource: item.resource,
          absolutePath: join(project.root, item.resource),
          title: String(item.summary.title ?? item.slug),
          mtime: Number(item.summary.mtime),
          kind: 'report' as const,
          format: item.summary.format as 'bundle' | 'markdown',
          contentFields: item.summary,
        }))
    const age = this.policy.listMaxAgeMs
    const items = await indexedReportInventory(project, this.policy, id)
    const entries = await Promise.all(
      items.map(async (item): Promise<DocumentEntry | null> => {
        const absolutePath = join(project.root, ...item.resource.split('/'))
        if ((await containedReal(project, this.policy, absolutePath)) === null) return null
        const summary = await projectReadIndex(project.root).file(
          absolutePath,
          'report-title',
          age,
          (content, stat) =>
            stat.isFile()
              ? {
                  title: String(
                    parseContent(content, item.resource).metadata.title ??
                      extractTitle(content) ??
                      item.slug,
                  ).slice(0, 512),
                  mtime: stat.mtimeMs,
                  fields: parseContent(
                    content,
                    item.resource,
                    /^R\d{4}-/.test(item.resource.split('/')[2] ?? '')
                      ? undefined
                      : item.resource.split('/')[2],
                  ).fields,
                }
              : null,
        )
        if (!summary) return null
        return {
          id: item.id,
          absolutePath,
          resource: item.resource,
          title: summary.title,
          mtime: summary.mtime,
          kind: 'report',
          format: /\/(README\.md|manifest\.json)$/.test(item.resource) ? 'bundle' : 'markdown',
          contentFields: summary.fields,
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
  if (summary?.diagnostics.some((item) => item.code === 'WIKI_ID_DUPLICATE'))
    throw new BackendDocumentServiceError('AMBIGUOUS_RESOURCE', 'Wiki identity is ambiguous')
  if (!summary) throw new BackendDocumentServiceError('RESOURCE_NOT_FOUND', 'Wiki page not found')
  return summary
}

function documentTitle(input: unknown): string {
  try {
    return normalizeDocumentTitle(input)
  } catch (error) {
    throw new BackendMutationError('BAD_REQUEST', (error as Error).message)
  }
}

/** A read-only refusal from central (EROFS) or a narrower File Agent grant. */
function titleWriteRefused(error: unknown): never {
  if ((error as NodeJS.ErrnoException)?.code === 'EROFS')
    throw new BackendMutationError('FORBIDDEN', 'Title edits are not enabled for this Project')
  if (isFileAccessError(error) && error.code === 'FORBIDDEN')
    throw new BackendMutationError(
      'FORBIDDEN',
      'The file agent refused the edit; it needs a read-edit or read-write grant',
    )
  if (error instanceof DocumentTitleError)
    throw new BackendDocumentServiceError('INVALID_RESOURCE', error.message)
  throw error
}

/**
 * Replace the title bytes of one document (guarded by the bytes just read)
 * and return its new mtime. No journal receipt: on a scoped Project the
 * receipt itself would be a refused write.
 */
async function rewriteTitle(
  project: ProjectConfig,
  absolutePath: string,
  resource: string,
  title: string,
) {
  try {
    const current = await fs.readFile(absolutePath, 'utf8')
    const next = resource.endsWith('manifest.json')
      ? setManifestTitle(current, title)
      : setMarkdownTitle(current, title)
    if (next !== current) {
      // A File Agent keeps the mode itself, and a scoped grant refuses one.
      const mode = isFileURI(absolutePath) ? undefined : (await fs.stat(absolutePath)).mode
      await writeFileAtomic(absolutePath, next, mode === undefined ? {} : { mode })
    }
    return (await fs.stat(absolutePath)).mtimeMs
  } catch (error) {
    return titleWriteRefused(error)
  } finally {
    projectReadIndex(project.root).invalidate()
  }
}

/**
 * Carry the new title and mtime into the published catalog entry, if the
 * Project publishes one. A change too wide for one scoped replacement is
 * written as two (title, then mtime).
 */
async function patchCatalogTitle(
  project: ProjectConfig,
  kind: 'reports' | 'wiki',
  id: string,
  title: string,
  mtime: number,
) {
  if (!(await registeredCatalog(project, kind))) return
  const path = join(project.root, `.memon/index/${kind}.json`)
  try {
    const current = await fs.readFile(path, 'utf8')
    const titled = setCatalogEntryTitle(current, id, { title })
    const next = setCatalogEntryTitle(titled, id, { mtime })
    if (next === current) return
    if (titled !== current && changedByteSpan(current, next) > SCOPED_EDIT_MAX_SPAN) {
      await writeFileAtomic(path, titled)
      if (next !== titled) await writeFileAtomic(path, next)
    } else {
      await writeFileAtomic(path, next)
    }
  } catch (error) {
    titleWriteRefused(error)
  }
}

function wikiAbsolutePath(project: ProjectConfig, summary: WikiSummary): string {
  return join(project.root, ...summary.path.split('/'))
}

/**
 * Validate an incoming page against the one on disk and stamp `updated_at`.
 * Identity (`id`, `kind`) moves only through `memon wiki move`.
 */
function nextWikiContent(content: string, current: string, summary: WikiSummary): string {
  if (summary.path.endsWith('/manifest.json')) {
    const parsed = parseContent(content, summary.path)
    if (parsed.errors.length)
      throw new BackendDocumentServiceError('INVALID_RESOURCE', parsed.errors.join('; '))
    const previous = parseContent(current, summary.path).metadata
    if (parsed.metadata.id !== previous.id)
      throw new BackendDocumentServiceError('INVALID_RESOURCE', 'manifest identity cannot change')
    return `${JSON.stringify({ ...parsed.metadata, updated_at: formatIsoLocal(new Date()) }, null, 2)}\n`
  }
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
  return serializeWikiPage(
    updateWikiFrontmatter(next.frontmatter, { updated_at: formatIsoLocal(new Date()) }),
    next.body,
  )
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
    ...entry.contentFields,
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

/** A catalog miss: "Not refreshed" when the source has the document, else not found. */
async function missingDocument(
  project: ProjectConfig,
  kind: 'wiki' | 'reports',
  id: string,
  message = 'Document not found',
): Promise<BackendDocumentServiceError> {
  return (await hasUnrefreshedDocument(project, kind, id))
    ? new BackendDocumentServiceError('RESOURCE_NOT_REFRESHED', 'Not refreshed')
    : new BackendDocumentServiceError('RESOURCE_NOT_FOUND', message)
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
