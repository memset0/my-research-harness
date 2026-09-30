import { relative, resolve, sep } from 'node:path'
import {
  BackendCodePreviewResponseSchema,
  BackendCommitMarkDeleteResponseSchema,
  BackendCommitMarksResponseSchema,
  BackendCommitMarkWriteResponseSchema,
  BackendGitBranchesResponseSchema,
  BackendGitCommitResponseSchema,
  BackendGitDiffResponseSchema,
  BackendGitLogResponseSchema,
  BackendGitRangeResponseSchema,
  BackendGitRefSchema,
  BackendGitStatusFilesResponseSchema,
  BackendGitStatusResponseSchema,
  BackendGitSubmodulesResponseSchema,
  deleteCommitMark,
  projectFs as fs,
  type GitCommandRunner,
  type GitFileStatus,
  type ProjectConfig,
  parseGithubPermalink,
  ResourceIdSchema,
  readCommitMarks,
  readGitBranches,
  readGitCommit,
  readGitFileContents,
  readGitLog,
  readGitRange,
  readGitStatus,
  readGitStatusFiles,
  readGitSubmodules,
  setCommitMark,
  sliceContext,
} from '@memon/core'
import {
  BackendExecutionError,
  type BackendExecutionProvider,
  type BackendExecutionResolver,
  gitCommandRunnerFor,
  resolveProjectExecution,
} from './execution-service.js'

export class BackendGitServiceError extends Error {
  constructor(
    public readonly code:
      | 'PROJECT_NOT_FOUND'
      | 'INVALID_RESOURCE'
      | 'RESOURCE_NOT_FOUND'
      /** The Project has no execution target; routes answer 501. */
      | 'EXECUTION_UNAVAILABLE',
    message: string,
  ) {
    super(message)
    this.name = 'BackendGitServiceError'
  }
}

export interface GitRepoSelector {
  submodule?: string
}

export interface GitLogInput extends GitRepoSelector {
  ref: string
  limit: number
}

export interface GitRangeInput extends GitRepoSelector {
  from: string
  to: string
}

export type GitDiffInput = GitRepoSelector & {
  path: string
  side: 'staged' | 'unstaged' | 'untracked' | 'commit' | 'range'
  sha?: string
  from?: string
  to?: string
}

export interface CommitMarkWriteInput extends GitRepoSelector {
  status: 'verified' | 'suspicious' | 'issue'
  note?: string
}

export interface BackendGitService {
  status(project: string): Promise<unknown>
  statusFiles(project: string, selector: GitRepoSelector): Promise<unknown>
  branches(project: string, selector: GitRepoSelector): Promise<unknown>
  log(project: string, input: GitLogInput): Promise<unknown>
  commit(project: string, sha: string, selector: GitRepoSelector): Promise<unknown>
  range(project: string, input: GitRangeInput): Promise<unknown>
  diff(project: string, input: GitDiffInput): Promise<unknown>
  submodules(project: string): Promise<unknown>
  codePreview(project: string, url: string): Promise<unknown>
  commitMarks(project: string): Promise<unknown>
  setCommitMark(project: string, sha: string, input: CommitMarkWriteInput): Promise<unknown>
  deleteCommitMark(project: string, sha: string, selector: GitRepoSelector): Promise<unknown>
}

export interface FilesystemGitServiceOptions {
  /** Standalone-only compatibility for Config-owned paths already guarded by legacy adapters. */
  trustedConfiguredPaths?: boolean
  /**
   * Resolves where a Project's git commands run. Defaults to the Project's own
   * `execution` configuration; a Project without one refuses rather than
   * running git against a locally mounted working copy that belongs to another
   * machine.
   */
  execution?: BackendExecutionResolver
}

interface ResolvedRepo {
  cwd: string
  submodule: string
  /**
   * Command runner for this repo, or `undefined` for local execution, which
   * keeps core's own `execFile` path byte for byte.
   */
  exec: GitCommandRunner | undefined
}

