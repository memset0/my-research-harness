import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import {
  appendJournalEvent,
  applyWarningOp,
  discoverExperiments,
  EXPERIMENT_DIR_REGEX,
  emptyImplementationDocument,
  emptyInvestigationDocument,
  emptyResultsDocument,
  formatIsoLocal,
  generateRowId,
  nextExperimentId,
  type ProjectConfig,
  parseExperimentReadme,
  parseReadme,
  ResourceIdSchema,
  reserializeReadme,
  scanProjectRoot,
  serializeExperimentReadme,
  serializeImplementationYaml,
  serializeInvestigationYaml,
  serializeResultsYaml,
  WarningOpError,
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
  journalChanged: boolean
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
  appendJournal(
    project: string,
    input: { tag: string; body: string },
  ): Promise<{ appended: { timestamp: string; tag: string; body: string } }>
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
  private async run(project: ProjectConfig, projectName: string, id: string) {
    const snapshot = await scanProjectRoot(project.root, { includeArchived: true, projectName })
    const run = snapshot.experiments.find((candidate) => candidate.id === id)
    if (!run) throw new BackendMutationError('RESOURCE_NOT_FOUND', 'Run not found')
    return run
  }
  private async experiment(project: ProjectConfig, projectName: string, id: string) {
    const experiment = (await discoverExperiments(project.root, projectName)).experiments.find(
      (candidate) => candidate.id === id,
    )
    if (!experiment) throw new BackendMutationError('RESOURCE_NOT_FOUND', 'Experiment not found')
    return experiment
  }
  async setRunStatus(projectName: string, id: string, input: StatusMutationInput) {
    const project = this.project(projectName)
    const snapshot = await scanProjectRoot(project.root, { includeArchived: true, projectName })
    const run = snapshot.experiments.find((x) => x.id === id)
    if (!run) throw new BackendMutationError('RESOURCE_NOT_FOUND', 'Run not found')
    const path = join(run.path, 'README.md')
    return this.mutate(
      path,
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
      (result) =>
        `STATUS \`${id}\` ${result.prevStatus ?? ''} → ${result.nextStatus ?? input.status}`,
      true,
    )
  }
  async setRunArchived(projectName: string, id: string, input: ArchiveMutationInput) {
    const project = this.project(projectName)
    const snapshot = await scanProjectRoot(project.root, { includeArchived: true, projectName })
    const run = snapshot.experiments.find((x) => x.id === id)
    if (!run) throw new BackendMutationError('RESOURCE_NOT_FOUND', 'Run not found')
    const path = join(run.path, 'README.md')
    return this.mutate(
      path,
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
      `ARCHIVE \`${id}\` op=${input.archived ? 'archive' : 'unarchive'}`,
      true,
    )
  }
  async setExperimentStatus(projectName: string, id: string, input: StatusMutationInput) {
    const project = this.project(projectName)
    const found = (await discoverExperiments(project.root, projectName)).experiments.find(
      (x) => x.id === id,
    )
    if (!found) throw new BackendMutationError('RESOURCE_NOT_FOUND', 'Experiment not found')
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
      (result) =>
        `EXP_STATUS \`${id}\` ${result.prevStatus ?? ''} → ${result.nextStatus ?? input.status}`,
    )
  }
  async setExperimentArchived(projectName: string, id: string, input: ArchiveMutationInput) {
    const project = this.project(projectName)
    const found = (await discoverExperiments(project.root, projectName)).experiments.find(
      (x) => x.id === id,
    )
    if (!found) throw new BackendMutationError('RESOURCE_NOT_FOUND', 'Experiment not found')
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
      `ARCHIVE \`${id}\` op=${input.archived ? 'archive' : 'unarchive'}`,
    )
  }
  async writeRunReadme(projectName: string, id: string, input: ReadmeMutationInput) {
    const project = this.project(projectName)
    const run = await this.run(project, projectName, id)
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
        return {
          ok: true as const,
          mtime: error.current.mtime,
          hash: error.current.hash,
          finalContent: error.current.content,
          journalChanged: false,
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
    try {
      await atomicReplace(path, finalContent)
      if (prevStatus !== nextStatus) {
        await appendJournalEvent({
          path: join(project.root, 'docs', 'journal.md'),
          event: {
            timestamp: formatIsoLocal(this.now()),
            tag: 'STATUS',
            body: `\`${id}\` ${prevStatus} → ${nextStatus}`,
          },
        })
      }
      if (prevArchived !== nextArchived) {
        await appendJournalEvent({
          path: join(project.root, 'docs', 'journal.md'),
          event: {
            timestamp: formatIsoLocal(this.now()),
            tag: 'ARCHIVE',
            body: `\`${id}\` op=${nextArchived ? 'archive' : 'unarchive'}`,
          },
        })
      }
    } catch (error) {
      await atomicReplace(path, lock.content).catch(() => undefined)
      throw error
    }
    const stat = await fs.stat(path)
    return {
      ok: true as const,
      mtime: stat.mtimeMs,
      hash: sha1(finalContent),
      finalContent,
      ...(prevStatus !== nextStatus ? { prevStatus, nextStatus } : {}),
      ...(prevArchived ? { warning: 'archived' as const } : {}),
      journalChanged: prevStatus !== nextStatus || prevArchived !== nextArchived,
    }
  }
  async writeExperimentReadme(projectName: string, id: string, input: ReadmeMutationInput) {
    const project = this.project(projectName)
    const experiment = await this.experiment(project, projectName, id)
    const lock = await readLockedDocument(experiment.path, input.expectedMtime, input.expectedHash)
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
    try {
      await atomicReplace(experiment.path, finalContent)
      await appendJournalEvent({
        path: join(project.root, 'docs', 'journal.md'),
        event: {
          timestamp: formatIsoLocal(this.now()),
          tag: 'EXPERIMENT',
          body: `\`${id}\` op=edit`,
        },
      })
      if (prevStatus !== nextStatus) {
        await appendJournalEvent({
          path: join(project.root, 'docs', 'journal.md'),
          event: {
            timestamp: formatIsoLocal(this.now()),
            tag: 'EXP_STATUS',
            body: `\`${id}\` ${prevStatus} → ${nextStatus}`,
          },
        })
      }
    } catch (error) {
      await atomicReplace(experiment.path, lock.content).catch(() => undefined)
      throw error
    }
    const stat = await fs.stat(experiment.path)
    return {
      ok: true as const,
      mtime: stat.mtimeMs,
      hash: sha1(finalContent),
      finalContent,
      ...(prevStatus !== nextStatus ? { prevStatus, nextStatus } : {}),
      ...(previous.frontMatter.archived ? { warning: 'archived' as const } : {}),
      journalChanged: true,
    }
  }
  async appendJournal(projectName: string, input: { tag: string; body: string }) {
    const project = this.project(projectName)
    if (input.tag === 'DIGEST')
      throw new BackendMutationError('FORBIDDEN', 'DIGEST append is forbidden')
    const timestamp = formatIsoLocal(this.now())
    await appendJournalEvent({
      path: join(project.root, 'docs', 'journal.md'),
      event: { timestamp, tag: input.tag, body: input.body },
    })
    return { appended: { timestamp, tag: input.tag, body: input.body } }
  }

  async createExperiment(projectName: string, input: ExperimentCreateInput) {
    const project = this.project(projectName)
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

    let importedRun: Awaited<ReturnType<typeof scanProjectRoot>>['experiments'][number] | null =
      null
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
          runs: unsuccessful ? [] : [importedRun.id],
          attempts: unsuccessful ? [importedRun.id] : [],
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
          runs: importedRun ? [importedRun.id] : [],
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
      try {
        await Promise.all([
          fs.writeFile(readmePath, content, { encoding: 'utf8', flag: 'wx' }),
          fs.writeFile(
            join(directory, 'implementation.yaml'),
            serializeImplementationYaml(emptyImplementationDocument()),
            { encoding: 'utf8', flag: 'wx' },
          ),
          fs.writeFile(
            join(directory, 'investigation.yaml'),
            serializeInvestigationYaml(emptyInvestigationDocument()),
            { encoding: 'utf8', flag: 'wx' },
          ),
          fs.writeFile(join(directory, 'results.yaml'), serializeResultsYaml(initialResults), {
            encoding: 'utf8',
            flag: 'wx',
          }),
        ])
        if (importedRun && importedLock) {
          const parsedRun = parseReadme(importedLock.content)
          parsedRun.frontMatter.experiment = id
          parsedRun.frontMatter.updatedAt = timestamp
          await atomicReplace(join(importedRun.path, 'README.md'), reserializeReadme(parsedRun))
        }
        await appendJournalEvent({
          path: join(project.root, 'docs', 'journal.md'),
          event: {
            timestamp,
            tag: 'EXPERIMENT',
            body: `\`${id}\` op=create slug=${input.slug}`,
          },
        })
      } catch (error) {
        if (importedRun && importedLock) {
          await atomicReplace(join(importedRun.path, 'README.md'), importedLock.content).catch(
            () => undefined,
          )
        }
        await fs.rm(directory, { recursive: true, force: true })
        throw error
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
    const parsedRun = parseReadme(runLock.content)
    if (
      operation === 'link' &&
      parsedRun.frontMatter.experiment &&
      parsedRun.frontMatter.experiment !== id
    ) {
      throw new BackendMutationError('BAD_STATE', 'Run already belongs to another Experiment')
    }
    const timestamp = formatIsoLocal(this.now())
    parsedExperiment.frontMatter.runs =
      operation === 'link'
        ? [...new Set([...parsedExperiment.frontMatter.runs, run.id])]
        : parsedExperiment.frontMatter.runs.filter((runId) => runId !== run.id)
    if (operation === 'link' || parsedRun.frontMatter.experiment === id) {
      parsedRun.frontMatter.experiment = operation === 'link' ? id : null
      parsedRun.frontMatter.updatedAt = timestamp
    }
    parsedExperiment.frontMatter.updatedAt = timestamp
    const nextRun = reserializeReadme(parsedRun)
    const nextExperiment = serializeExperimentReadme({
      frontMatter: parsedExperiment.frontMatter,
      sections: parsedExperiment.sections,
      warningsRaw: parsedExperiment.warningsRaw,
      rawBody: parsedExperiment.body,
    })
    try {
      await atomicReplace(runPath, nextRun)
      await atomicReplace(experiment.path, nextExperiment)
      await appendJournalEvent({
        path: join(project.root, 'docs', 'journal.md'),
        event: {
          timestamp,
          tag: 'BIND',
          body: `\`${id}\` op=${operation} run=${run.id}`,
        },
      })
    } catch (error) {
      await Promise.allSettled([
        atomicReplace(runPath, runLock.content),
        atomicReplace(experiment.path, experimentLock.content),
      ])
      throw error
    }
    const [runStat, experimentStat] = await Promise.all([
      fs.stat(runPath),
      fs.stat(experiment.path),
    ])
    return {
      ok: true as const,
      experimentId: id,
      runId: run.id,
      experimentMtime: experimentStat.mtimeMs,
      experimentHash: sha1(nextExperiment),
      runMtime: runStat.mtimeMs,
      runHash: sha1(nextRun),
    }
  }

  async deleteExperiment(projectName: string, id: string, input: ExperimentDeleteInput) {
    const project = this.project(projectName)
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
    const affected: Array<{
      path: string
      lock: LockedDocument
      next: string
      id: string
    }> = []
    for (const memberId of memberIds) {
      const run = await this.run(project, projectName, memberId)
      const lockInput = lockMap.get(memberId)
      if (!lockInput) throw new BackendMutationError('BAD_REQUEST', 'Exact Run locks are required')
      const path = join(run.path, 'README.md')
      const lock = await readLockedDocument(path, lockInput.expectedMtime, lockInput.expectedHash)
      const parsed = parseReadme(lock.content)
      if (parsed.frontMatter.experiment === id) {
        parsed.frontMatter.experiment = null
        parsed.frontMatter.updatedAt = formatIsoLocal(this.now())
      }
      affected.push({ path, lock, next: reserializeReadme(parsed), id: memberId })
    }
    if (lockMap.size !== memberIds.length) {
      throw new BackendMutationError('BAD_REQUEST', 'Run locks must match member Runs exactly')
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
    let quarantined = false
    try {
      for (const run of affected) await atomicReplace(run.path, run.next)
      await fs.rename(target, quarantine)
      quarantined = true
      await appendJournalEvent({
        path: join(project.root, 'docs', 'journal.md'),
        event: {
          timestamp: formatIsoLocal(this.now()),
          tag: 'EXPERIMENT',
          body: `\`${id}\` op=delete cascaded-runs=${JSON.stringify(memberIds)}`,
        },
      })
    } catch (error) {
      if (quarantined) await fs.rename(quarantine, target).catch(() => undefined)
      await Promise.allSettled(affected.map((run) => atomicReplace(run.path, run.lock.content)))
      throw error
    }
    await fs.rm(quarantine, { recursive: true, force: true }).catch(() => undefined)
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
    let path: string
    if (kind === 'run') {
      const snapshot = await scanProjectRoot(project.root, { includeArchived: true, projectName })
      const run = snapshot.experiments.find((x) => x.id === id)
      if (!run) throw new BackendMutationError('RESOURCE_NOT_FOUND', 'Run not found')
      path = join(run.path, 'README.md')
    } else {
      const exp = (await discoverExperiments(project.root, projectName)).experiments.find(
        (x) => x.id === id,
      )
      if (!exp) throw new BackendMutationError('RESOURCE_NOT_FOUND', 'Experiment not found')
      path = exp.path
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
    try {
      await atomicReplace(path, next.content)
      const changed = next.after ?? next.deleted ?? next.before
      await appendJournalEvent({
        path: join(project.root, 'docs', 'journal.md'),
        event: {
          timestamp: created,
          tag: 'WARNING',
          body: `\`${id}\` op=${input.op} rowId=${next.rowId ?? input.rowId ?? changed?.rowId ?? rowId} run=${changed?.run ?? input.run ?? 'null'}${input.category ? ` category=${input.category}` : ''}${input.message ? ` message=${quoteJournal(input.message)}` : ''}${input.note ? ` note=${quoteJournal(input.note)}` : ''}`,
        },
      })
    } catch (error) {
      await atomicReplace(path, content).catch(() => undefined)
      throw error
    }
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
      const snapshot = await scanProjectRoot(project.root, { includeArchived: true, projectName })
      const run = snapshot.experiments.find((x) => x.id === id)
      if (!run) throw new BackendMutationError('RESOURCE_NOT_FOUND', 'Run not found')
      path = join(run.path, 'README.md')
    } else {
      const exp = (await discoverExperiments(project.root, projectName)).experiments.find(
        (x) => x.id === id,
      )
      if (!exp) throw new BackendMutationError('RESOURCE_NOT_FOUND', 'Experiment not found')
      path = exp.path
    }
    const [content, stat] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
    const parsed = kind === 'run' ? parseReadme(content) : parseExperimentReadme(content, id)
    return {
      warnings: parsed.warnings,
      mtime: stat.mtimeMs,
      hash: createHash('sha1').update(content).digest('hex'),
    }
  }
  private async mutate(
    path: string,
    expectedMtime: number | undefined,
    expectedHash: string | undefined,
    transform: (content: string) => Promise<{ content: string | null; result: MutationResult }>,
    project: ProjectConfig,
    journal: string | ((result: MutationResult) => string),
    allowNoopWithStaleLock = false,
  ) {
    const [content, stat] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
    const hash = createHash('sha1').update(content).digest('hex')
    const next = await transform(content)
    if (next.content === null && allowNoopWithStaleLock) {
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
    if (next.content === null) return { ...next.result, mtime: stat.mtimeMs }
    const temp = join(dirname(path), `.memon-mutation-${process.pid}-${Date.now()}.tmp`)
    await fs.writeFile(temp, next.content, 'utf8')
    await fs.rename(temp, path)
    try {
      const journalEntry = typeof journal === 'function' ? journal(next.result) : journal
      await appendJournalEvent({
        path: join(project.root, 'docs', 'journal.md'),
        event: {
          timestamp: formatIsoLocal(this.now()),
          tag: journalEntry.split(' ')[0]!,
          body: journalEntry.slice(journalEntry.indexOf(' ') + 1),
        },
      })
    } catch (error) {
      const rollback = `${temp}.rollback`
      await fs.writeFile(rollback, content, 'utf8')
      await fs.rename(rollback, path)
      throw error
    }
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

function quoteJournal(value: string): string {
  return JSON.stringify(value)
}
