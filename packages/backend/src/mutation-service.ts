// Backend adapter over the shared @memon/core mutation primitives.
//
// The primitives own every document change (and therefore the bytes every
// surface writes). This adapter owns what is Backend-specific: Project lookup
// and Run/Experiment resolution through the cached walks, the required
// optimistic-lock policy, one invocation receipt per call with typed
// file-change details, and the mapping of core `MutationError`s onto
// `BackendMutationError` with the messages the wire has always carried. All
// filesystem access goes through `projectFs`, so scheduling, containment and
// cache invalidation are unchanged.

import { join, relative, sep } from 'node:path'
import {
  createExperiment,
  declaredRunOwner,
  deleteExperiment,
  type FileChange,
  projectFs as fs,
  type JournalInvocationContext,
  type JournalInvocationDetail,
  JournalRecordingError,
  linkExperimentRun,
  MutationError,
  type MutationFs,
  mutateDocumentWarning,
  type ProjectConfig,
  parseExperimentReadme,
  parseReadme,
  ResourceIdSchema,
  type Run,
  readExperimentDoc,
  readRunDir,
  resolveRunReference,
  setExperimentArchived,
  setExperimentStatus,
  setRunArchiveState,
  setRunStatus,
  sha1,
  unlinkExperimentRun,
  withJournalInvocation,
  writeExperimentReadme,
  writeRunReadme,
} from '@memon/core'

