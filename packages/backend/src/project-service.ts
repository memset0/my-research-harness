import { basename, join, relative, sep } from 'node:path'
import {
  BackendAnomaliesResponseSchema,
  BackendExperimentResponseSchema,
  BackendExperimentResultsResponseSchema,
  type BackendExperimentSummary,
  BackendExperimentSummarySchema,
  BackendExperimentsResponseSchema,
  BackendHypothesesResponseSchema,
  BackendJournalHistoryResponseSchema,
  BackendJournalResponseSchema,
  type BackendResourceInventoryItem,
  BackendResourceInventoryResponseSchema,
  BackendRunFilesResponseSchema,
  BackendRunResponseSchema,
  type BackendRunSummary,
  BackendRunsResponseSchema,
  buildExperimentDocumentView,
  computeMembership,
  declaredRunOwner,
  discoverExperiments,
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
  listDeprecatedRunIds,
  listExperimentIds,
  listExperimentPaths,
  type MembershipResult,
  matchesRunDeprecationFilter,
  type ParsedHypotheses,
  type ProjectConfig,
  parseHypotheses,
  projectResultsRunEligibility,
  projectRunPath,
  ResourceIdSchema,
  type ResultsDocument,
  type ResultsVariantEligibility,
  type Run,
  readExperimentDoc,
  readJournalActivity,
  readProjectJournal,
  readRunDir,
  resolveDeclaredRunPath,
  resolveRunReference,
  runArchivedFromRun,
  scanProjectRoot,
} from '@memon/core'
import type {
  BackendWikiArtifactOptions,
  BackendWikiArtifactReferences,
  BackendWikiArtifacts,
} from './document-service.js'
import { missingOrThrow } from './missing-path.js'
import { withAutomaticProjectFileContext } from './project-file-context.js'

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

export interface BackendProjectReadService {
  listRuns(
    project: string,
    filter?: RunCollectionFilter,
    options?: InventoryListOptions,
  ): Promise<unknown>
  getRun(project: string, id: string): Promise<unknown>
  listExperiments(project: string, options?: InventoryListOptions): Promise<unknown>
  getExperiment(project: string, id: string): Promise<unknown>
  getExperimentResults(project: string, id: string): Promise<unknown>
  getRunFiles(project: string, id: string, depth: number): Promise<unknown>
  getHypotheses(project: string): Promise<unknown>
  getJournal(project: string): Promise<unknown>
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