export class FilesystemGitService implements BackendGitService {
  private readonly projects = new Map<string, ProjectConfig>()
  private readonly trustedConfiguredPaths: boolean
  private readonly resolveExecution: BackendExecutionResolver

  constructor(projects: readonly ProjectConfig[], options: FilesystemGitServiceOptions = {}) {
    for (const project of projects) {
      if (this.projects.has(project.name)) throw new Error(`duplicate Project ${project.name}`)
      this.projects.set(project.name, project)
    }
    this.trustedConfiguredPaths = options.trustedConfiguredPaths ?? false
    this.resolveExecution = options.execution ?? resolveProjectExecution
  }

  async status(projectName: string) {
    const project = this.requireProject(projectName)
    return BackendGitStatusResponseSchema.parse(
      redactFailure(await readGitStatus(project.root, { exec: this.runner(project) })),
    )
  }

  async statusFiles(projectName: string, selector: GitRepoSelector) {
    const repo = await this.resolveRepo(this.requireProject(projectName), selector.submodule)
    const result = redactFailure(await readGitStatusFiles(repo.cwd, { exec: repo.exec }))
    return BackendGitStatusFilesResponseSchema.parse(
      result.enabled
        ? {
            ...result,
            staged: result.staged.map(normalizeGitFileEntry),
            unstaged: result.unstaged.map(normalizeGitFileEntry),
            untracked: result.untracked.map(normalizeGitFileEntry),
          }
        : result,
    )
  }

  async branches(projectName: string, selector: GitRepoSelector) {
    const repo = await this.resolveRepo(this.requireProject(projectName), selector.submodule)
    return BackendGitBranchesResponseSchema.parse(
      redactFailure(await readGitBranches(repo.cwd, { exec: repo.exec })),
    )
  }

