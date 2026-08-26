import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import {
  BackendCodeReviewPatchResponseSchema,
  BackendCodeReviewResponseSchema,
  BackendCodeReviewsResponseSchema,
  BackendDigestResponseSchema,
  BackendDigestsResponseSchema,
  BackendDocumentConflictResponseSchema,
  BackendDocumentWriteResponseSchema,
  BackendReadmeResponseSchema,
  BackendReportResponseSchema,
  BackendReportsResponseSchema,
  type CodeReviewCompletion,
  type CodeReviewFrontMatter,
  deriveCompletion,
  extractTitle,
  type ProjectConfig,
  parseCodeReview,
  ResourceIdSchema,
  toggleCommitReviewed,
  toggleTodoDone,
} from '@memon/core'

export class BackendDocumentServiceError extends Error {
  constructor(
    public readonly code:
      | 'PROJECT_NOT_FOUND'
      | 'RESOURCE_NOT_FOUND'
      | 'INVALID_RESOURCE'
      | 'AMBIGUOUS_RESOURCE',
    message: string,
  ) {
    super(message)
    this.name = 'BackendDocumentServiceError'
  }
}

export type BackendDocumentWriteResult =
  | ReturnType<typeof BackendDocumentWriteResponseSchema.parse>
  | ReturnType<typeof BackendDocumentConflictResponseSchema.parse>

export interface BackendDocumentService {
  listReports(project: string): Promise<unknown>
  getReport(project: string, id: string): Promise<unknown>
  putReport(
    project: string,
    id: string,
    input: DocumentWriteInput,
  ): Promise<BackendDocumentWriteResult>
  listDigests(project: string): Promise<unknown>
  getDigest(project: string, id: string): Promise<unknown>
  putDigest(
    project: string,
    id: string,
    input: DocumentWriteInput,
  ): Promise<BackendDocumentWriteResult>
  listCodeReviews(project: string): Promise<unknown>
  getCodeReview(project: string, id: string): Promise<unknown>
  patchCodeReview(project: string, id: string, input: CodeReviewPatchInput): Promise<unknown>
  getReadme(project: string, resource: string): Promise<unknown>
  putReadme(
    project: string,
    resource: string,
    input: DocumentWriteInput,
  ): Promise<BackendDocumentWriteResult>
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
  kind: 'report' | 'digest' | 'code-review' | 'readme'
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

export class FilesystemDocumentService implements BackendDocumentService {
  private readonly projects = new Map<string, ProjectConfig>()

  constructor(projects: readonly ProjectConfig[]) {
    for (const project of projects) {
      if (this.projects.has(project.name)) throw new Error(`duplicate Project ${project.name}`)
      this.projects.set(project.name, project)
    }
  }

  async listReports(projectName: string) {
    const project = this.requireProject(projectName)
    const reports = await this.discoverReports(project)
    return BackendReportsResponseSchema.parse({
      reports: reports.map((entry) => reportSummary(project, entry)),
    })
  }

  async getReport(projectName: string, id: string) {
    const project = this.requireProject(projectName)
    const entry = exactEntry(await this.discoverReports(project), id)
    return BackendReportResponseSchema.parse({
      ...reportSummary(project, entry),
      ...(await this.read(project, entry)),
    })
  }

  async putReport(projectName: string, id: string, input: DocumentWriteInput) {
    const project = this.requireProject(projectName)
    const entry = exactEntry(await this.discoverReports(project), id)
    return this.write(project, entry, input)
  }

  async listDigests(projectName: string) {
    const project = this.requireProject(projectName)
    const digests = await this.discoverDigests(project)
    return BackendDigestsResponseSchema.parse({
      digests: digests.map((entry) => digestSummary(project, entry)),
    })
  }

  async getDigest(projectName: string, id: string) {
    const project = this.requireProject(projectName)
    const entry = exactEntry(await this.discoverDigests(project), id)
    return BackendDigestResponseSchema.parse({
      ...digestSummary(project, entry),
      ...(await this.read(project, entry)),
    })
  }

