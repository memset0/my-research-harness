import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, relative, sep } from 'node:path'
import {
  applyWarningOp,
  discoverExperiments,
  resolveRunReference,
  projectRunPath,
  declaredRunOwner,
  EXPERIMENT_DIR_REGEX,
  emptyImplementationDocument,
  emptyInvestigationDocument,
  emptyResultsDocument,
  formatIsoLocal,
  generateRowId,
  type JournalInvocationContext,
  type JournalInvocationDetail,
  JournalRecordingError,
  nextExperimentId,
  type ProjectConfig,
  parseExperimentReadme,
  parseReadme,
  projectFs as fs,
  readExperimentDoc,
  readRunDir,
  ResourceIdSchema,
  reserializeReadme,
  type Run,
  serializeExperimentReadme,
  serializeImplementationYaml,
  serializeInvestigationYaml,
  serializeResultsYaml,
  WarningOpError,
  withJournalInvocation,
} from '@memon/core'

const EXPERIMENTS_SUBDIR = 'docs/experiments'
const CANONICAL_EXPERIMENT_BUNDLE_FILES = new Set([
  'README.md',
  'implementation.yaml',
  'investigation.yaml',
  'results.yaml',
])

export class BackendMutationError extends Error {
  constructor(
    public readonly code:
      | 'PROJECT_NOT_FOUND'
      | 'RESOURCE_NOT_FOUND'
      | 'CONFLICT'
      | 'FORBIDDEN'
      | 'BAD_REQUEST'
      | 'BAD_STATE'
      | 'WARNINGS_SECTION_NOT_TABLE'
      | 'PARTIAL'
      | 'INTERNAL',
    message: string,
    public readonly current?: { mtime: number; hash: string; content: string },
  ) {
    super(message)
    this.name = 'BackendMutationError'
  }
}
export interface StatusMutationInput {
  status: string
  expectedMtime: number
  expectedHash?: string
}
export interface ArchiveMutationInput {
  archived: boolean
  expectedMtime?: number
}
export interface MutationResult {
  ok: true
  mtime: number
  unchanged?: boolean
  archived?: boolean
  prevStatus?: string
  nextStatus?: string
  warning?: 'archived'
}
export interface ReadmeMutationInput {
  content: string
  expectedMtime: number
  expectedHash: string
}
export interface ReadmeMutationResult {
  ok: true
  mtime: number
  hash: string
  finalContent: string
  prevStatus?: string
  nextStatus?: string
  warning?: 'archived'
  /**
   * True when this call changed the document and therefore recorded an
   * invocation receipt, so subscribers can refresh diagnostic history.
   */
  activityRecorded: boolean
}
export interface BackendMutationService {
  setRunStatus(project: string, id: string, input: StatusMutationInput): Promise<MutationResult>
  setRunArchived(project: string, id: string, input: ArchiveMutationInput): Promise<MutationResult>
  setExperimentStatus(
    project: string,
    id: string,
    input: StatusMutationInput,
  ): Promise<MutationResult>
  setExperimentArchived(
    project: string,
    id: string,
    input: ArchiveMutationInput,
  ): Promise<MutationResult>
  writeRunReadme(
    project: string,
    id: string,
    input: ReadmeMutationInput,
  ): Promise<ReadmeMutationResult>
  writeExperimentReadme(
    project: string,
    id: string,
    input: ReadmeMutationInput,
  ): Promise<ReadmeMutationResult>
  createExperiment(
    project: string,
    input: ExperimentCreateInput,
  ): Promise<{ ok: true; id: string; resource: string; mtime: number; hash: string }>
  bindExperiment(
    operation: 'link' | 'unlink',
    project: string,
    id: string,
    input: ExperimentBindInput,
  ): Promise<{
    ok: true
    experimentId: string
    runId: string
    experimentMtime: number
    experimentHash: string
    runMtime: number
    runHash: string
  }>
  deleteExperiment(
    project: string,
    id: string,
    input: ExperimentDeleteInput,
  ): Promise<{ ok: true; deletedId: string; cascadedRuns: string[] }>
  mutateWarning(
    kind: 'run' | 'experiment',
    project: string,
    id: string,
    input: {
      op: 'add' | 'resolve' | 'reopen' | 'delete'
      rowId?: string
      category?: string
      message?: string
      note?: string
      run?: string | null
      expectedMtime: number
      expectedHash: string
    },
  ): Promise<{ ok: true; warnings: unknown[]; mtime: number; hash: string; rowId?: string }>
  listWarnings(
    kind: 'run' | 'experiment',
    project: string,
    id: string,
  ): Promise<{ warnings: unknown[]; mtime: number; hash: string }>
}

