import { basename, join, relative, resolve, sep } from 'node:path'
import {
  BackendAnomaliesResponseSchema,
  BackendExperimentResponseSchema,
  BackendExperimentResultsResponseSchema,
  type BackendExperimentSummary,
  BackendExperimentSummarySchema,
  BackendHypothesesResponseSchema,
  BackendJournalHistoryResponseSchema,
  BackendJournalResponseSchema,
  type BackendResourceInventoryItem,
  BackendResourceInventoryResponseSchema,
  BackendRunFilesResponseSchema,
  BackendRunResponseSchema,
  type BackendRunSummary,
  BackendRunSummarySchema,
  BackendRunsResponseSchema,
  buildExperimentDocumentView,
  buildExperimentRecord,
  computeMembership,
  discoverRuns,
  type Experiment,
  projectFs as fs,
  getProjectFileStatus,
  type ImplementationItem,
  type IndexedRun,
  type InvestigationItem,
  invalidateProjectFile,
  isRunDeprecated,
  isStaleRunning,
  type MembershipResult,
  matchesRunDeprecationFilter,
  type ParsedHypotheses,
  type ProjectConfig,
  parseHypotheses,
  parseJournal,
  projectResultsRunEligibility,
  projectRunPath,
  ResourceIdSchema,
  type ResultsDocument,
  type ResultsVariantEligibility,
  RUN_TIMESTAMP_TAIL_REGEX,
  type Run,
  readExperimentDoc,
  readJournalActivity,
  readProjectJournal,
  readRunDir,
  runArchivedFromRun,
} from '@memon/core'
import type {
  BackendWikiArtifactOptions,
  BackendWikiArtifactReferences,
  BackendWikiArtifacts,
} from './document-service.js'
import {
  BackendExperimentListResponseSchema,
  experimentIdentities,
  experimentListing,
  experimentListRow,
  type IndexedExperimentDocument,
  indexedExperimentBundle,
  indexedExperimentDocuments,
} from './indexed-experiments.js'
import {
  archivedRun,
  indexedDeclaredRun,
  indexedRun,
  type RunSummary,
  requestRun,
  runListWindow,
} from './indexed-runs.js'
import { missingOrThrow } from './missing-path.js'
import { withAutomaticProjectFileContext } from './project-file-context.js'
import {
  projectReadIndex,
  type ReadPolicy,
  registerProjectRoots,
  STRICT_READ_POLICY,
} from './read-index.js'
import { resolveRunReferencePath } from './run-path.js'

export class BackendProjectServiceError extends Error {
  constructor(
    public readonly code: 'PROJECT_NOT_FOUND' | 'RESOURCE_NOT_FOUND' | 'INVALID_RESOURCE',
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'BackendProjectServiceError'
  }
}

/** The shape `docs/hypotheses.md` projects to when the file does not exist. */
const EMPTY_HYPOTHESES: ParsedHypotheses = {
  legendBlock: null,
  summaryTableBlock: null,
  entries: [],
  parseErrors: [],
  parseWarnings: [],
}

/**
 * Explicit-inspection selector for a Run collection. Absent means the
 * research default: deprecated Runs are not part of the collection.
 */
export interface RunCollectionFilter {
  includeDeprecated?: boolean
  deprecatedOnly?: boolean
}

export interface InventoryListOptions {
  inventoryOnly?: boolean
}

export interface RunPageOptions extends InventoryListOptions {
  /** Page size (1–1000); defaults to `DEFAULT_RUN_PAGE_SIZE`. */
  limit?: number
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor?: string
}

export const DEFAULT_RUN_PAGE_SIZE = 200
export const MAX_RUN_PAGE_SIZE = 1000

/** A Run page: the existing summary rows plus the cursor of the next page. */
export const BackendRunsPageResponseSchema = BackendRunsResponseSchema.extend({
  // A nullable string, shaped like the summary's own `finishedAt`.
  nextCursor: BackendRunSummarySchema.shape.frontMatter.shape.finishedAt,
}).strict()

export interface BackendProjectReadService {
  listRuns(
    project: string,
    filter?: RunCollectionFilter,
    options?: RunPageOptions,
  ): Promise<unknown>
  getRun(project: string, id: string): Promise<unknown>
  listExperiments(project: string, options?: InventoryListOptions): Promise<unknown>
  getExperiment(project: string, id: string): Promise<unknown>
  getExperimentResults(project: string, id: string): Promise<unknown>
  getRunFiles(project: string, id: string, depth: number): Promise<unknown>
  getHypotheses(project: string): Promise<unknown>
  getJournal(project: string): Promise<unknown>
  getJournalCount?(project: string): Promise<{ totalEvents: number }>
  getJournalHistory(project: string, limit?: number): Promise<unknown>
  getAnomalies(project: string): Promise<unknown>
}

/**
 * One request's domain composition. Built fresh per request from the Project
 * file store's cached bytes and listings — there is no second, long-lived
 * domain payload cache here. A warm store makes a rebuild cheap and, unlike a
 * snapshot, it can never serve a payload the file layer already knows is gone.
 */
interface ProjectData {
  project: ProjectConfig
  runs: IndexedRun[]
  runsById: ReadonlyMap<string, IndexedRun>
  experiments: Experiment[]
  membership: MembershipResult
}

/**
 * Bookkeeping about the last composition attempt: counts, timings and the last
 * error. Deliberately no domain objects — this is diagnostic metadata, and the
 * freshness itself comes from the file store's own status.
 */
