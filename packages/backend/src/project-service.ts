import { promises as fs } from 'node:fs'
import { join, relative, sep } from 'node:path'
import {
  BackendAnomaliesResponseSchema,
  BackendExperimentResponseSchema,
  BackendExperimentResultsResponseSchema,
  type BackendExperimentSummary,
  BackendExperimentSummarySchema,
  BackendExperimentsResponseSchema,
  BackendHypothesesResponseSchema,
  BackendJournalResponseSchema,
  BackendRunFilesResponseSchema,
  BackendRunResponseSchema,
  type BackendRunSummary,
  BackendRunsResponseSchema,
  computeMembership,
  discoverExperiments,
  type Experiment,
  type ProjectConfig,
  ResourceIdSchema,
  type Run,
  scanProjectRoot,
} from '@memon/core'

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

export interface BackendProjectReadService {
  listRuns(project: string): Promise<unknown>
  getRun(project: string, id: string): Promise<unknown>
  listExperiments(project: string): Promise<unknown>
  getExperiment(project: string, id: string): Promise<unknown>
  getExperimentResults(project: string, id: string): Promise<unknown>
  getRunFiles(project: string, id: string, depth: number): Promise<unknown>
  getHypotheses(project: string): Promise<unknown>
  getJournal(project: string): Promise<unknown>
  getAnomalies(project: string): Promise<unknown>
}

interface ProjectData {
  project: ProjectConfig
  runs: Awaited<ReturnType<typeof scanProjectRoot>>['experiments']
  runsById: ReadonlyMap<string, Awaited<ReturnType<typeof scanProjectRoot>>['experiments'][number]>
  experiments: Experiment[]
  experimentsById: ReadonlyMap<string, Experiment>
  membership: ReturnType<typeof computeMembership>
  hypotheses: Awaited<ReturnType<typeof scanProjectRoot>>['hypotheses']
  journal: Awaited<ReturnType<typeof scanProjectRoot>>['journal']
}

interface ProjectSnapshotState {
  data: ProjectData | null
  dirty: boolean
  generation: number
  refreshPromise: Promise<ProjectData> | null
  lastRefreshAt: string | null
  lastRefreshDurationMs: number | null
  lastError: string | null
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
  private readonly snapshots = new Map<string, ProjectSnapshotState>()

  constructor(projects: readonly ProjectConfig[]) {
    for (const project of projects) {
      if (this.projects.has(project.name)) throw new Error(`duplicate Project ${project.name}`)
      this.projects.set(project.name, project)
      this.snapshots.set(project.name, {
        data: null,
        dirty: true,
        generation: 0,
        refreshPromise: null,
        lastRefreshAt: null,
        lastRefreshDurationMs: null,
        lastError: null,
      })
    }
  }

  invalidateProject(projectName: string): void {
    this.requireSnapshot(projectName).dirty = true
  }

  async refreshProject(projectName: string): Promise<ProjectSnapshotInspection> {
    const state = this.requireSnapshot(projectName)
    state.dirty = true
    await this.refreshSnapshot(projectName, state)
    return this.inspectProject(projectName)
  }

  inspectProject(projectName: string): ProjectSnapshotInspection {
    const state = this.requireSnapshot(projectName)
    return {
      project: projectName,
      generation: state.generation,
      ready: state.data !== null,
      dirty: state.dirty,
      refreshing: state.refreshPromise !== null,
      runs: state.data?.runs.length ?? 0,
      experiments: state.data?.experiments.length ?? 0,
      lastRefreshAt: state.lastRefreshAt,
      lastRefreshDurationMs: state.lastRefreshDurationMs,
      lastError: state.lastError,
    }
  }

  async listRuns(projectName: string) {
    const data = await this.readProject(projectName)
    return BackendRunsResponseSchema.parse({
      runs: data.runs.map((run) => safeRunSummary(run, data.project)),
    })
  }