export interface ExperimentCreateInput {
  slug: string
  title?: string
  hypotheses?: string[]
  tags?: string[]
  fromRun?: string | null
  fromRunExpectedMtime?: number
  fromRunExpectedHash?: string
}

export interface ExperimentBindInput {
  run: string
  expectedMtime: number
  expectedHash: string
  expectedRunMtime: number
  expectedRunHash: string
}

export interface ExperimentDeleteInput {
  force: boolean
  expectedMtime: number
  expectedHash: string
  runLocks: Array<{ run: string; expectedMtime: number; expectedHash: string }>
}

export class FilesystemMutationService implements BackendMutationService {
  private projects = new Map<string, ProjectConfig>()
  constructor(
    projects: readonly ProjectConfig[],
    private readonly now: () => Date = () => new Date(),
  ) {
    for (const p of projects) this.projects.set(p.name, p)
  }
  private project(name: string) {
    const p = this.projects.get(name)
    if (!p) throw new BackendMutationError('PROJECT_NOT_FOUND', 'Project not found')
    return p
  }
  /**
   * Locate one Run through the shared Run walk and read that Run alone. The
   * walk is the same cached directory composition the read services use —
   * configured `include`/`exclude` come from the Project — so resolving a
   * mutation target costs one README, never every Run's. When two entry
   * directories hold the same base name, only those duplicates are read and
   * the newest `created_at` wins, as the scan-ordered lookup did.
   */
  private async run(project: ProjectConfig, projectName: string, id: string): Promise<Run> {
    const path = await resolveRunReference(project, id)
    if (!path) throw new BackendMutationError('RESOURCE_NOT_FOUND', 'Run not found')
    const run = await readRunDir(path, projectName)
    run.frontMatter.experiment = await declaredRunOwner(project.root, path, projectName)
    return run
  }
  /**
   * One Experiment document, read by id. Resolving a mutation target must not
   * parse every other Experiment bundle; a folder with no README has no
   * document to mutate and is reported as not found.
   */
  private async experiment(project: ProjectConfig, projectName: string, id: string) {
    const experiment = await readExperimentDoc(project.root, projectName, id)
    if (!experiment) throw new BackendMutationError('RESOURCE_NOT_FOUND', 'Experiment not found')
    return experiment
  }
  /**
   * The invocation-ledger boundary for every non-readonly service call.
   *
   * One receipt per invocation, including the calls that fail, conflict or
   * change nothing: the Journal records that a mutating operation happened,
   * not only that an object changed. Helpers that run inside this scope join
   * the same receipt instead of opening a second one, so a cascade stays one
   * logical record. Parameters carry typed identities and enums only — never
   * document bodies, Warning prose or absolute machine paths.
   */
  private async record<T>(
    project: ProjectConfig,
    command: string,
    parameters: Record<string, unknown>,
    action: (ctx: JournalInvocationContext) => Promise<T>,
  ): Promise<T> {
    try {
      // `standalone` keeps one request = one receipt: a service request must
      // never be absorbed into some longer-lived scope that happens to be on
      // the async stack, and never becomes a parent for later requests.
      return await withJournalInvocation(
        project.root,
        { command, origin: 'web', parameters },
        action,
        { standalone: true },
      )
    } catch (error) {
      // The document change already landed and is deliberately NOT rolled
      // back for a logging failure. The caller must not be told this was a
      // clean success, so it surfaces as an explicit partial outcome.
      if (error instanceof JournalRecordingError) {
        throw new BackendMutationError(
          'PARTIAL',
          `${command} was applied but its invocation receipt is incomplete (${error.failure.message})`,
        )
      }
      throw error
    }
  }
  async setRunStatus(projectName: string, id: string, input: StatusMutationInput) {
    const project = this.project(projectName)
    return this.record(
      project,
      'run status set',
      { run: id, status: input.status },
      async (ctx) => {
        const run = await this.run(project, projectName, id)
        ctx.addDetail({ kind: 'target', type: 'run', id })
        return this.mutate(
          join(run.path, 'README.md'),
          input.expectedMtime,
          input.expectedHash,
          async (content) => {
            const doc = parseReadme(content)
            const prev = doc.frontMatter.status
            if (prev === input.status)
              return {
                content: null,
                result: {
                  ok: true,
                  mtime: 0,
                  unchanged: true,
                  prevStatus: prev,
                  nextStatus: prev,
                } as MutationResult,
              }
            if (input.status === 'RUNNING' && doc.frontMatter.archived)
              throw new BackendMutationError('FORBIDDEN', 'Archived Run cannot become RUNNING')
            const updatedAt = formatIsoLocal(this.now())
            doc.frontMatter.status = input.status as never
            doc.frontMatter.updatedAt = updatedAt
            if (
              (input.status === 'FINISHED' || input.status === 'FAILED') &&
              doc.frontMatter.finishedAt === null
            ) {
              doc.frontMatter.finishedAt = updatedAt
            }
            if (
              (input.status === 'RUNNING' || input.status === 'PENDING') &&
              doc.frontMatter.finishedAt !== null
            ) {
              doc.frontMatter.finishedAt = null
            }
            return {
              content: reserializeReadme(doc),
              result: {
                ok: true,
                mtime: 0,
                prevStatus: prev,
                nextStatus: input.status,
                ...(doc.frontMatter.archived ? { warning: 'archived' as const } : {}),
              },
            }
          },
          project,
          ctx,
          true,
        )
      },
    )
  }
  async setRunArchived(projectName: string, id: string, input: ArchiveMutationInput) {
    const project = this.project(projectName)
    return this.record(
      project,
      'run archive set',
      { run: id, archived: input.archived },
      async (ctx) => {
        const run = await this.run(project, projectName, id)
        ctx.addDetail({ kind: 'target', type: 'run', id })
        return this.mutate(
          join(run.path, 'README.md'),
          input.expectedMtime,
          undefined,
          async (content) => {
            const doc = parseReadme(content)
            if (doc.frontMatter.archived === input.archived)
              return {
                content: null,
                result: { ok: true, mtime: 0, unchanged: true, archived: input.archived },
              }
            if (input.archived && doc.frontMatter.status === 'RUNNING')
              throw new BackendMutationError('FORBIDDEN', 'RUNNING Run cannot be archived')
            doc.frontMatter.archived = input.archived
            doc.frontMatter.updatedAt = formatIsoLocal(this.now())
            return {
              content: reserializeReadme(doc),
              result: { ok: true, mtime: 0, archived: input.archived },
            }
          },
          project,
          ctx,
          true,
        )
      },
    )
  }
  async setExperimentStatus(projectName: string, id: string, input: StatusMutationInput) {
    const project = this.project(projectName)
    return this.record(
      project,
      'experiment status set',
      { experiment: id, status: input.status },
      async (ctx) => {
        const found = await this.experiment(project, projectName, id)
        ctx.addDetail({ kind: 'target', type: 'experiment', id })
        return this.mutate(
          found.path,
          input.expectedMtime,
          input.expectedHash,
          async (content) => {
            const doc = parseExperimentReadme(content, id)
            const prev = doc.frontMatter.status
            if (prev === input.status)
              return {
                content: null,
                result: { ok: true, mtime: 0, unchanged: true, prevStatus: prev, nextStatus: prev },
              }
            doc.frontMatter.status = input.status as never
            doc.frontMatter.updatedAt = formatIsoLocal(this.now())
            return {
              content: serializeExperimentReadme({
                frontMatter: doc.frontMatter,
                sections: doc.sections,
                warningsRaw: doc.warningsRaw,
                rawBody: doc.body,
              }),
              result: { ok: true, mtime: 0, prevStatus: prev, nextStatus: input.status },
            }
          },
          project,
          ctx,
        )
      },
    )
  }
  async setExperimentArchived(projectName: string, id: string, input: ArchiveMutationInput) {
    const project = this.project(projectName)
    return this.record(
      project,
      'experiment archive set',
      { experiment: id, archived: input.archived },
      async (ctx) => {
        const found = await this.experiment(project, projectName, id)
        ctx.addDetail({ kind: 'target', type: 'experiment', id })
        return this.mutate(
          found.path,
          input.expectedMtime,
          undefined,
          async (content) => {
            const doc = parseExperimentReadme(content, id)
            if (doc.frontMatter.archived === input.archived)
              return {
                content: null,
                result: { ok: true, mtime: 0, unchanged: true, archived: input.archived },
              }
            doc.frontMatter.archived = input.archived
            doc.frontMatter.updatedAt = formatIsoLocal(this.now())
            return {
              content: serializeExperimentReadme({
                frontMatter: doc.frontMatter,
                sections: doc.sections,
                warningsRaw: doc.warningsRaw,
                rawBody: doc.body,
              }),
              result: { ok: true, mtime: 0, archived: input.archived },
            }
          },
          project,
          ctx,
        )
      },
    )
  }
  async writeRunReadme(projectName: string, id: string, input: ReadmeMutationInput) {
    const project = this.project(projectName)
    return this.record(project, 'run readme write', { run: id }, async (ctx) => {
      const run = await this.run(project, projectName, id)
      ctx.addDetail({ kind: 'target', type: 'run', id })
      const path = join(run.path, 'README.md')
      let lock: LockedDocument
      try {
        lock = await readLockedDocument(path, input.expectedMtime, input.expectedHash)
      } catch (error) {
        if (
          error instanceof BackendMutationError &&
          error.code === 'CONFLICT' &&
          error.current?.content !== undefined &&
          canonicalRunSansUpdatedAt(input.content) ===
            canonicalRunSansUpdatedAt(error.current.content)
        ) {
          // The requested content is already on disk: the invocation happened
          // but changed nothing, which is a `noop` receipt, not a success.
          ctx.markOutcome('noop')
          return {
            ok: true as const,
            mtime: error.current.mtime,
            hash: error.current.hash,
            finalContent: error.current.content,
            activityRecorded: false,
          }
        }
        throw error
      }
      const previous = parseReadme(lock.content)
      const next = parseReadme(input.content)
      const prevStatus = previous.frontMatter.status
      const nextStatus = next.frontMatter.status
      const prevArchived = previous.frontMatter.archived
      const nextArchived = next.frontMatter.archived
      if (nextArchived && nextStatus === 'RUNNING') {
        throw new BackendMutationError('FORBIDDEN', 'RUNNING Run cannot be archived')
      }
      next.frontMatter.updatedAt = formatIsoLocal(this.now())
      const finalContent = reserializeReadme(next)
      // A single atomic replace either lands or leaves the file untouched, so
      // there is nothing to undo on failure — and no rollback that could
      // overwrite a concurrent writer's content.
      await atomicReplace(path, finalContent)
      ctx.addDetail(fileChange(project.root, path, lock.content, finalContent))
      const stat = await fs.stat(path)
      return {
        ok: true as const,
        mtime: stat.mtimeMs,
        hash: sha1(finalContent),
        finalContent,
        ...(prevStatus !== nextStatus ? { prevStatus, nextStatus } : {}),
        ...(prevArchived ? { warning: 'archived' as const } : {}),
        activityRecorded: true,
      }
    })
  }
  async writeExperimentReadme(projectName: string, id: string, input: ReadmeMutationInput) {
    const project = this.project(projectName)
    return this.record(project, 'experiment readme write', { experiment: id }, async (ctx) => {
      const experiment = await this.experiment(project, projectName, id)
      ctx.addDetail({ kind: 'target', type: 'experiment', id })
      const lock = await readLockedDocument(
        experiment.path,
        input.expectedMtime,
        input.expectedHash,
      )
      const previous = parseExperimentReadme(lock.content, id)
      const next = parseExperimentReadme(input.content, id)
      const prevStatus = previous.frontMatter.status
      const nextStatus = next.frontMatter.status
      next.frontMatter.updatedAt = formatIsoLocal(this.now())
      const finalContent = serializeExperimentReadme({
        frontMatter: next.frontMatter,
        sections: next.sections,
        warningsRaw: next.warningsRaw,
        rawBody: next.body,
      })
      await atomicReplace(experiment.path, finalContent)
      ctx.addDetail(fileChange(project.root, experiment.path, lock.content, finalContent))
      const stat = await fs.stat(experiment.path)
      return {
        ok: true as const,
        mtime: stat.mtimeMs,
        hash: sha1(finalContent),
        finalContent,
        ...(prevStatus !== nextStatus ? { prevStatus, nextStatus } : {}),
        ...(previous.frontMatter.archived ? { warning: 'archived' as const } : {}),
        activityRecorded: true,
      }
    })
  }