interface ProjectCompositionState {
  generation: number
  composed: boolean
  lastRefreshAt: string | null
  lastRefreshDurationMs: number | null
  lastError: string | null
  runs: number
  experiments: number
}

export interface ProjectSnapshotInspection {
  project: string
  generation: number
  ready: boolean
  dirty: boolean
  refreshing: boolean
  runs: number
  experiments: number
  lastRefreshAt: string | null
  lastRefreshDurationMs: number | null
  lastError: string | null
}

export class FilesystemProjectService implements BackendProjectReadService {
  private readonly projects = new Map<string, ProjectConfig>()
  private readonly compositions = new Map<string, ProjectCompositionState>()

  private readonly policy: ReadPolicy

  constructor(projects: readonly ProjectConfig[], options: { readPolicy?: ReadPolicy } = {}) {
    registerProjectRoots(projects)
    this.policy = options.readPolicy ?? STRICT_READ_POLICY
    for (const project of projects) {
      if (this.projects.has(project.name)) throw new Error(`duplicate Project ${project.name}`)
      this.projects.set(project.name, project)
      this.compositions.set(project.name, {
        generation: 0,
        composed: false,
        lastRefreshAt: null,
        lastRefreshDurationMs: null,
        lastError: null,
        runs: 0,
        experiments: 0,
      })
    }
  }

  /**
   * Drop this Project's cached file observations. The next domain request
   * re-reads whatever it needs; nothing is recomputed eagerly.
   */
  invalidateProject(projectName: string): void {
    invalidateProjectFile(this.requireProject(projectName).root)
  }

  /**
   * Compose once now and report what that observed. Kept for the callers that
   * used to force a snapshot rebuild; it no longer installs a payload, so a
   * failure surfaces to this caller instead of poisoning later reads.
   */
  async refreshProject(projectName: string): Promise<ProjectSnapshotInspection> {
    await this.readProject(projectName)
    return this.inspectProject(projectName)
  }

  inspectProject(projectName: string): ProjectSnapshotInspection {
    const project = this.requireProject(projectName)
    const state = this.requireComposition(projectName)
    const status = getProjectFileStatus(project.root)
    return {
      project: projectName,
      generation: state.generation,
      ready: state.composed,
      // Freshness is the file layer's property now: unverified or missing
      // dependencies are what "dirty" means for a request-time composition.
      dirty: status.incomplete,
      refreshing: status.queued + status.checking > 0,
      runs: state.runs,
      experiments: state.experiments,
      lastRefreshAt: state.lastRefreshAt,
      lastRefreshDurationMs: state.lastRefreshDurationMs,
      lastError: state.lastError ?? status.error,
    }
  }

  /**
   * Evidence metadata for the artifacts a wiki actually cites.
   *
   * Identity comes from directory entries — every Experiment id and Run
   * directory name, so an `@` reference still resolves against the whole
   * project — while metadata is read only for the cited targets and the member
   * Runs whose times widen a cited Experiment's effective window. An
   * uncited Run's README is therefore never opened, and never breaks a wiki
   * read by being unreadable.
   */
  async readWikiArtifacts(
    projectName: string,
    references: BackendWikiArtifactReferences,
    options: BackendWikiArtifactOptions = {},
  ): Promise<BackendWikiArtifacts> {
    const project = this.requireProject(projectName)
    const age = this.policy.listMaxAgeMs
    const runWindow = runListWindow(this.policy)
    return withAutomaticProjectFileContext(async () => {
      const index = projectReadIndex(project.root)
      const [listing, hypotheses] = await Promise.all([
        experimentListing(project, age),
        index.file(
          join(project.root, 'docs', 'hypotheses.md'),
          'wiki-hypotheses',
          age,
          (content, stat) => ({
            ids: parseHypotheses(content).entries.map((entry) => entry.id),
            mtime: stat.mtimeMs,
          }),
        ),
      ])
      const experimentIds = experimentIdentities(listing)

      // A citation may name an Experiment by its numeric id alone; resolution
      // then picks the first document with that prefix, as the projection does.
      const cited: string[] = []
      for (const numericId of references.experiments) {
        const id = experimentIds.find((candidate) => candidate.slice(0, 5) === numericId)
        if (id !== undefined) cited.push(id)
      }
      const experiments = (
        await Promise.all(cited.map((id) => indexedExperimentBundle(project, id, age)))
      ).filter((experiment): experiment is Experiment => experiment !== null)

      // A cited Experiment's effective updated time joins its members', so those
      // Runs — and only those — are summarized alongside the directly cited ones.
      const wantedRuns = new Set(references.runs)
      for (const experiment of experiments) {
        for (const runId of experiment.frontMatter.runs) wantedRuns.add(runId)
      }
      // One directory walk serves every bare reference; a caller may supply a
      // shared inventory of that walk instead of paying for a fresh one.
      const walkedPaths = options.runPaths ? await options.runPaths() : await this.walk(project)
      const byBasename = new Map<string, string[]>()
      for (const path of walkedPaths) {
        const name = basename(path)
        byBasename.set(name, [...(byBasename.get(name) ?? []), path])
      }
      // Cited Runs come from the summary index a few at a time: a list citing
      // busy Experiments covers a thousand Runs, and a warm entry costs at most
      // one stat.
      const summaries = await mapWithConcurrency(
        [...wantedRuns],
        WIKI_RUN_READ_CONCURRENCY,
        async (reference) => {
          if (reference.includes('/')) {
            try {
              return await indexedDeclaredRun(project, reference, runWindow)
            } catch {
              return null
            }
          }
          // An ambiguous or unknown base name is an unresolved citation, not a
          // failed listing.
          const candidates = byBasename.get(reference) ?? []
          return candidates.length === 1 ? indexedRun(project, candidates[0]!, runWindow) : null
        },
      )
      const seen = new Set<string>()
      const runs: Run[] = []
      for (const summary of summaries) {
        if (!summary || seen.has(summary.run.path)) continue
        seen.add(summary.run.path)
        runs.push({ ...requestRun(summary), id: projectRunPath(project.root, summary.run.path) })
      }
      // `@` mentions resolve against every walked directory — by canonical
      // project path and by base name — without opening a single README.
      const runIds: string[] = []
      for (const path of walkedPaths) {
        runIds.push(projectRunPath(project.root, path), basename(path))
      }

      return {
        experiments,
        runs,
        experimentIds,
        runIds,
        hypothesesMtime: hypotheses?.mtime ?? null,
        hypothesisIds: hypotheses?.ids ?? [],
      }
    })
  }