  async putDigest(projectName: string, id: string, input: DocumentWriteInput) {
    const project = this.requireProject(projectName)
    const entry = exactEntry(await this.discoverDigests(project), id)
    return this.write(project, entry, input)
  }

  async listCodeReviews(projectName: string) {
    const project = this.requireProject(projectName)
    const reviews = await this.discoverCodeReviews(project)
    return BackendCodeReviewsResponseSchema.parse({
      codeReviews: reviews.map((entry) => codeReviewSummary(project, entry)),
    })
  }

  async getCodeReview(projectName: string, id: string) {
    const project = this.requireProject(projectName)
    const entry = exactEntry(await this.discoverCodeReviews(project), id)
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
    const entry = exactEntry(await this.discoverCodeReviews(project), id)
    const current = await this.read(project, entry)
    if (current.mtime !== input.expectedMtime || current.hash !== input.expectedHash) {
      return BackendDocumentConflictResponseSchema.parse({
        error: { code: 'CONFLICT', message: 'on-disk document changed' },
        currentMtime: current.mtime,
        currentHash: current.hash,
      })
    }
    const now = new Date().toISOString()
    const next =
      input.op === 'commit'
        ? toggleCommitReviewed(current.content, input.sha, input.reviewed, now)
        : toggleTodoDone(current.content, input.index, input.done, now)
    if (next === null) throw new BackendDocumentServiceError('INVALID_RESOURCE', 'Invalid patch')
    const result = await this.write(project, entry, { ...input, content: next })
    const conflict = BackendDocumentConflictResponseSchema.safeParse(result)
    if (conflict.success) return conflict.data
    return BackendCodeReviewPatchResponseSchema.parse({
      ...result,
      completion: deriveCompletion(parseCodeReview(next).frontmatter),
    })
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
    return this.write(project, await this.readmeEntry(project, resource), input)
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
    const stat = await fs.stat(absolutePath).catch(() => null)
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

  private async write(project: ProjectConfig, entry: DocumentEntry, input: DocumentWriteInput) {
    const current = await this.read(project, entry)
    if (current.mtime !== input.expectedMtime || current.hash !== input.expectedHash) {
      return BackendDocumentConflictResponseSchema.parse({
        error: { code: 'CONFLICT', message: 'on-disk document changed' },
        currentMtime: current.mtime,
        currentHash: current.hash,
      })
    }
    const temp = join(
      dirname(entry.absolutePath),
      `.${basename(entry.absolutePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    )
    const original = await fs.stat(entry.absolutePath)
    try {
      await fs.writeFile(temp, input.content, { encoding: 'utf8', mode: original.mode })
      await fs.rename(temp, entry.absolutePath)
    } catch (error) {
      await fs.unlink(temp).catch(() => undefined)
      throw error
    }
    const stat = await fs.stat(entry.absolutePath)
    return BackendDocumentWriteResponseSchema.parse({
      ok: true,
      mtime: stat.mtimeMs,
      hash: sha1(input.content),
    })
  }

  private async discoverReports(project: ProjectConfig): Promise<DocumentEntry[]> {
    const directory = join(project.root, 'docs', 'reports')
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    const out: DocumentEntry[] = []
    for (const entry of entries) {
      const file = entry.isFile() ? /^R(\d{4})-([a-z0-9][a-z0-9-]*)\.md$/.exec(entry.name) : null
      const bundle = entry.isDirectory() ? /^R(\d{4})-([a-z0-9][a-z0-9-]*)$/.exec(entry.name) : null
      if (!file && !bundle) continue
      const absolutePath = bundle
        ? join(directory, entry.name, 'README.md')
        : join(directory, entry.name)
      if (!(await isWithin(project.root, absolutePath))) continue
      const content = await fs.readFile(absolutePath, 'utf8').catch(() => null)
      const stat = await fs.stat(absolutePath).catch(() => null)
      if (content === null || !stat?.isFile()) continue
      out.push({
        id: `R${(file ?? bundle)![1]}`,
        absolutePath,
        resource: relative(project.root, absolutePath).split(sep).join('/'),
        title: extractTitle(content),
        mtime: stat.mtimeMs,
        kind: 'report',
        format: bundle ? 'bundle' : 'markdown',
        slug: (file ?? bundle)![2],
      })
    }
    return out.sort((a, b) => b.id.localeCompare(a.id))
  }

  private async discoverDigests(project: ProjectConfig): Promise<DocumentEntry[]> {
    const directory = join(project.root, 'docs', 'digests')
    const names = await fs.readdir(directory).catch(() => [])
    return (
      await Promise.all(
        names.flatMap(async (name) => {
          const match = /^D(\d{4})-(\d{4}-\d{2}-\d{2})\.md$/.exec(name)
          if (!match) return []
          const absolutePath = join(directory, name)
          if (!(await isWithin(project.root, absolutePath))) return []
          const [content, stat] = await Promise.all([
            fs.readFile(absolutePath, 'utf8').catch(() => null),
            fs.stat(absolutePath).catch(() => null),
          ])
          if (content === null || !stat?.isFile()) return []
          return [
            {
              id: `D${match[1]}`,
              absolutePath,
              resource: relative(project.root, absolutePath).split(sep).join('/'),
              title: extractTitle(content),
              mtime: stat.mtimeMs,
              kind: 'digest' as const,
              date: match[2],
            },
          ]
        }),
      )
    )
      .flat()
      .sort((a, b) => b.id.localeCompare(a.id))
  }

  private async discoverCodeReviews(project: ProjectConfig): Promise<DocumentEntry[]> {
    const docs = join(project.root, 'docs')
    const paths: string[] = []
    const flat = await fs.readdir(join(docs, 'code-review')).catch(() => [])
    for (const name of flat) {
      if (/^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/.test(name)) {
        paths.push(`code-review/${name}`)
      }
    }
    const experiments = await fs.readdir(join(docs, 'experiments')).catch(() => [])
    for (const experiment of experiments) {
      if (!/^E\d{4}-[a-z0-9-]+$/.test(experiment)) continue
      const names = await fs
        .readdir(join(docs, 'experiments', experiment, 'code-review'))
        .catch(() => [])
      for (const name of names) {
        if (/^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/.test(name)) {
          paths.push(`experiments/${experiment}/code-review/${name}`)
        }
      }
    }
    const out: DocumentEntry[] = []
    for (const relativePath of paths) {
      const absolutePath = join(docs, relativePath)
      if (!(await isWithin(project.root, absolutePath))) continue
      const content = await fs.readFile(absolutePath, 'utf8').catch(() => null)
      const stat = await fs.stat(absolutePath).catch(() => null)
      if (content === null || !stat?.isFile()) continue
      let title: string | null = null
      try {
        const parsed = parseCodeReview(content)
        title = parsed.frontmatter.title || null
        const metadata = codeReviewMetadata(
          relativePath.replace(/\.md$/, ''),
          parsed.frontmatter,
          parsed.body,
        )
        out.push({
          id: relativePath.replace(/\.md$/, ''),
          absolutePath,
          resource: `docs/${relativePath}`,
          title,
          mtime: stat.mtimeMs,
          kind: 'code-review',
          codeReview: metadata,
        })
      } catch {}
    }
    return out.sort((a, b) => b.id.localeCompare(a.id))
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

function digestSummary(project: ProjectConfig, entry: DocumentEntry) {
  if (entry.kind !== 'digest' || !entry.date) {
    throw new BackendDocumentServiceError('INVALID_RESOURCE', 'Invalid digest metadata')
  }
  return {
    id: entry.id,
    project: project.name,
    resource: entry.resource,
    date: entry.date,
    title: entry.title,
    mtime: entry.mtime,
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
  const [realRoot, realTarget] = await Promise.all([fs.realpath(projectRoot), fs.realpath(target)])
  const rel = relative(realRoot, realTarget)
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) {
    throw new BackendDocumentServiceError('INVALID_RESOURCE', 'Resource escapes Project')
  }
}

async function isWithin(projectRoot: string, target: string): Promise<boolean> {
  try {
    await assertWithin(projectRoot, target)
    return true
  } catch {
    return false
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