  constructor(projects: readonly ProjectConfig[]) {
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
    return withAutomaticProjectFileContext(async () => {
      const hypothesesPath = join(project.root, 'docs', 'hypotheses.md')
      const [experimentIds, content, hypothesesStat] = await Promise.all([
        listExperimentIds(project.root),
        missingOrThrow(fs.readFile(hypothesesPath, 'utf8')),
        missingOrThrow(fs.stat(hypothesesPath)),
      ])

      // A citation may name an Experiment by its numeric id alone; resolution
      // then picks the first document with that prefix, as the projection does.
      const cited: string[] = []
      for (const numericId of references.experiments) {
        const id = experimentIds.find((candidate) => candidate.slice(0, 5) === numericId)
        if (id !== undefined) cited.push(id)
      }
      const experiments = (
        await Promise.all(cited.map((id) => readExperimentDoc(project.root, project.name, id)))
      ).filter((experiment): experiment is Experiment => experiment !== null)

      // A cited Experiment's effective updated time joins its members', so those
      // Runs — and only those — are read alongside the directly cited ones.
      const wantedRuns = new Set(references.runs)
      for (const experiment of experiments) {
        for (const runId of experiment.frontMatter.runs) wantedRuns.add(runId)
      }
      // One directory walk serves everything below. Resolving each bare
      // reference through `resolveRunReference` would walk the Run roots once
      // per citation in parallel, which overflowed the project I/O channel on
      // a project with a thousand Runs. A caller may supply a shared inventory
      // of that walk instead of paying for a fresh one.
      const walkedPaths = options.runPaths
        ? await options.runPaths()
        : await discoverRuns(project, { includeArchived: true })
      const byBasename = new Map<string, string[]>()
      for (const path of walkedPaths) {
        const name = basename(path)
        byBasename.set(name, [...(byBasename.get(name) ?? []), path])
      }
      // Cited Runs are resolved and read a few at a time: a list citing busy
      // Experiments reads a thousand READMEs, and launching them all at once
      // queues every other request's file operations behind them.
      const wantedPaths = await mapWithConcurrency(
        [...wantedRuns],
        WIKI_RUN_READ_CONCURRENCY,
        async (reference) => {
          if (reference.includes('/')) {
            try {
              return await resolveDeclaredRunPath(project.root, reference)
            } catch {
              return null
            }
          }
          // An ambiguous or unknown base name is an unresolved citation, not a
          // failed listing.
          const candidates = byBasename.get(reference) ?? []
          return candidates.length === 1 ? candidates[0]! : null
        },
      )
      const runs = await mapWithConcurrency(
        wantedPaths.filter((path): path is string => path !== null),
        WIKI_RUN_READ_CONCURRENCY,
        async (path) => {
          const run = await readRunDir(path, project.name)
          return { ...run, id: projectRunPath(project.root, path) }
        },
      )
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
        hypothesesMtime: hypothesesStat?.mtimeMs ?? null,
        hypothesisIds:
          content === null ? [] : parseHypotheses(content).entries.map((entry) => entry.id),
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
    options: InventoryListOptions = {},
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
            slug: id.replace(/-\d{6}-\d{6}$/, ''),
            resource: portableProjectResource(project, join(path, 'README.md')),
          }
        }),
      })
    }
    const data = await this.readProject(projectName)
    return BackendRunsResponseSchema.parse({
      runs: data.runs
        .filter((run) => matchesRunDeprecationFilter(run.deprecated, filter))
        .map((run) => safeRunSummary(run, data.project)),
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
    if (options.inventoryOnly) {
      const paths = await withAutomaticProjectFileContext(() => listExperimentPaths(project.root))
      return BackendResourceInventoryResponseSchema.parse({
        items: [...paths].map(([id, resource]) => ({
          id,
          slug: id.slice('E0000-'.length),
          resource: ResourceIdSchema.parse(resource),
        })),
      })
    }
    const { experiments } = await discoverExperiments(project.root, project.name)
    return BackendExperimentsResponseSchema.parse({
      experiments: experiments.map((experiment) => safeExperimentSummary(experiment, project)),
    })
  }

  /**
   * The Experiment bundle plus read-time deprecation metadata for its roster.
   * Run bodies and logs arrive only from explicit Run endpoints.
   */
  async getExperiment(projectName: string, id: string) {
    const project = this.requireProject(projectName)
    const experiment = await this.readExperimentDocument(project, id)
    const eligibility = await experimentRunEligibility(project, experiment)
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
    const eligibility = await experimentRunEligibility(project, experiment)
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
    const runPath = await resolveRunReference(project, id)
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

  /** Depends on `docs/hypotheses.md` alone. */
  async getHypotheses(projectName: string) {
    const project = this.requireProject(projectName)
    const content = await missingOrThrow(
      fs.readFile(join(project.root, 'docs', 'hypotheses.md'), 'utf8'),
    )
    const hypotheses = content === null ? EMPTY_HYPOTHESES : parseHypotheses(content)
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
    const path = await withAutomaticProjectFileContext(() => resolveRunReference(project, id))
    if (!path) throw new BackendProjectServiceError('RESOURCE_NOT_FOUND', 'Run not found')
    const run = await readRunDir(path, project.name)
    run.frontMatter.experiment = await withAutomaticProjectFileContext(() =>
      declaredRunOwner(project.root, path, project.name),
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
    const [snapshot, experimentResult] = await Promise.all([
      scanProjectRoot(project.root, {
        // The composition is the full Run set on purpose: membership must see
        // a deprecated Run to avoid reporting it as a phantom reference, and
        // `listRuns` applies the research default on top of this.
        includeArchived: true,
        includeDeprecated: true,
        projectName: project.name,
        include: project.include,
        exclude: project.exclude,
      }),
      discoverExperiments(project.root, project.name),
    ])
    const legacyCounts = new Map<string, number>()
    for (const run of snapshot.experiments)
      legacyCounts.set(run.id, (legacyCounts.get(run.id) ?? 0) + 1)
    for (const run of snapshot.experiments) {
      const path = projectRunPath(project.root, run.path)
      const owners = experimentResult.experiments.filter(
        (experiment) =>
          experiment.frontMatter.runs.includes(path) ||
          (legacyCounts.get(run.id) === 1 && experiment.frontMatter.runs.includes(run.id)),
      )
      run.frontMatter.experiment = owners.length === 1 ? owners[0]!.id : null
    }
    return {
      project,
      runs: snapshot.experiments,
      runsById: new Map(
        snapshot.experiments.map((run) => [projectRunPath(project.root, run.path), run]),
      ),
      experiments: experimentResult.experiments,
      membership: computeMembership({
        experiments: experimentResult.experiments,
        runs: snapshot.experiments,
        project: project.name,
        projectRoot: project.root,
      }),
    }
  }
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
): Promise<{ deprecatedRuns: string[]; variantEligibility: ResultsVariantEligibility[] }> {
  const results = experiment.documents?.results.data ?? null
  let deprecatedRuns: string[]
  try {
    deprecatedRuns = await withAutomaticProjectFileContext(() =>
      listDeprecatedRunIds(project.root, {
        projectName: project.name,
        include: project.include,
        exclude: project.exclude,
        ids: [
          ...experiment.frontMatter.runs,
          ...(results?.variants.flatMap((variant) => [...variant.runs, ...variant.attempts]) ?? []),
        ],
      }),
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