  /**
   * The Project's Run collection. Deprecated Runs are excluded by default:
   * they are outside normal research collections, aggregation and counts. The
   * filter is the explicit-inspection path, and `getRun` stays unfiltered so
   * an id always resolves.
   */
  async listRuns(
    projectName: string,
    filter: RunCollectionFilter = {},
    options: RunPageOptions = {},
  ) {
    if (options.inventoryOnly) {
      const project = this.requireProject(projectName)
      const paths = await withAutomaticProjectFileContext(() =>
        discoverRuns(project, { includeArchived: true }),
      )
      return BackendResourceInventoryResponseSchema.parse({
        items: paths.map((path): BackendResourceInventoryItem => {
          const id = basename(path)
          return {
            id: projectRunPath(project.root, path),
            slug: id.replace(RUN_TIMESTAMP_TAIL_REGEX, ''),
            resource: portableProjectResource(project, join(path, 'README.md')),
          }
        }),
      })
    }
    const limit = options.limit ?? DEFAULT_RUN_PAGE_SIZE
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RUN_PAGE_SIZE) {
      throw new BackendProjectServiceError('INVALID_RESOURCE', 'Run page size is invalid')
    }
    const after = options.cursor === undefined ? null : decodeRunCursor(options.cursor)
    const data = await this.readProject(projectName)
    const rows = data.runs.filter((run) => matchesRunDeprecationFilter(run.deprecated, filter))
    const start =
      after === null
        ? 0
        : rows.findIndex((run) => compareRunOrder(run, after, data.project.root) > 0)
    const page = start < 0 ? [] : rows.slice(start, start + limit)
    const last = page.at(-1)
    const more = start >= 0 && start + limit < rows.length
    return BackendRunsPageResponseSchema.parse({
      runs: page.map((run) => safeRunSummary(run, data.project)),
      nextCursor: more && last ? encodeRunCursor(last, data.project.root) : null,
    })
  }

  /**
   * One Run's own document. The dependencies are this Run's README plus the
   * directory listings that locate it — never every other Run's body, so an
   * open Run page's freshness and attention describe only what it displays.
   */
  async getRun(projectName: string, id: string) {
    const project = this.requireProject(projectName)
    const run = await this.readRun(project, id)
    return BackendRunResponseSchema.parse({
      ...safeRunSummary(run, project),
      id: id.includes('/') ? projectRunPath(project.root, run.path) : run.id,
      sections: {
        motivation: run.sections.motivation,
        setup: run.sections.setup,
        method: run.sections.method,
        result: run.sections.result,
        conclusion: run.sections.conclusion,
        caveats: run.sections.caveats,
        newHypotheses: run.sections.newHypotheses,
        artifacts: run.sections.artifacts.flatMap((artifact) => {
          const path = ResourceIdSchema.safeParse(artifact.path)
          return path.success ? [{ path: path.data, description: artifact.description }] : []
        }),
      },
      body: run.body,
      warnings: run.warnings,
      warningsRaw: run.warningsRaw,
      resources: null,
    })
  }

  /**
   * Every Experiment document in this Project, and nothing else.
   *
   * The list reads `docs/experiments/` only — no Run walk, no membership
   * join — so a huge, cold or unreadable Run tree can no longer stop the
   * Experiment list from rendering. Each row's effective window is therefore
   * its own document's; the member roster and the window widened over it are
   * the detail projection's job.
   */
  async listExperiments(projectName: string, options: InventoryListOptions = {}) {
    const project = this.requireProject(projectName)
    const maxAge = this.policy.listMaxAgeMs
    if (options.inventoryOnly) {
      const { folders, legacy } = await withAutomaticProjectFileContext(() =>
        experimentListing(project, maxAge),
      )
      const items = new Map<string, string>()
      for (const [id, entry] of folders) {
        if (entry.type === 'dir') items.set(id, `docs/experiments/${entry.name}/README.md`)
      }
      for (const [id, entry] of legacy) {
        if (entry.type === 'file' && !items.has(id)) items.set(id, `docs/experiments/${entry.name}`)
      }
      return BackendResourceInventoryResponseSchema.parse({
        items: [...items]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, resource]) => ({
            id,
            slug: id.slice('E0000-'.length),
            resource: ResourceIdSchema.parse(resource),
          })),
      })
    }
    const documents = await indexedExperimentDocuments(project, maxAge)
    return BackendExperimentListResponseSchema.parse({
      experiments: documents.map((document) =>
        experimentListRow(project, document, portableReadmeResource(project, document.path)),
      ),
    })
  }

  /**
   * The Experiment bundle plus read-time deprecation metadata for its roster.
   * Run bodies and logs arrive only from explicit Run endpoints.
   */
  async getExperiment(projectName: string, id: string) {
    const project = this.requireProject(projectName)
    const experiment = await this.readExperimentDocument(project, id)
    const eligibility = await experimentRunEligibility(project, experiment, () =>
      this.walk(project),
    )
    const documentView = buildExperimentDocumentView(experiment, {
      deprecatedRuns: eligibility.deprecatedRuns,
    })
    return BackendExperimentResponseSchema.parse({
      ...safeExperimentSummary(experiment, project),
      body: experiment.body,
      deprecatedRuns: eligibility.deprecatedRuns,
      warningsRaw: experiment.warningsRaw,
      rawSections: experiment.rawSections ?? [],
      documents: safeManagedDocuments(experiment, project, eligibility.variantEligibility),
      resultsUpdatedAt: await managedResultsUpdatedAt(experiment.documents?.results),
      documentSections: documentView.sections,
      documentDiagnostics: documentView.diagnostics,
      documentReadOnly: documentView.readOnly,
    })
  }

  async getExperimentResults(projectName: string, id: string) {
    const project = this.requireProject(projectName)
    const experiment = await this.readExperimentDocument(project, id)
    const results = experiment.documents?.results
    if (!results?.exists) {
      throw new BackendProjectServiceError('RESOURCE_NOT_FOUND', 'Experiment results not found')
    }
    const fileStat = await fs.stat(results.path)
    if (!results.data) {
      throw new BackendProjectServiceError('INVALID_RESOURCE', 'Experiment results are invalid', {
        diagnostics: results.parseErrors,
        updatedAt: fileStat.mtime.toISOString(),
      })
    }
    const eligibility = await experimentRunEligibility(project, experiment, () =>
      this.walk(project),
    )
    return BackendExperimentResultsResponseSchema.parse({
      project: projectName,
      resource: portableProjectResource(project, results.path),
      document: safeResultsDocument(results.data),
      ...eligibility,
      updatedAt: fileStat.mtime.toISOString(),
      warnings: results.parseWarnings,
    })
  }

  async getRunFiles(projectName: string, id: string, depth: number) {
    const project = this.requireProject(projectName)
    const runPath = await withAutomaticProjectFileContext(() =>
      resolveRunReferencePath(project, id, () => this.walk(project)),
    )
    if (!runPath) throw new BackendProjectServiceError('RESOURCE_NOT_FOUND', 'Run not found')
    const runRoot = await fs.realpath(runPath)
    let truncated = false
    let count = 0

    const walk = async (
      absoluteDirectory: string,
      depthLeft: number,
    ): Promise<{
      type: 'dir'
      resource: string
      children: Array<Record<string, unknown>>
    } | null> => {
      if (depthLeft < 0) return null
      const realDirectory = await missingOrThrow(fs.realpath(absoluteDirectory))
      if (
        !realDirectory ||
        (realDirectory !== runRoot && !realDirectory.startsWith(`${runRoot}${sep}`))
      ) {
        return null
      }
      const entries =
        (await missingOrThrow(fs.readdir(realDirectory, { withFileTypes: true }))) ?? []
      const children: Array<Record<string, unknown>> = []
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (count >= 200) {
          truncated = true
          break
        }
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
        const child = join(realDirectory, entry.name)
        const childStat = await missingOrThrow(fs.lstat(child))
        if (!childStat || childStat.isSymbolicLink()) continue
        if (childStat.isFile()) {
          children.push({
            type: 'file',
            resource: portableRunResource(runRoot, child),
            size: childStat.size,
            mtime: childStat.mtimeMs,
          })
          count += 1
          continue
        }
        if (childStat.isDirectory()) {
          count += 1
          const nested = await walk(child, depthLeft - 1)
          if (nested) {
            children.push(nested)
          } else {
            count -= 1
          }
        }
      }
      const relativeDirectory = relative(runRoot, realDirectory).split(sep).join('/')
      return { type: 'dir', resource: relativeDirectory || '.', children }
    }

    const tree = await walk(runRoot, depth)
    return BackendRunFilesResponseSchema.parse({
      project: projectName,
      runId: id,
      resource: portableProjectResource(project, runRoot),
      depth,
      truncated,
      entries: count,
      tree: tree ?? { type: 'dir', resource: '.', children: [] },
    })
  }

  /** Depends on `docs/hypotheses.md` alone, parsed once per fingerprint. */
  async getHypotheses(projectName: string) {
    const project = this.requireProject(projectName)
    const hypotheses =
      (await projectReadIndex(project.root).file(
        join(project.root, 'docs', 'hypotheses.md'),
        'hypotheses',
        this.policy.listMaxAgeMs,
        (content) => parseHypotheses(content),
      )) ?? EMPTY_HYPOTHESES
    return BackendHypothesesResponseSchema.parse({
      project: projectName,
      legendBlock: hypotheses.legendBlock,
      summaryTableBlock: hypotheses.summaryTableBlock,
      entries: hypotheses.entries,
      parseErrors: hypotheses.parseErrors,
      parseWarnings: hypotheses.parseWarnings,
    })
  }

  /**
   * Legacy `docs/journal.md` only. This is the read a share-scoped viewer may
   * already reach, so it never grows to include invocation receipts.
   */
  async getJournal(projectName: string) {
    const project = this.requireProject(projectName)
    const {
      path: _path,
      lastDigestAt: _cursor,
      events,
      ...journal
    } = await readProjectJournal(project.root)
    return BackendJournalResponseSchema.parse({
      project: projectName,
      ...journal,
      events: [...events].reverse(),
    })
  }

  /**
   * Number of legacy Journal events, counted once per `docs/journal.md`
   * fingerprint so a tab badge never re-reads the history.
   */
  async getJournalCount(projectName: string): Promise<{ totalEvents: number }> {
    const project = this.requireProject(projectName)
    const total = await projectReadIndex(project.root).file(
      join(resolve(project.root), 'docs', 'journal.md'),
      'journal-count',
      this.policy.listMaxAgeMs,
      (content) => parseJournal(content).events.length,
    )
    return { totalEvents: total ?? 0 }
  }

  /**
   * Owner-only merged diagnostics: preserved legacy Markdown history plus the
   * typed invocation receipts, newest first, each labelled by its own origin.
   * Receipts are read from disk on every call — a diagnostic query reports the
   * current ledger, not a polled research snapshot — and undecodable receipt
   * files are surfaced instead of silently shrinking the history.
   */
  async getJournalHistory(projectName: string, limit?: number) {
    const project = this.requireProject(projectName)
    const [journal, activity] = await Promise.all([
      readProjectJournal(project.root),
      readJournalActivity(project.root),
    ])
    const legacyEvents = [...journal.events].reverse()
    const invocations = [...activity.records].reverse()
    return BackendJournalHistoryResponseSchema.parse({
      project: projectName,
      legacy: {
        present: journal.path !== null,
        events: limit === undefined ? legacyEvents : legacyEvents.slice(0, limit),
        parseErrors: journal.parseErrors,
        parseWarnings: journal.parseWarnings,
      },
      invocations: limit === undefined ? invocations : invocations.slice(0, limit),
      unreadableReceipts: activity.unreadable,
    })
  }

  async getAnomalies(projectName: string) {
    const data = await this.readProject(projectName)
    return BackendAnomaliesResponseSchema.parse({
      anomalies: [...data.membership.anomalies].sort((a, b) =>
        b.detectedAt.localeCompare(a.detectedAt),
      ),
    })
  }

  private requireProject(projectName: string): ProjectConfig {
    const project = this.projects.get(projectName)
    if (!project) throw new BackendProjectServiceError('PROJECT_NOT_FOUND', 'Project not found')
    return project
  }

  private requireComposition(projectName: string): ProjectCompositionState {
    this.requireProject(projectName)
    return this.compositions.get(projectName)!
  }

  /**
   * One Run's own README, parsed for this request. Locating it (a Run-root
   * walk for a bare id) and finding its declared owner (an Experiment
   * inventory) are automatic-priority work; only the README itself is read at
   * the caller's priority.
   */
  private async readRun(project: ProjectConfig, id: string): Promise<IndexedRun> {
    const path = await withAutomaticProjectFileContext(() =>
      resolveRunReferencePath(project, id, () => this.walk(project)),
    )
    if (!path) throw new BackendProjectServiceError('RESOURCE_NOT_FOUND', 'Run not found')
    const run = await readRunDir(path, project.name)
    run.frontMatter.experiment = await withAutomaticProjectFileContext(() =>
      this.declaredOwner(project, path),
    )
    return {
      ...run,
      archived: await runArchivedFromRun(run),
      // Orthogonal to archival and status: an explicit-id Run read always
      // resolves, and carries the flag so a viewer can mark it deprecated.
      deprecated: isRunDeprecated(run),
      stale: isStaleRunning(run),
    }
  }

  /** One Experiment bundle, without touching any other Experiment. */
  private async readExperimentDocument(project: ProjectConfig, id: string): Promise<Experiment> {
    const experiment = await readExperimentDoc(project.root, project.name, id)
    if (!experiment) {
      throw new BackendProjectServiceError('RESOURCE_NOT_FOUND', 'Experiment not found')
    }
    return experiment
  }

  /**
   * Compose this Project's domain records for the current request.
   *
   * Every call re-runs the projection. The cost is CPU over already-observed
   * file bytes and listings: only dependencies the file store considers due or
   * unknown reach the filesystem. A failure propagates to this request — a
   * cold or broken mount must surface as an error, never as an empty Project.
   */
  private async readProject(projectName: string): Promise<ProjectData> {
    const state = this.requireComposition(projectName)
    const startedAt = Date.now()
    try {
      const data = await this.buildProject(projectName)
      state.generation += 1
      state.composed = true
      state.lastRefreshAt = new Date().toISOString()
      state.lastRefreshDurationMs = Date.now() - startedAt
      state.lastError = null
      state.runs = data.runs.length
      state.experiments = data.experiments.length
      return data
    } catch (error) {
      state.lastError = (error as Error).message
      throw error
    }
  }

  /**
   * The project-wide composition the aggregate list endpoints need: every Run
   * and Experiment document plus their membership join. Detail endpoints do not
   * use this — they resolve their own bundle and its declared Runs instead.
   */
  private async buildProject(projectName: string): Promise<ProjectData> {
    const project = this.requireProject(projectName)
    // An unreadable or missing Project root is an error, never an empty one.
    const rootStat = await fs.stat(project.root)
    if (!rootStat.isDirectory()) throw new Error('Project root is not a directory')
    const runWindow = runListWindow(this.policy)
    const [summaries, documents] = await Promise.all([
      // The composition is the full Run set on purpose: membership must see
      // a deprecated Run to avoid reporting it as a phantom reference, and
      // `listRuns` applies the research default on top of this.
      withAutomaticProjectFileContext(async () =>
        mapWithConcurrency(await this.walk(project), RUN_SUMMARY_CONCURRENCY, (dir) =>
          indexedRun(project, dir, runWindow),
        ),
      ),
      indexedExperimentDocuments(project, this.policy.listMaxAgeMs),
    ])
    const runs = (
      await mapWithConcurrency(
        summaries.filter((summary): summary is RunSummary => summary !== null),
        RUN_SUMMARY_CONCURRENCY,
        (summary) => archivedRun(project, summary, this.policy.listMaxAgeMs),
      )
    ).sort((a, b) => String(b.frontMatter.createdAt).localeCompare(String(a.frontMatter.createdAt)))
    const experiments = documents.map((document) => experimentRecord(project, document))
    const runsByPath = new Map(runs.map((run) => [projectRunPath(project.root, run.path), run]))
    const legacyCounts = new Map<string, number>()
    for (const run of runs) legacyCounts.set(run.id, (legacyCounts.get(run.id) ?? 0) + 1)
    for (const run of runs) {
      const path = projectRunPath(project.root, run.path)
      const owners = experiments.filter(
        (experiment) =>
          experiment.frontMatter.runs.includes(path) ||
          (legacyCounts.get(run.id) === 1 && experiment.frontMatter.runs.includes(run.id)),
      )
      run.frontMatter.experiment = owners.length === 1 ? owners[0]!.id : null
    }
    // Path declarations are classified from the declared path itself, so an
    // excluded or depth-pruned Run directory is a member, not a phantom.
    const declared = new Set<string>()
    for (const experiment of experiments)
      for (const reference of experiment.frontMatter.runs)
        if (reference.includes('/')) declared.add(reference)
    const declaredRuns = new Map<string, Run | null>()
    await withAutomaticProjectFileContext(() =>
      mapWithConcurrency([...declared], RUN_SUMMARY_CONCURRENCY, async (reference) => {
        const known = runsByPath.get(reference)
        if (known) {
          declaredRuns.set(reference, known)
          return
        }
        try {
          const summary = await indexedDeclaredRun(project, reference, runWindow)
          declaredRuns.set(reference, summary ? requestRun(summary) : null)
        } catch {
          declaredRuns.set(reference, null)
        }
      }),
    )
    return {
      project,
      runs,
      runsById: runsByPath,
      experiments,
      membership: computeMembership({
        experiments,
        runs,
        project: project.name,
        projectRoot: project.root,
        declaredRuns,
      }),
    }
  }

  /** Every Run directory, through the index's shared walk. */
  private walk(project: ProjectConfig): Promise<readonly string[]> {
    return projectReadIndex(project.root).walk(project, this.policy.walkRefreshMs, (target) =>
      discoverRuns(target, { includeArchived: true }),
    )
  }

  /**
   * The single Experiment that declares `dir` (by project path, or by a base
   * name that resolves uniquely to it), validated against every Experiment
   * README's fingerprint on each call.
   */
  private async declaredOwner(project: ProjectConfig, dir: string): Promise<string | null> {
    const path = projectRunPath(project.root, dir)
    const name = basename(dir)
    const owners: string[] = []
    let legacyTarget: Promise<string | null> | undefined
    for (const document of await indexedExperimentDocuments(project, 0)) {
      const runs = document.parsed.frontMatter.runs
      let declared = runs.includes(path)
      if (!declared && runs.includes(name)) {
        legacyTarget ??= this.walk(project).then((paths) => {
          const matches = paths.filter((candidate) => basename(candidate) === name)
          return matches.length === 1 ? matches[0]! : null
        })
        declared = (await legacyTarget) === dir
      }
      if (declared) owners.push(document.id)
    }
    if (owners.length > 1) throw new Error(`Run path has multiple Experiment owners: ${path}`)
    return owners[0] ?? null
  }
}