  async createExperiment(projectName: string, input: ExperimentCreateInput) {
    const project = this.project(projectName)
    return this.record(
      project,
      'experiment create',
      { slug: input.slug, ...(input.fromRun ? { fromRun: input.fromRun } : {}) },
      (ctx) => this.applyExperimentCreate(project, projectName, input, ctx),
    )
  }

  private async applyExperimentCreate(
    project: ProjectConfig,
    projectName: string,
    input: ExperimentCreateInput,
    ctx: JournalInvocationContext,
  ) {
    const existing = (await discoverExperiments(project.root, projectName)).experiments
    for (const experiment of existing) {
      if (experiment.frontMatter.slug === input.slug) {
        throw new BackendMutationError('BAD_REQUEST', 'Experiment slug already exists')
      }
      if (
        experiment.frontMatter.slug.startsWith(`${input.slug}-`) ||
        input.slug.startsWith(`${experiment.frontMatter.slug}-`)
      ) {
        throw new BackendMutationError('BAD_REQUEST', 'Experiment slug prefix collides')
      }
    }

    let importedRun: Run | null = null
    let importedLock: LockedDocument | null = null
    if (input.fromRun) {
      importedRun = await this.run(project, projectName, input.fromRun)
      if (importedRun.frontMatter.experiment) {
        throw new BackendMutationError('BAD_STATE', 'Run already belongs to an Experiment')
      }
      if (input.fromRunExpectedMtime === undefined || input.fromRunExpectedHash === undefined) {
        throw new BackendMutationError('BAD_REQUEST', 'fromRun optimistic lock is required')
      }
      importedLock = await readLockedDocument(
        join(importedRun.path, 'README.md'),
        input.fromRunExpectedMtime,
        input.fromRunExpectedHash,
      )
    }

    const experimentsDirectory = join(project.root, EXPERIMENTS_SUBDIR)
    await fs.mkdir(experimentsDirectory, { recursive: true })
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const prefix = await nextExperimentId(project.root)
      const id = `${prefix}-${input.slug}`
      if (!EXPERIMENT_DIR_REGEX.test(id)) {
        throw new BackendMutationError('INTERNAL', 'Experiment allocator returned invalid data')
      }
      const directory = join(experimentsDirectory, id)
      try {
        await fs.mkdir(directory)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
        throw error
      }

      const timestamp = formatIsoLocal(this.now())
      const readmePath = join(directory, 'README.md')
      const initialResults = emptyResultsDocument()
      if (importedRun) {
        const unsuccessful = ['FAILED', 'INTERRUPTED', 'UNKNOWN'].includes(
          importedRun.frontMatter.status,
        )
        initialResults.variants.push({
          id: 'V0001',
          name: `Imported ${importedRun.frontMatter.name || importedRun.id}`,
          status: importedVariantStatus(importedRun.frontMatter.status),
          description: 'Imported from an existing Run; refine this Variant before reuse.',
          parameters: {},
          metrics: {},
          runs: unsuccessful ? [] : [projectRunPath(project.root, importedRun.path)],
          attempts: unsuccessful ? [projectRunPath(project.root, importedRun.path)] : [],
          ...(importedRun.frontMatter.entry
            ? { provenance: { entry: importedRun.frontMatter.entry } }
            : {}),
        })
      }
      const content = serializeExperimentReadme({
        frontMatter: {
          id,
          slug: input.slug,
          title: input.title ?? input.slug,
          status: 'OPEN',
          archived: false,
          runs: importedRun ? [projectRunPath(project.root, importedRun.path)] : [],
          hypotheses: input.hypotheses ?? [],
          tags: input.tags ?? [],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        sections: {
          motivation: null,
          method: null,
          plan: null,
          conclusion: null,
          caveats: null,
        },
        warningsRaw: null,
      })
      const managed: Array<[string, string]> = [
        [readmePath, content],
        [
          join(directory, 'implementation.yaml'),
          serializeImplementationYaml(emptyImplementationDocument()),
        ],
        [
          join(directory, 'investigation.yaml'),
          serializeInvestigationYaml(emptyInvestigationDocument()),
        ],
        [join(directory, 'results.yaml'), serializeResultsYaml(initialResults)],
      ]
      const importedReadmePath = importedRun ? join(importedRun.path, 'README.md') : null
      let importedPostimage: string | null = null
      try {
        await Promise.all(
          managed.map(([file, body]) => fs.writeFile(file, body, { encoding: 'utf8', flag: 'wx' })),
        )
      } catch (error) {
        // Restore the imported Run only while it still holds exactly the
        // postimage this operation wrote. Another writer's content is never
        // overwritten to make a rollback look clean; that case is partial.
        const restored =
          importedLock && importedReadmePath && importedPostimage !== null
            ? await restorePostimage(importedReadmePath, importedPostimage, importedLock.content)
            : true
        await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined)
        if (!restored) {
          ctx.markOutcome('partial', 'ROLLBACK_BLOCKED')
          throw new BackendMutationError(
            'PARTIAL',
            'Experiment create failed and the imported Run could not be safely restored',
          )
        }
        throw error
      }
      ctx.addDetail({ kind: 'target', type: 'experiment', id })
      for (const [file, body] of managed) {
        ctx.addDetail(fileChange(project.root, file, null, body))
      }
      if (importedRun && importedLock && importedReadmePath && importedPostimage !== null) {
        ctx.addDetail({ kind: 'target', type: 'run', id: importedRun.id })
        ctx.addDetail(
          fileChange(project.root, importedReadmePath, importedLock.content, importedPostimage),
        )
      }
      const fileStat = await fs.stat(readmePath)
      return {
        ok: true as const,
        id,
        resource: portableResource(project.root, readmePath),
        mtime: fileStat.mtimeMs,
        hash: sha1(content),
      }
    }
    throw new BackendMutationError('INTERNAL', 'Experiment id allocation failed')
  }

  async bindExperiment(
    operation: 'link' | 'unlink',
    projectName: string,
    id: string,
    input: ExperimentBindInput,
  ) {
    const project = this.project(projectName)
    return this.record(
      project,
      `experiment ${operation}`,
      { experiment: id, run: input.run, operation },
      (ctx) => this.applyExperimentBind(operation, project, projectName, id, input, ctx),
    )
  }

  private async applyExperimentBind(
    operation: 'link' | 'unlink',
    project: ProjectConfig,
    projectName: string,
    id: string,
    input: ExperimentBindInput,
    ctx: JournalInvocationContext,
  ) {
    const experiment = await this.experiment(project, projectName, id)
    const run = await this.run(project, projectName, input.run)
    const experimentLock = await readLockedDocument(
      experiment.path,
      input.expectedMtime,
      input.expectedHash,
    )
    const runPath = join(run.path, 'README.md')
    const runLock = await readLockedDocument(runPath, input.expectedRunMtime, input.expectedRunHash)
    const parsedExperiment = parseExperimentReadme(experimentLock.content, id)
    if (operation === 'link' && run.frontMatter.experiment && run.frontMatter.experiment !== id) {
      throw new BackendMutationError('BAD_STATE', 'Run already belongs to another Experiment')
    }
    const timestamp = formatIsoLocal(this.now())
    parsedExperiment.frontMatter.runs =
      operation === 'link'
        ? [
            ...new Set([
              ...parsedExperiment.frontMatter.runs.filter((reference) => reference !== run.id),
              projectRunPath(project.root, run.path),
            ]),
          ]
        : parsedExperiment.frontMatter.runs.filter(
            (runId) => runId !== projectRunPath(project.root, run.path) && runId !== run.id,
          )
    parsedExperiment.frontMatter.updatedAt = timestamp
    const nextRun = runLock.content
    const nextExperiment = serializeExperimentReadme({
      frontMatter: parsedExperiment.frontMatter,
      sections: parsedExperiment.sections,
      warningsRaw: parsedExperiment.warningsRaw,
      rawBody: parsedExperiment.body,
    })
    try {
      await atomicReplace(experiment.path, nextExperiment)
    } catch (error) {
      // Each file is restored only while it still holds this operation's
      // postimage. A file that moved on underneath us is left alone and the
      // caller is told the bind is partial instead of all-or-nothing.
      const restored = await Promise.all([
        restorePostimage(experiment.path, nextExperiment, experimentLock.content),
      ])
      if (restored.includes(false)) {
        ctx.markOutcome('partial', 'ROLLBACK_BLOCKED')
        throw new BackendMutationError(
          'PARTIAL',
          `Experiment ${operation} failed and its documents could not be safely restored`,
        )
      }
      throw error
    }
    ctx.addDetail({ kind: 'target', type: 'experiment', id })
    ctx.addDetail({ kind: 'target', type: 'run', id: run.id })
    ctx.addDetail(fileChange(project.root, experiment.path, experimentLock.content, nextExperiment))
    const [runStat, experimentStat] = await Promise.all([
      fs.stat(runPath),
      fs.stat(experiment.path),
    ])
    return {
      ok: true as const,
      experimentId: id,
      runId: projectRunPath(project.root, run.path),
      experimentMtime: experimentStat.mtimeMs,
      experimentHash: sha1(nextExperiment),
      runMtime: runStat.mtimeMs,
      runHash: sha1(nextRun),
    }
  }

  async deleteExperiment(projectName: string, id: string, input: ExperimentDeleteInput) {
    const project = this.project(projectName)
    return this.record(
      project,
      'experiment delete',
      { experiment: id, force: input.force },
      (ctx) => this.applyExperimentDelete(project, projectName, id, input, ctx),
    )
  }

  private async applyExperimentDelete(
    project: ProjectConfig,
    projectName: string,
    id: string,
    input: ExperimentDeleteInput,
    ctx: JournalInvocationContext,
  ) {
    const experiment = await this.experiment(project, projectName, id)
    const experimentLock = await readLockedDocument(
      experiment.path,
      input.expectedMtime,
      input.expectedHash,
    )
    const parsedExperiment = parseExperimentReadme(experimentLock.content, id)
    const memberIds = [...parsedExperiment.frontMatter.runs]
    if (!input.force && memberIds.length > 0) {
      throw new BackendMutationError('BAD_REQUEST', 'Experiment has member Runs')
    }
    const lockMap = new Map(input.runLocks.map((lock) => [lock.run, lock]))
    if (lockMap.size !== input.runLocks.length) {
      throw new BackendMutationError('BAD_REQUEST', 'Run locks contain duplicate ids')
    }

    const target = experiment.path.endsWith(`${id}.md`) ? experiment.path : dirname(experiment.path)
    if (!input.force && target !== experiment.path) {
      const siblings = (await fs.readdir(target)).filter(
        (name) => !CANONICAL_EXPERIMENT_BUNDLE_FILES.has(name),
      )
      if (siblings.length > 0) {
        throw new BackendMutationError('BAD_REQUEST', 'Experiment bundle contains scratch files')
      }
    }
    const quarantine = join(dirname(target), `.memon-delete-${id}-${randomUUID()}`)
    await fs.rename(target, quarantine)
    await fs.rm(quarantine, { recursive: true, force: true }).catch(() => undefined)
    ctx.addDetail({ kind: 'target', type: 'experiment', id })
    ctx.addDetail(fileChange(project.root, experiment.path, experimentLock.content, null))
    return { ok: true as const, deletedId: id, cascadedRuns: memberIds }
  }
  async mutateWarning(
    kind: 'run' | 'experiment',
    projectName: string,
    id: string,
    input: {
      op: 'add' | 'resolve' | 'reopen' | 'delete'
      rowId?: string
      category?: string
      message?: string
      note?: string
      run?: string | null
      expectedMtime: number
      expectedHash: string
    },
  ) {
    const project = this.project(projectName)
    // Warning message/note prose is document content, never receipt metadata:
    // only the operation, target identity, row id and category are recorded.
    return this.record(
      project,
      `${kind} warning ${input.op}`,
      {
        [kind]: id,
        op: input.op,
        ...(input.rowId ? { rowId: input.rowId } : {}),
        ...(input.category ? { category: input.category } : {}),
        ...(input.run ? { run: input.run } : {}),
      },
      (ctx) => this.applyWarningMutation(kind, project, projectName, id, input, ctx),
    )
  }

  private async applyWarningMutation(
    kind: 'run' | 'experiment',
    project: ProjectConfig,
    projectName: string,
    id: string,
    input: {
      op: 'add' | 'resolve' | 'reopen' | 'delete'
      rowId?: string
      category?: string
      message?: string
      note?: string
      run?: string | null
      expectedMtime: number
      expectedHash: string
    },
    ctx: JournalInvocationContext,
  ) {
    let path: string
    if (kind === 'run') {
      path = join((await this.run(project, projectName, id)).path, 'README.md')
    } else {
      path = (await this.experiment(project, projectName, id)).path
    }
    const [content, stat] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
    const hash = createHash('sha1').update(content).digest('hex')
    if (stat.mtimeMs !== input.expectedMtime || hash !== input.expectedHash)
      throw new BackendMutationError('CONFLICT', 'Document changed', {
        mtime: stat.mtimeMs,
        hash,
        content,
      })
    const created = formatIsoLocal(this.now())
    const rowId = input.rowId ?? generateRowId(created)
    const op =
      input.op === 'add'
        ? {
            op: 'add' as const,
            category: input.category ?? 'other',
            message: input.message ?? '',
            created,
            rowId,
            run: input.run ?? null,
          }
        : input.op === 'resolve'
          ? { op: 'resolve' as const, rowId, resolved: created, note: input.note ?? '' }
          : input.op === 'reopen'
            ? { op: 'reopen' as const, rowId }
            : { op: 'delete' as const, rowId }
    let next: ReturnType<typeof applyWarningOp>
    try {
      next = applyWarningOp(content, op)
    } catch (error) {
      if (error instanceof WarningOpError) {
        if (error.code === 'NOT_FOUND') {
          throw new BackendMutationError('RESOURCE_NOT_FOUND', error.message)
        }
        if (error.code === 'NOT_TABLE') {
          throw new BackendMutationError('WARNINGS_SECTION_NOT_TABLE', error.message)
        }
        throw new BackendMutationError('BAD_REQUEST', error.message)
      }
      throw error
    }
    await atomicReplace(path, next.content)
    ctx.addDetail({ kind: 'target', type: kind === 'run' ? 'run' : 'experiment', id })
    ctx.addDetail(fileChange(project.root, path, content, next.content))
    const nextStat = await fs.stat(path)
    const parsed =
      kind === 'run' ? parseReadme(next.content) : parseExperimentReadme(next.content, id)
    return {
      ok: true as const,
      warnings: parsed.warnings,
      mtime: nextStat.mtimeMs,
      hash: createHash('sha1').update(next.content).digest('hex'),
      ...(next.rowId ? { rowId: next.rowId } : {}),
    }
  }
  async listWarnings(kind: 'run' | 'experiment', projectName: string, id: string) {
    const project = this.project(projectName)
    let path: string
    if (kind === 'run') {
      path = join((await this.run(project, projectName, id)).path, 'README.md')
    } else {
      path = (await this.experiment(project, projectName, id)).path
    }
    const [content, stat] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
    const parsed = kind === 'run' ? parseReadme(content) : parseExperimentReadme(content, id)
    return {
      warnings: parsed.warnings,
      mtime: stat.mtimeMs,
      hash: createHash('sha1').update(content).digest('hex'),
    }
  }
  /**
   * Read-modify-write one document under the caller's optimistic lock, inside
   * the caller's ledger invocation. A no-op is marked as such (the invocation
   * still happened), a stale lock throws `CONFLICT`, and a successful write
   * contributes its typed file change to the receipt. Receipt persistence is
   * the ledger's job and never rolls this write back.
   */
  private async mutate(
    path: string,
    expectedMtime: number | undefined,
    expectedHash: string | undefined,
    transform: (content: string) => Promise<{ content: string | null; result: MutationResult }>,
    project: ProjectConfig,
    ctx: JournalInvocationContext,
    allowNoopWithStaleLock = false,
  ) {
    const [content, stat] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
    const hash = createHash('sha1').update(content).digest('hex')
    const next = await transform(content)
    if (next.content === null && allowNoopWithStaleLock) {
      ctx.markOutcome('noop')
      return { ...next.result, mtime: stat.mtimeMs }
    }
    if (
      (expectedMtime !== undefined && stat.mtimeMs !== expectedMtime) ||
      (expectedHash && hash !== expectedHash)
    )
      throw new BackendMutationError('CONFLICT', 'Document changed', {
        mtime: stat.mtimeMs,
        hash,
        content,
      })
    if (next.content === null) {
      ctx.markOutcome('noop')
      return { ...next.result, mtime: stat.mtimeMs }
    }
    const temp = join(dirname(path), `.memon-mutation-${process.pid}-${Date.now()}.tmp`)
    await fs.writeFile(temp, next.content, 'utf8')
    await fs.rename(temp, path)
    ctx.addDetail(fileChange(project.root, path, content, next.content))
    return { ...next.result, mtime: (await fs.stat(path)).mtimeMs }
  }
}