  async log(projectName: string, input: GitLogInput) {
    const repo = await this.resolveRepo(this.requireProject(projectName), input.submodule)
    const ref = validateRef(input.ref)
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000) invalid()
    return BackendGitLogResponseSchema.parse(
      redactFailure(await readGitLog(repo.cwd, { ref, limit: input.limit }, { exec: repo.exec })),
    )
  }

  async commit(projectName: string, shaInput: string, selector: GitRepoSelector) {
    const repo = await this.resolveRepo(this.requireProject(projectName), selector.submodule)
    return BackendGitCommitResponseSchema.parse(
      redactFailure(await readGitCommit(repo.cwd, validateRef(shaInput), { exec: repo.exec })),
    )
  }

  async range(projectName: string, input: GitRangeInput) {
    const repo = await this.resolveRepo(this.requireProject(projectName), input.submodule)
    const result = redactFailure(
      await readGitRange(
        repo.cwd,
        { from: validateRef(input.from), to: validateRef(input.to) },
        { exec: repo.exec },
      ),
    )
    return BackendGitRangeResponseSchema.parse(
      result.enabled ? { ...result, submodule: repo.submodule } : result,
    )
  }

  async diff(projectName: string, input: GitDiffInput) {
    const repo = await this.resolveRepo(this.requireProject(projectName), input.submodule)
    const path = ResourceIdSchema.safeParse(input.path)
    if (!path.success) invalid()
    if (input.side === 'unstaged' || input.side === 'untracked') {
      await assertExistingTargetWithin(repo.cwd, resolve(repo.cwd, path.data))
    }

    let oldRef: string | null
    let newRef: string | null
    let defaultStatus: GitFileStatus
    switch (input.side) {
      case 'staged':
        oldRef = 'HEAD'
        newRef = 'index'
        defaultStatus = 'modified'
        break
      case 'unstaged':
        oldRef = 'index'
        newRef = 'working'
        defaultStatus = 'modified'
        break
      case 'untracked':
        oldRef = null
        newRef = 'working'
        defaultStatus = 'untracked'
        break
      case 'commit': {
        const sha = validateRef(input.sha ?? '')
        oldRef = `${sha}^`
        newRef = sha
        defaultStatus = 'modified'
        break
      }
      case 'range':
        oldRef = validateRef(input.from ?? '')
        newRef = validateRef(input.to ?? '')
        defaultStatus = 'modified'
        break
    }

    const [oldResult, newResult] = await Promise.all([
      oldRef
        ? readGitFileContents(repo.cwd, oldRef, path.data, { exec: repo.exec })
        : Promise.resolve(null),
      newRef
        ? readGitFileContents(repo.cwd, newRef, path.data, { exec: repo.exec })
        : Promise.resolve(null),
    ])
    let oldContent: string | null = null
    let newContent: string | null = null
    let status: GitFileStatus = defaultStatus
    if (oldResult) {
      if (oldResult.ok) oldContent = oldResult.content
      else if (oldResult.reason === 'not-found') {
        oldContent = ''
        status = 'added'
      } else return BackendGitDiffResponseSchema.parse(diffFailure(oldResult, 'old'))
    }
    if (newResult) {
      if (newResult.ok) newContent = newResult.content
      else if (newResult.reason === 'not-found') {
        newContent = ''
        status = 'deleted'
      } else return BackendGitDiffResponseSchema.parse(diffFailure(newResult, 'new'))
    }
    return BackendGitDiffResponseSchema.parse({
      ok: true,
      filename: path.data,
      status,
      oldContent,
      newContent,
    })
  }

  async submodules(projectName: string) {
    const project = this.requireProject(projectName)
    return BackendGitSubmodulesResponseSchema.parse(
      redactFailure(await readGitSubmodules(project.root, { exec: this.runner(project) })),
    )
  }

  async codePreview(projectName: string, url: string) {
    const project = this.requireProject(projectName)
    if (url.length > 4096) invalid()
    const link = parseGithubPermalink(url)
    if (!link) invalid()
    const mapping = (project.github ?? []).find(
      (entry) =>
        entry.owner.toLowerCase() === link.owner.toLowerCase() &&
        entry.repo.toLowerCase() === link.repo.toLowerCase(),
    )
    if (!mapping) throw new BackendGitServiceError('RESOURCE_NOT_FOUND', 'Mapping not found')
    const path = ResourceIdSchema.safeParse(link.path)
    if (!path.success) invalid()
    const repoRoot = this.trustedConfiguredPaths
      ? mapping.path
      : await containedRealpath(project.root, mapping.path)
    const base = {
      owner: link.owner,
      repo: link.repo,
      sha: validateRef(link.sha),
      path: path.data,
      startLine: link.startLine,
      endLine: link.endLine,
    }
    const read = await readGitFileContents(repoRoot, base.sha, path.data, {
      exec: this.runner(project),
    })
    if (!read.ok) {
      if (read.reason === 'not-found') {
        throw new BackendGitServiceError('RESOURCE_NOT_FOUND', 'Code preview not found')
      }
      if (read.reason === 'too-large' || read.reason === 'binary') {
        return BackendCodePreviewResponseSchema.parse({
          ...base,
          lines: [],
          truncated: false,
          reason: read.reason,
        })
      }
      throw new BackendGitServiceError('RESOURCE_NOT_FOUND', 'Code preview unavailable')
    }
    const context = sliceContext(read.content, link.startLine, link.endLine)
    return BackendCodePreviewResponseSchema.parse({
      ...base,
      lines: context.lines,
      truncated: context.truncated,
    })
  }

  async commitMarks(projectName: string) {
    const project = this.requireProject(projectName)
    return BackendCommitMarksResponseSchema.parse(await readCommitMarks(project.root))
  }

  async setCommitMark(projectName: string, shaInput: string, input: CommitMarkWriteInput) {
    const project = this.requireProject(projectName)
    const sha = validateRef(shaInput)
    const repo = await this.resolveRepo(project, input.submodule)
    return BackendCommitMarkWriteResponseSchema.parse({
      mark: await setCommitMark(project.root, sha, {
        status: input.status,
        ...(input.note === undefined ? {} : { note: input.note }),
        ...(repo.submodule ? { submodule: repo.submodule } : {}),
      }),
    })
  }

  async deleteCommitMark(projectName: string, shaInput: string, selector: GitRepoSelector) {
    const project = this.requireProject(projectName)
    const repo = await this.resolveRepo(project, selector.submodule)
    return BackendCommitMarkDeleteResponseSchema.parse(
      await deleteCommitMark(project.root, validateRef(shaInput), {
        ...(repo.submodule ? { submodule: repo.submodule } : {}),
      }),
    )
  }

  private requireProject(name: string): ProjectConfig {
    const project = this.projects.get(name)
    if (!project) throw new BackendGitServiceError('PROJECT_NOT_FOUND', 'Project not found')
    return project
  }

  /**
   * The command runner for this Project, or `undefined` when the Project runs
   * locally so core keeps its own `execFile` path.
   *
   * A Project with no execution configuration refuses: its root may be a mount
   * of another machine's working copy, where a local `git` would report the
   * wrong repository state (or none at all).
   */
  private runner(project: ProjectConfig): GitCommandRunner | undefined {
    return gitCommandRunnerFor(this.execution(project))
  }

  private execution(project: ProjectConfig): BackendExecutionProvider {
    try {
      return this.resolveExecution(project)
    } catch (error) {
      if (error instanceof BackendExecutionError) {
        throw new BackendGitServiceError('EXECUTION_UNAVAILABLE', error.message)
      }
      throw error
    }
  }

  private async resolveRepo(project: ProjectConfig, submodule?: string): Promise<ResolvedRepo> {
    const exec = this.runner(project)
    if (!submodule) return { cwd: project.root, submodule: '', exec }
    if (submodule.length > 512 || submodule.includes('\0')) invalid()
    const parsed = BackendGitSubmodulesResponseSchema.parse(
      redactFailure(await readGitSubmodules(project.root, { exec })),
    )
    if (!parsed.enabled) invalid()
    const matches = parsed.submodules.filter((entry) => entry.name === submodule)
    if (matches.length !== 1) invalid()
    return {
      cwd: this.trustedConfiguredPaths
        ? resolve(project.root, matches[0]!.path)
        : await containedRealpath(project.root, resolve(project.root, matches[0]!.path)),
      submodule: matches[0]!.name,
      exec,
    }
  }
}