/** A full Experiment record (README only) for membership composition. */
function experimentRecord(project: ProjectConfig, document: IndexedExperimentDocument): Experiment {
  return buildExperimentRecord(
    {
      ...document.parsed,
      parseWarnings: [...document.parsed.parseWarnings, ...document.discoveryWarnings],
    },
    {
      id: document.id,
      project: project.name,
      path: document.path,
      mtime: document.readmeMtime,
      readmeMtime: document.readmeMtime,
    },
  )
}

const RUN_SUMMARY_CONCURRENCY = 16

/** Run list order: created time descending, then project Run path ascending. */
type RunOrderKey = readonly [createdAt: string, id: string]

function runOrderKey(run: IndexedRun, root: string): RunOrderKey {
  return [String(run.frontMatter.createdAt), projectRunPath(root, run.path)]
}

function compareRunOrder(run: IndexedRun, key: RunOrderKey, root: string): number {
  const [createdAt, path] = runOrderKey(run, root)
  return createdAt !== key[0] ? key[0].localeCompare(createdAt) : path.localeCompare(key[1])
}

function encodeRunCursor(run: IndexedRun, root: string): string {
  return Buffer.from(JSON.stringify(runOrderKey(run, root))).toString('base64url')
}

function decodeRunCursor(cursor: string): RunOrderKey {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      typeof value[1] === 'string'
    ) {
      return [value[0], value[1]]
    }
  } catch {}
  throw new BackendProjectServiceError('INVALID_RESOURCE', 'Run page cursor is invalid')
}