/** `projectFs` is an `fs/promises`-compatible facade; it satisfies the port. */
const port = fs as unknown as MutationFs

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
    return { id, path: experiment.path }
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
        async (ctx) => {
          try {
            return await action(ctx)
          } catch (error) {
            throw toBackendError(error)
          }
        },
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
  /** Contribute typed file-change details, or mark the call a no-op. */
  private settle(
    project: ProjectConfig,
    ctx: JournalInvocationContext,
    changes: readonly FileChange[],
  ): void {
    if (changes.length === 0) ctx.markOutcome('noop')
    for (const change of changes) {
      ctx.addDetail(fileChange(project.root, change.path, change.before, change.after))
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
        const result = await setRunStatus({
          fs: port,
          now: this.now,
          readmePath: join(run.path, 'README.md'),
          status: input.status as never,
          lock: lockOf(input.expectedMtime, input.expectedHash),
        })
        this.settle(project, ctx, result.changes)
        return {
          ok: true as const,
          mtime: result.mtime,
          ...(result.changed ? {} : { unchanged: true }),
          prevStatus: result.prevStatus,
          nextStatus: result.nextStatus,
          ...(result.changed && result.archived ? { warning: 'archived' as const } : {}),
        } satisfies MutationResult
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
        const result = await setRunArchiveState({
          fs: port,
          now: this.now,
          readmePath: join(run.path, 'README.md'),
          archived: input.archived,
          lock: lockOf(input.expectedMtime),
        })
        this.settle(project, ctx, result.changes)
        return {
          ok: true as const,
          mtime: result.mtime,
          ...(result.changed ? {} : { unchanged: true }),
          archived: input.archived,
        } satisfies MutationResult
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
        const experiment = await this.experiment(project, projectName, id)
        ctx.addDetail({ kind: 'target', type: 'experiment', id })
        const result = await setExperimentStatus({
          fs: port,
          now: this.now,
          experiment,
          status: input.status as never,
          lock: lockOf(input.expectedMtime, input.expectedHash),
        })
        this.settle(project, ctx, result.changes)
        return {
          ok: true as const,
          mtime: result.mtime,
          ...(result.changed ? {} : { unchanged: true }),
          prevStatus: result.prevStatus,
          nextStatus: result.nextStatus,
        } satisfies MutationResult
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
        const experiment = await this.experiment(project, projectName, id)
        ctx.addDetail({ kind: 'target', type: 'experiment', id })
        const result = await setExperimentArchived({
          fs: port,
          now: this.now,
          experiment,
          archived: input.archived,
          lock: lockOf(input.expectedMtime),
        })
        this.settle(project, ctx, result.changes)
        return {
          ok: true as const,
          mtime: result.mtime,
          ...(result.changed ? {} : { unchanged: true }),
          archived: input.archived,
        } satisfies MutationResult
      },
    )
  }
  async writeRunReadme(projectName: string, id: string, input: ReadmeMutationInput) {
    const project = this.project(projectName)
    return this.record(project, 'run readme write', { run: id }, async (ctx) => {
      const run = await this.run(project, projectName, id)
      ctx.addDetail({ kind: 'target', type: 'run', id })
      // The Web editor contract: the server stamps `updated_at` and returns
      // the canonical `finalContent`.
      const result = await writeRunReadme({
        fs: port,
        now: this.now,
        readmePath: join(run.path, 'README.md'),
        content: input.content,
        updatedAt: 'stamp',
        lock: lockOf(input.expectedMtime, input.expectedHash),
      })
      if (!result.changed) {
        // The requested content is already on disk: the invocation happened
        // but changed nothing, which is a `noop` receipt, not a success.
        ctx.markOutcome('noop')
        return {
          ok: true as const,
          mtime: result.mtime,
          hash: result.hash,
          finalContent: result.finalContent,
          activityRecorded: false,
        }
      }
      this.settle(project, ctx, result.changes)
      return {
        ok: true as const,
        mtime: result.mtime,
        hash: result.hash,
        finalContent: result.finalContent,
        ...(result.prevStatus !== result.nextStatus
          ? { prevStatus: result.prevStatus!, nextStatus: result.nextStatus! }
          : {}),
        ...(result.prevArchived ? { warning: 'archived' as const } : {}),
        activityRecorded: true,
      }
    })
  }
  async writeExperimentReadme(projectName: string, id: string, input: ReadmeMutationInput) {
    const project = this.project(projectName)
    return this.record(project, 'experiment readme write', { experiment: id }, async (ctx) => {
      const experiment = await this.experiment(project, projectName, id)
      ctx.addDetail({ kind: 'target', type: 'experiment', id })
      const result = await writeExperimentReadme({
        fs: port,
        now: this.now,
        experiment,
        content: input.content,
        lock: lockOf(input.expectedMtime, input.expectedHash),
      })
      this.settle(project, ctx, result.changes)
      return {
        ok: true as const,
        mtime: result.mtime,
        hash: result.hash,
        finalContent: result.finalContent,
        ...(result.prevStatus !== result.nextStatus
          ? { prevStatus: result.prevStatus, nextStatus: result.nextStatus }
          : {}),
        ...(result.prevArchived ? { warning: 'archived' as const } : {}),
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
      async (ctx) => {
        let importedRun: Run | null = null
        if (input.fromRun) {
          importedRun = await this.run(project, projectName, input.fromRun)
          if (importedRun.frontMatter.experiment) {
            throw new BackendMutationError('BAD_STATE', 'Run already belongs to an Experiment')
          }
          if (input.fromRunExpectedMtime === undefined || input.fromRunExpectedHash === undefined) {
            throw new BackendMutationError('BAD_REQUEST', 'fromRun optimistic lock is required')
          }
        }
        const created = await createExperiment({
          fs: port,
          now: this.now,
          projectRoot: project.root,
          projectName,
          slug: input.slug,
          ...(input.title === undefined ? {} : { title: input.title }),
          hypotheses: input.hypotheses ?? [],
          tags: input.tags ?? [],
          importedRun,
          ...(importedRun
            ? {
                importedRunLock: lockOf(input.fromRunExpectedMtime, input.fromRunExpectedHash),
              }
            : {}),
        })
        ctx.addDetail({ kind: 'target', type: 'experiment', id: created.id })
        this.settle(project, ctx, created.changes)
        return {
          ok: true as const,
          id: created.id,
          resource: portableResource(project.root, created.readmePath),
          mtime: created.mtime,
          hash: created.hash,
        }
      },
    )
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
      async (ctx) => {
        const experiment = await this.experiment(project, projectName, id)
        const run = await this.run(project, projectName, input.run)
        const bind = operation === 'link' ? linkExperimentRun : unlinkExperimentRun
        const result = await bind({
          fs: port,
          now: this.now,
          projectRoot: project.root,
          experiment,
          run,
          lock: lockOf(input.expectedMtime, input.expectedHash),
          runLock: lockOf(input.expectedRunMtime, input.expectedRunHash),
        })
        ctx.addDetail({ kind: 'target', type: 'experiment', id })
        ctx.addDetail({ kind: 'target', type: 'run', id: run.id })
        this.settle(project, ctx, result.changes)
        // The Run README is locked (always, here) but never written: its
        // reported state is the one read under that lock.
        const runDocument = result.runDocument!
        return {
          ok: true as const,
          experimentId: id,
          runId: result.runPath,
          experimentMtime: result.mtime,
          experimentHash: result.hash,
          runMtime: runDocument.mtime,
          runHash: runDocument.hash,
        }
      },
    )
  }

  async deleteExperiment(projectName: string, id: string, input: ExperimentDeleteInput) {
    const project = this.project(projectName)
    return this.record(
      project,
      'experiment delete',
      { experiment: id, force: input.force },
      async (ctx) => {
        const experiment = await this.experiment(project, projectName, id)
        if (new Set(input.runLocks.map((lock) => lock.run)).size !== input.runLocks.length) {
          throw new BackendMutationError('BAD_REQUEST', 'Run locks contain duplicate ids')
        }
        const result = await deleteExperiment({
          fs: port,
          now: this.now,
          experiment,
          force: input.force,
          lock: lockOf(input.expectedMtime, input.expectedHash),
        })
        ctx.addDetail({ kind: 'target', type: 'experiment', id })
        this.settle(project, ctx, result.changes)
        return { ok: true as const, deletedId: id, cascadedRuns: result.cascadedRuns }
      },
    )
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
      async (ctx) => {
        const path = await this.warningPath(kind, project, projectName, id)
        const result = await mutateDocumentWarning({
          fs: port,
          now: this.now,
          path,
          op: input.op,
          ...(input.rowId === undefined ? {} : { rowId: input.rowId }),
          ...(input.category === undefined ? {} : { category: input.category }),
          ...(input.message === undefined ? {} : { message: input.message }),
          ...(input.note === undefined ? {} : { note: input.note }),
          run: input.run ?? null,
          lock: lockOf(input.expectedMtime, input.expectedHash),
        })
        ctx.addDetail({ kind: 'target', type: kind === 'run' ? 'run' : 'experiment', id })
        this.settle(project, ctx, result.changes)
        const parsed =
          kind === 'run' ? parseReadme(result.content) : parseExperimentReadme(result.content, id)
        return {
          ok: true as const,
          warnings: parsed.warnings,
          mtime: result.mtime,
          hash: result.hash,
          ...(result.rowId ? { rowId: result.rowId } : {}),
        }
      },
    )
  }
  async listWarnings(kind: 'run' | 'experiment', projectName: string, id: string) {
    const project = this.project(projectName)
    const path = await this.warningPath(kind, project, projectName, id)
    const [content, stat] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
    const parsed = kind === 'run' ? parseReadme(content) : parseExperimentReadme(content, id)
    return { warnings: parsed.warnings, mtime: stat.mtimeMs, hash: sha1(content) }
  }
  private async warningPath(
    kind: 'run' | 'experiment',
    project: ProjectConfig,
    projectName: string,
    id: string,
  ): Promise<string> {
    return kind === 'run'
      ? join((await this.run(project, projectName, id)).path, 'README.md')
      : (await this.experiment(project, projectName, id)).path
  }
}