function validateRef(value: string): string {
  const parsed = BackendGitRefSchema.safeParse(value)
  if (!parsed.success) invalid()
  return parsed.data
}

function invalid(): never {
  throw new BackendGitServiceError('INVALID_RESOURCE', 'Git resource is invalid')
}

function redactFailure<T extends { enabled: boolean }>(value: T) {
  return value.enabled
    ? value
    : { enabled: false as const, reason: (value as T & { reason: string }).reason }
}

async function containedRealpath(projectRoot: string, target: string): Promise<string> {
  const [root, realTarget] = await Promise.all([fs.realpath(projectRoot), fs.realpath(target)])
  const rel = relative(root, realTarget)
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) invalid()
  return realTarget
}

/**
 * Containment check for a path that may not exist: a missing file has nothing
 * to contain. `ENOTDIR` counts as missing too — a component of the path is a
 * file, so the target cannot exist either.
 */
async function assertExistingTargetWithin(root: string, target: string): Promise<void> {
  try {
    await containedRealpath(root, target)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return
    throw error
  }
}

function diffFailure(
  result: Exclude<Awaited<ReturnType<typeof readGitFileContents>>, { ok: true }>,
  side: 'old' | 'new',
) {
  if (result.reason === 'too-large') {
    return {
      ok: false as const,
      skipReason: 'too-large' as const,
      sizeBytes: result.sizeBytes,
      maxBytes: result.maxBytes,
      side,
    }
  }
  if (result.reason === 'binary') return { ok: false as const, skipReason: 'binary' as const }
  return { ok: false as const, error: { message: 'Git content is unavailable' } }
}

function normalizeGitFileEntry<T extends { path: string; origPath?: string }>(entry: T): T {
  return {
    ...entry,
    path: entry.path.replace(/\/+$/, ''),
    ...(entry.origPath === undefined ? {} : { origPath: entry.origPath.replace(/\/+$/, '') }),
  }
}