function safeRunSummary(run: IndexedRun, project: ProjectConfig): BackendRunSummary {
  const frontMatter = run.frontMatter
  return BackendRunsResponseSchema.shape.runs.element.parse({
    id: projectRunPath(project.root, run.path),
    project: run.project,
    resource: runReadmeResource(project, run),
    mtime: run.mtime,
    readmeMtime: run.readmeMtime,
    hasReadme: run.hasReadme,
    stale: run.stale,
    archived: run.archived,
    deprecated: run.deprecated,
    frontMatter: {
      id: frontMatter.id,
      name: frontMatter.name,
      project: frontMatter.project,
      status: frontMatter.status,
      createdAt: frontMatter.createdAt,
      updatedAt: frontMatter.updatedAt,
      finishedAt: frontMatter.finishedAt,
      experiment: frontMatter.experiment,
      host: frontMatter.host,
      pid: frontMatter.pid,
      gpus: frontMatter.gpus,
      entry: frontMatter.entry,
      command: frontMatter.command,
      wandb: frontMatter.wandb,
      hypotheses: frontMatter.hypotheses,
      tags: frontMatter.tags,
      archived: frontMatter.archived,
      deprecated: frontMatter.deprecated,
    },
    parseErrors: run.parseErrors,
    parseWarnings: run.parseWarnings,
  })
}