/** A lock from optional fields; omitted fields are not checked. */
function lockOf(expectedMtime?: number, expectedHash?: string) {
  return {
    ...(expectedMtime === undefined ? {} : { expectedMtime }),
    ...(expectedHash ? { expectedHash } : {}),
  }
}

/**
 * Map a core `MutationError` onto the Backend's error with the messages the
 * wire has always carried. Anything else passes through unchanged.
 */
function toBackendError(error: unknown): unknown {
  if (!(error instanceof MutationError)) return error
  switch (error.code) {
    case 'CONFLICT':
      return new BackendMutationError('CONFLICT', 'Document changed', error.current)
    case 'NOT_FOUND':
      return new BackendMutationError(
        'RESOURCE_NOT_FOUND',
        error.reason === 'MISSING_DOCUMENT' ? 'Document not found' : error.message,
      )
    case 'BAD_REQUEST': {
      const message =
        error.reason === 'DUPLICATE_SLUG'
          ? 'Experiment slug already exists'
          : error.reason === 'SLUG_PREFIX_COLLISION'
            ? 'Experiment slug prefix collides'
            : error.reason === 'HAS_MEMBERS'
              ? 'Experiment has member Runs'
              : error.reason === 'HAS_SCRATCH'
                ? 'Experiment bundle contains scratch files'
                : error.message
      return new BackendMutationError('BAD_REQUEST', message)
    }
    case 'BAD_STATE':
      return error.reason === 'ALLOCATION_EXHAUSTED'
        ? new BackendMutationError('INTERNAL', 'Experiment id allocation failed')
        : new BackendMutationError(
            'BAD_STATE',
            error.reason === 'RUN_ALREADY_OWNED'
              ? 'Run already belongs to another Experiment'
              : error.message,
          )
    case 'FORBIDDEN':
      return new BackendMutationError(
        'FORBIDDEN',
        error.reason === 'ARCHIVED_RUNNING'
          ? 'Archived Run cannot become RUNNING'
          : 'RUNNING Run cannot be archived',
      )
    case 'WARNINGS_SECTION_NOT_TABLE':
      return new BackendMutationError('WARNINGS_SECTION_NOT_TABLE', error.message)
    default:
      return new BackendMutationError('INTERNAL', error.message)
  }
}

function portableResource(root: string, absolutePath: string): string {
  return ResourceIdSchema.parse(relative(root, absolutePath).split(sep).join('/'))
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