interface LockedDocument {
  content: string
  mtime: number
  hash: string
}

function sha1(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

function canonicalRunSansUpdatedAt(content: string): string {
  const parsed = parseReadme(content)
  parsed.frontMatter.updatedAt = ''
  return reserializeReadme(parsed)
}

async function readLockedDocument(
  path: string,
  expectedMtime: number,
  expectedHash: string,
): Promise<LockedDocument> {
  const [content, stat] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
  const hash = sha1(content)
  if (stat.mtimeMs !== expectedMtime || hash !== expectedHash) {
    throw new BackendMutationError('CONFLICT', 'Document changed', {
      mtime: stat.mtimeMs,
      hash,
      content,
    })
  }
  return { content, mtime: stat.mtimeMs, hash }
}

async function atomicReplace(path: string, content: string): Promise<void> {
  const original = await fs.stat(path)
  const temporary = join(dirname(path), `.memon-${process.pid}-${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', mode: original.mode })
    await fs.rename(temporary, path)
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined)
    throw error
  }
}

function portableResource(root: string, absolutePath: string): string {
  return ResourceIdSchema.parse(relative(root, absolutePath).split(sep).join('/'))
}

function importedVariantStatus(status: string) {
  switch (status) {
    case 'FINISHED':
      return 'COMPLETED' as const
    case 'RUNNING':
      return 'RUNNING' as const
    case 'FAILED':
    case 'INTERRUPTED':
      return 'FAILED' as const
    case 'UNKNOWN':
      return 'INCONCLUSIVE' as const
    default:
      return 'PLANNED' as const
  }
}

/**
 * One typed file-change detail: the project-relative path plus the sha1 of the
 * observed pre- and postimages. `null` marks an absent image (a created or
 * removed file), never a guessed one.
 */
function fileChange(
  root: string,
  absolutePath: string,
  preimage: string | null,
  postimage: string | null,
): JournalInvocationDetail {
  return {
    kind: 'file-change',
    path: relative(root, absolutePath).split(sep).join('/'),
    before: preimage === null ? null : sha1(preimage),
    after: postimage === null ? null : sha1(postimage),
  }
}

/**
 * Restore one file to its preimage, but only while it still holds exactly the
 * postimage this operation wrote. A file that an intervening writer changed is
 * left untouched and reported as an unsafe rollback, so a failed mutation can
 * never overwrite someone else's edit to look atomic.
 */
async function restorePostimage(
  path: string,
  postimage: string,
  preimage: string,
): Promise<boolean> {
  const current = await fs.readFile(path, 'utf8').catch(() => null)
  if (current === preimage) return true
  if (current !== postimage) return false
  try {
    await atomicReplace(path, preimage)
    return true
  } catch {
    return false
  }
}