/**
 * The Experiment document's own projection, used by both the list and the
 * detail. Effective timestamps are the document's: no projection reads a member
 * Run, so neither widens the window over one.
 */
function safeExperimentSummary(
  experiment: Experiment,
  project: ProjectConfig,
): BackendExperimentSummary {
  return BackendExperimentSummarySchema.parse({
    id: experiment.id,
    project: experiment.project,
    resource: portableReadmeResource(project, experiment.path),
    mtime: experiment.mtime,
    readmeMtime: experiment.readmeMtime,
    frontMatter: { ...experiment.frontMatter },
    sections: { ...experiment.sections },
    warningsRaw: experiment.warningsRaw,
    parseErrors: experiment.parseErrors,
    parseWarnings: experiment.parseWarnings,
    effectiveCreatedAt: experiment.frontMatter.createdAt,
    effectiveUpdatedAt: experiment.frontMatter.updatedAt,
  })
}

function runReadmeResource(
  project: ProjectConfig,
  run: Run,
): ReturnType<typeof ResourceIdSchema.parse> {
  return portableReadmeResource(project, join(run.path, 'README.md'))
}

function portableReadmeResource(
  project: ProjectConfig,
  absolutePath: string,
): ReturnType<typeof ResourceIdSchema.parse> {
  return portableProjectResource(project, absolutePath)
}