  async getRun(projectName: string, id: string) {
    const data = await this.readProject(projectName)
    const run = data.runsById.get(id)
    if (!run) throw new BackendProjectServiceError('RESOURCE_NOT_FOUND', 'Run not found')
    return BackendRunResponseSchema.parse({
      ...safeRunSummary(run, data.project),
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

  async listExperiments(projectName: string) {
    const data = await this.readProject(projectName)
    return BackendExperimentsResponseSchema.parse({
      experiments: data.experiments.map((experiment) => safeExperimentSummary(experiment, data)),
    })
  }

  async getExperiment(projectName: string, id: string) {
    const data = await this.readProject(projectName)
    const experiment = data.experimentsById.get(id)
    if (!experiment) {
      throw new BackendProjectServiceError('RESOURCE_NOT_FOUND', 'Experiment not found')
    }
    return BackendExperimentResponseSchema.parse({
      ...safeExperimentSummary(experiment, data),
      body: experiment.body,
      warningsRaw: experiment.warningsRaw,
    })
  }

  async getExperimentResults(projectName: string, id: string) {
    const data = await this.readProject(projectName)
    const experiment = data.experimentsById.get(id)
    if (!experiment) {
      throw new BackendProjectServiceError('RESOURCE_NOT_FOUND', 'Experiment not found')
    }
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
    return BackendExperimentResultsResponseSchema.parse({
      project: projectName,
      resource: portableProjectResource(data.project, results.path),
      document: {
        schemaVersion: results.data.schemaVersion,
        columns: results.data.columns,
        variants: results.data.variants.map(({ extra: _extra, provenance, ...variant }) => ({
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
      },
      updatedAt: fileStat.mtime.toISOString(),
      warnings: results.parseWarnings,
    })
  }

  async getRunFiles(projectName: string, id: string, depth: number) {
    const data = await this.readProject(projectName)
    const run = data.runsById.get(id)
    if (!run) throw new BackendProjectServiceError('RESOURCE_NOT_FOUND', 'Run not found')
    const runRoot = await fs.realpath(run.path)
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
      const realDirectory = await fs.realpath(absoluteDirectory).catch(() => null)
      if (
        !realDirectory ||
        (realDirectory !== runRoot && !realDirectory.startsWith(`${runRoot}${sep}`))
      ) {
        return null
      }
      const entries = await fs.readdir(realDirectory, { withFileTypes: true }).catch(() => [])
      const children: Array<Record<string, unknown>> = []
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (count >= 200) {
          truncated = true
          break
        }
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
        const child = join(realDirectory, entry.name)
        const childStat = await fs.lstat(child).catch(() => null)
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
      runId: run.id,
      resource: portableProjectResource(data.project, runRoot),
      depth,
      truncated,
      entries: count,
      tree: tree ?? { type: 'dir', resource: '.', children: [] },
    })
  }

  async getHypotheses(projectName: string) {
    const data = await this.readProject(projectName)
    const { path: _path, ...hypotheses } = data.hypotheses
    return BackendHypothesesResponseSchema.parse({ project: projectName, ...hypotheses })
  }

  async getJournal(projectName: string) {
    const data = await this.readProject(projectName)
    const { path: _path, events, ...journal } = data.journal
    return BackendJournalResponseSchema.parse({
      project: projectName,
      ...journal,
      events: [...events].reverse(),
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

  private requireSnapshot(projectName: string): ProjectSnapshotState {
    this.requireProject(projectName)
    return this.snapshots.get(projectName)!
  }

  private async readProject(projectName: string): Promise<ProjectData> {
    const state = this.requireSnapshot(projectName)
    if (state.data) {
      if (state.dirty && !state.refreshPromise) {
        void this.refreshSnapshot(projectName, state).catch(() => undefined)
      }
      return state.data
    }
    return this.refreshSnapshot(projectName, state)
  }

  private async refreshSnapshot(
    projectName: string,
    state: ProjectSnapshotState,
  ): Promise<ProjectData> {
    if (state.refreshPromise) return state.refreshPromise
    const startedAt = Date.now()
    const pending = this.buildProject(projectName)
    state.refreshPromise = pending
    try {
      const data = await pending
      state.data = data
      state.dirty = false
      state.generation += 1
      state.lastRefreshAt = new Date().toISOString()
      state.lastRefreshDurationMs = Date.now() - startedAt
      state.lastError = null
      return data
    } catch (error) {
      state.lastError = (error as Error).message
      throw error
    } finally {
      if (state.refreshPromise === pending) state.refreshPromise = null
    }
  }

  private async buildProject(projectName: string): Promise<ProjectData> {
    const project = this.requireProject(projectName)
    const [snapshot, experimentResult] = await Promise.all([
      scanProjectRoot(project.root, {
        includeArchived: true,
        projectName: project.name,
        include: project.include,
        exclude: project.exclude,
      }),
      discoverExperiments(project.root, project.name),
    ])
    const membership = computeMembership({
      experiments: experimentResult.experiments,
      runs: snapshot.experiments,
      project: project.name,
    })
    return {
      project,
      runs: snapshot.experiments,
      runsById: new Map(snapshot.experiments.map((run) => [run.id, run])),
      experiments: experimentResult.experiments,
      experimentsById: new Map(
        experimentResult.experiments.map((experiment) => [experiment.id, experiment]),
      ),
      membership,
      hypotheses: snapshot.hypotheses,
      journal: snapshot.journal,
    }
  }
}

function safeRunSummary(
  run: Run & { stale: boolean; archived: boolean },
  project: ProjectConfig,
): BackendRunSummary {
  const frontMatter = run.frontMatter
  return BackendRunsResponseSchema.shape.runs.element.parse({
    id: run.id,
    project: run.project,
    resource: runReadmeResource(project, run),
    mtime: run.mtime,
    readmeMtime: run.readmeMtime,
    hasReadme: run.hasReadme,
    stale: run.stale,
    archived: run.archived,
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
    },
    parseErrors: run.parseErrors,
    parseWarnings: run.parseWarnings,
  })
}

function safeExperimentSummary(
  experiment: Experiment,
  data: ProjectData,
): BackendExperimentSummary {
  const memberIds = data.membership.confirmedMembers.get(experiment.id) ?? []
  const members = memberIds.flatMap((id) => {
    const run = data.runsById.get(id)
    if (!run) return []
    return [
      {
        id: run.id,
        resource: runReadmeResource(data.project, run),
        status: run.frontMatter.status,
        archived: run.frontMatter.archived,
        createdAt: run.frontMatter.createdAt,
        updatedAt: run.frontMatter.updatedAt,
        finishedAt: run.frontMatter.finishedAt,
        host: run.frontMatter.host,
        gpus: run.frontMatter.gpus,
        wandb: run.frontMatter.wandb,
        artifacts: run.sections.artifacts.flatMap((artifact) => {
          const path = ResourceIdSchema.safeParse(artifact.path)
          return path.success ? [{ path: path.data, description: artifact.description }] : []
        }),
      },
    ]
  })
  const created = [experiment.frontMatter.createdAt, ...members.map((run) => run.createdAt)].sort()
  const updated = [experiment.frontMatter.updatedAt, ...members.map((run) => run.updatedAt)].sort()
  return BackendExperimentSummarySchema.parse({
    id: experiment.id,
    project: experiment.project,
    resource: portableReadmeResource(data.project, experiment.path),
    mtime: experiment.mtime,
    readmeMtime: experiment.readmeMtime,
    frontMatter: { ...experiment.frontMatter },
    sections: { ...experiment.sections },
    warningsRaw: experiment.warningsRaw,
    parseErrors: experiment.parseErrors,
    parseWarnings: experiment.parseWarnings,
    effectiveCreatedAt: created[0] ?? experiment.frontMatter.createdAt,
    effectiveUpdatedAt: updated.at(-1) ?? experiment.frontMatter.updatedAt,
    memberRuns: members,
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