function portableProjectResource(
  project: ProjectConfig,
  absolutePath: string,
): ReturnType<typeof ResourceIdSchema.parse> {
  const portable = relative(project.root, absolutePath).split(sep).join('/')
  const parsed = ResourceIdSchema.safeParse(portable)
  if (!parsed.success) {
    throw new BackendProjectServiceError('RESOURCE_NOT_FOUND', 'README is outside Project')
  }
  return parsed.data
}

function portableRunResource(
  runRoot: string,
  absolutePath: string,
): ReturnType<typeof ResourceIdSchema.parse> {
  return ResourceIdSchema.parse(relative(runRoot, absolutePath).split(sep).join('/'))
}

function normalizePortableResultResource(value: string): string {
  return value.startsWith('./') ? value.slice(2) : value
}

/** Resolve only declared/cited eligibility flags, never hydrated Run records. */
async function experimentRunEligibility(
  project: ProjectConfig,
  experiment: Experiment,
  walk: () => Promise<readonly string[]>,
): Promise<{ deprecatedRuns: string[]; variantEligibility: ResultsVariantEligibility[] }> {
  const results = experiment.documents?.results.data ?? null
  let deprecatedRuns: string[]
  try {
    deprecatedRuns = await withAutomaticProjectFileContext(() =>
      deprecatedRunIds(
        project,
        [
          ...experiment.frontMatter.runs,
          ...(results?.variants.flatMap((variant) => [...variant.runs, ...variant.attempts]) ?? []),
        ],
        walk,
      ),
    )
  } catch {
    throw new BackendProjectServiceError(
      'INVALID_RESOURCE',
      'Run eligibility metadata could not be read',
    )
  }
  return {
    deprecatedRuns,
    variantEligibility: projectResultsRunEligibility(results, deprecatedRuns),
  }
}

/**
 * Deprecated ids among `ids` (declared paths or legacy base names), from Run
 * summaries validated on every call (one stat per Run when unchanged). A
 * missing Run or README is not deprecated; unreadable or malformed
 * eligibility metadata throws. The Run walk runs only when a base name needs it.
 */
async function deprecatedRunIds(
  project: ProjectConfig,
  ids: readonly string[],
  walk: () => Promise<readonly string[]>,
): Promise<string[]> {
  if (ids.length === 0) return []
  const wanted = new Set(ids)
  const summaries = await mapWithConcurrency(
    [...wanted],
    ELIGIBILITY_CONCURRENCY,
    async (reference) => {
      if (reference.includes('/')) return indexedDeclaredRun(project, reference, 0)
      const matches = (await walk()).filter((path) => basename(path) === reference)
      if (matches.length > 1) throw new Error(`Ambiguous Run ID: ${reference}`)
      return matches[0] === undefined ? null : indexedRun(project, matches[0], 0)
    },
  )
  const deprecated: string[] = []
  for (const summary of summaries) {
    if (!summary) continue
    if (summary.eligibilityError !== null) throw new Error(summary.eligibilityError)
    if (!summary.run.hasReadme || !summary.run.frontMatter.deprecated) continue
    const path = projectRunPath(project.root, summary.run.path)
    if (wanted.has(path)) deprecated.push(path)
    if (wanted.has(basename(summary.run.path))) deprecated.push(basename(summary.run.path))
  }
  return [...new Set(deprecated)].sort()
}

const ELIGIBILITY_CONCURRENCY = 16

function safeManagedDocuments(
  experiment: Experiment,
  project: ProjectConfig,
  variantEligibility: ResultsVariantEligibility[],
) {
  const documents = experiment.documents
  if (!documents) return null
  return {
    implementation: {
      kind: 'implementation' as const,
      fileName: documents.implementation.fileName,
      resource: portableProjectResource(project, documents.implementation.path),
      exists: documents.implementation.exists,
      data: documents.implementation.data
        ? {
            schemaVersion: documents.implementation.data.schemaVersion,
            items: documents.implementation.data.items.map(safeImplementationItem),
          }
        : null,
      parseErrors: documents.implementation.parseErrors,
      parseWarnings: documents.implementation.parseWarnings,
    },
    investigation: {
      kind: 'investigation' as const,
      fileName: documents.investigation.fileName,
      resource: portableProjectResource(project, documents.investigation.path),
      exists: documents.investigation.exists,
      data: documents.investigation.data
        ? {
            schemaVersion: documents.investigation.data.schemaVersion,
            items: documents.investigation.data.items.map(safeInvestigationItem),
          }
        : null,
      parseErrors: documents.investigation.parseErrors,
      parseWarnings: documents.investigation.parseWarnings,
    },
    results: {
      kind: 'results' as const,
      fileName: documents.results.fileName,
      resource: portableProjectResource(project, documents.results.path),
      exists: documents.results.exists,
      data: documents.results.data ? safeResultsDocument(documents.results.data) : null,
      parseErrors: documents.results.parseErrors,
      parseWarnings: documents.results.parseWarnings,
      variantEligibility,
    },
  }
}

function safeImplementationItem(item: ImplementationItem): Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    ...(item.description === undefined ? {} : { description: item.description }),
    dependsOn: item.dependsOn,
    acceptanceCriteria: item.acceptanceCriteria,
    files: item.files.map(normalizePortableResultResource),
    commits: item.commits.map(({ repo, sha, url }) => ({
      repo,
      sha,
      ...(url === undefined ? {} : { url }),
    })),
    codeReviews: item.codeReviews.map(normalizePortableResultResource),
    ...(item.outcome === undefined ? {} : { outcome: item.outcome }),
    children: item.children.map(safeImplementationItem),
  }
}

function safeInvestigationItem(item: InvestigationItem): Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    ...(item.description === undefined ? {} : { description: item.description }),
    dependsOn: item.dependsOn,
    ...(item.question === undefined ? {} : { question: item.question }),
    ...(item.rationale === undefined ? {} : { rationale: item.rationale }),
    successCriteria: item.successCriteria,
    variantIds: item.variantIds,
    ...(item.outcome === undefined ? {} : { outcome: item.outcome }),
    children: item.children.map(safeInvestigationItem),
  }
}

function safeResultsDocument(document: ResultsDocument) {
  return {
    schemaVersion: document.schemaVersion,
    ...(document.columnAnnotations === undefined
      ? {}
      : { columnAnnotations: document.columnAnnotations }),
    columns: document.columns,
    variants: document.variants.map(({ extra: _extra, provenance, ...variant }) => ({
      ...variant,
      ...(provenance
        ? {
            provenance: {
              ...provenance,
              ...(provenance.entry
                ? { entry: normalizePortableResultResource(provenance.entry) }
                : {}),
              ...(provenance.recipe
                ? { recipe: normalizePortableResultResource(provenance.recipe) }
                : {}),
            },
          }
        : {}),
    })),
  }
}

async function managedResultsUpdatedAt(
  results: NonNullable<Experiment['documents']>['results'] | undefined,
): Promise<string | null> {
  if (!results?.exists) return null
  const stat = await missingOrThrow(fs.stat(results.path))
  return stat?.mtime.toISOString() ?? null
}

/** In-flight bound for the wiki projection's cited-Run resolution and reads. */
const WIKI_RUN_READ_CONCURRENCY = 8

/** `Promise.all(items.map(fn))` with at most `limit` calls in flight; order kept. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
