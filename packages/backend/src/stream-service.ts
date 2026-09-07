import { createHash } from 'node:crypto'
import { createReadStream, type Dirent, promises as fs } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'
import {
  BackendLogFilesResponseSchema,
  BackendLogLinesResponseSchema,
  BackendLogStreamEventSchema,
  LineIndex,
  type ProjectConfig,
  ResourceIdSchema,
} from '@memon/core'

const LOG_EXTENSIONS = new Set(['.log', '.txt', '.out', '.err'])
const REPORT_BUNDLE_PATTERN = /^R(\d{4})-([a-z0-9][a-z0-9-]*)$/
const WIKI_BUNDLE_PATTERN = /^W(\d{4})-([a-z0-9][a-z0-9-]*)$/
const DEFAULT_LOG_STREAM_POLL_MS = 1500
const MAX_LOG_STREAM_LINES = 2000

export class BackendStreamServiceError extends Error {
  constructor(
    public readonly code:
      | 'PROJECT_NOT_FOUND'
      | 'RESOURCE_NOT_FOUND'
      | 'INVALID_RESOURCE'
      | 'AMBIGUOUS_RESOURCE',
    message: string,
  ) {
    super(message)
    this.name = 'BackendStreamServiceError'
  }
}

export interface BackendByteResource {
  project: string
  resource: string
  absolutePath: string
  contentType: string
  size: number
  mtimeMs: number
  etag: string
  version: string
}

export interface LogLinesInput {
  endLine?: number
  count?: number
}

export interface ByteRangeInput {
  start: number
  end: number
}

export type BackendLogStreamEvent = ReturnType<typeof BackendLogStreamEventSchema.parse>

export interface BackendStreamService {
  listLogFiles(project: string, runResource: string): Promise<unknown>
  readLogLines(project: string, resource: string, input?: LogLinesInput): Promise<unknown>
  validateLogResource(project: string, resource: string): Promise<void>
  streamLog(
    project: string,
    resource: string,
    signal: AbortSignal,
  ): AsyncIterable<BackendLogStreamEvent>
  resolveReportAsset(
    project: string,
    reportId: string,
    resource: string,
  ): Promise<BackendByteResource>
  resolveWikiAsset(project: string, wikiId: string, resource: string): Promise<BackendByteResource>
  openByteStream(resource: BackendByteResource, range?: ByteRangeInput): Readable
}

export interface FilesystemStreamServiceOptions {
  logStreamPollMs?: number
}

export class FilesystemStreamService implements BackendStreamService {
  private readonly projects = new Map<string, ProjectConfig>()
  private readonly indexes = new Map<string, Promise<LineIndex>>()
  private readonly logStreamPollMs: number

  constructor(projects: readonly ProjectConfig[], options: FilesystemStreamServiceOptions = {}) {
    for (const project of projects) {
      if (this.projects.has(project.name)) throw new Error(`duplicate Project ${project.name}`)
      this.projects.set(project.name, project)
    }
    const pollMs = options.logStreamPollMs ?? DEFAULT_LOG_STREAM_POLL_MS
    if (!Number.isSafeInteger(pollMs) || pollMs < 10 || pollMs > 60_000) {
      throw new Error('logStreamPollMs must be an integer between 10 and 60000')
    }
    this.logStreamPollMs = pollMs
  }

  async listLogFiles(projectName: string, runResourceInput: string) {
    const project = this.requireProject(projectName)
    const runResource = parseResource(runResourceInput)
    if (runResource !== 'README.md' && !runResource.endsWith('/README.md')) invalid()
    await this.resolveContained(project, runResource, 'file')
    const runDirectoryResource = dirname(runResource)
    const candidates: Array<{ name: string; resource: string; size: number; mtime: number }> = []
    await this.scanLogDirectory(project, runDirectoryResource, candidates)
    await this.scanLogDirectory(project, join(runDirectoryResource, 'logs'), candidates)
    candidates.sort((a, b) => b.mtime - a.mtime || a.resource.localeCompare(b.resource))
    return BackendLogFilesResponseSchema.parse({ files: candidates })
  }

  async readLogLines(projectName: string, resourceInput: string, input: LogLinesInput = {}) {
    const project = this.requireProject(projectName)
    const resource = parseLogResource(resourceInput)
    const resolved = await this.resolveContained(project, resource, 'file')
    const count = input.count ?? 100
    if (!Number.isSafeInteger(count) || count < 1 || count > 2000) invalid()
    if (
      input.endLine !== undefined &&
      (!Number.isSafeInteger(input.endLine) || input.endLine < 1)
    ) {
      invalid()
    }
    let index = await this.indexFor(resolved.realPath)
    const append = await index.appendDelta()
    if (append.rotated) {
      this.indexes.delete(resolved.realPath)
      index = await this.indexFor(resolved.realPath)
    }
    const endLine = input.endLine ?? index.totalLines
    return BackendLogLinesResponseSchema.parse({
      totalLines: index.totalLines,
      lines: await index.range(endLine, count, { maxLineBytes: 1024 * 1024 }),
    })
  }

  async validateLogResource(projectName: string, resourceInput: string): Promise<void> {
    const project = this.requireProject(projectName)
    await this.resolveContained(project, parseLogResource(resourceInput), 'file')
  }

  async *streamLog(
    projectName: string,
    resourceInput: string,
    signal: AbortSignal,
  ): AsyncIterable<BackendLogStreamEvent> {
    const project = this.requireProject(projectName)
    const resource = parseLogResource(resourceInput)
    const resolved = await this.resolveContained(project, resource, 'file')
    let index = await this.indexFor(resolved.realPath)
    yield BackendLogStreamEventSchema.parse({
      event: 'ready',
      data: { totalLines: index.totalLines },
    })
    while (!signal.aborted) {
      try {
        await abortableDelay(this.logStreamPollMs, signal)
        if (signal.aborted) return
        const append = await index.appendDelta()
        if (append.rotated) {
          this.indexes.delete(resolved.realPath)
          index = await this.indexFor(resolved.realPath)
          yield BackendLogStreamEventSchema.parse({ event: 'rotated', data: {} })
          continue
        }
        if (append.added <= 0) continue
        if (append.added > MAX_LOG_STREAM_LINES) {
          yield BackendLogStreamEventSchema.parse({ event: 'rotated', data: {} })
          continue
        }
        yield BackendLogStreamEventSchema.parse({
          event: 'append',
          data: {
            lines: await index.range(index.totalLines, append.added, {
              maxLineBytes: 1024 * 1024,
            }),
          },
        })
      } catch {
        if (signal.aborted) return
        yield BackendLogStreamEventSchema.parse({
          event: 'error',
          data: { message: 'Backend log stream is unavailable' },
        })
        return
      }
    }
  }

  async resolveReportAsset(projectName: string, reportId: string, resourceInput: string) {
    const project = this.requireProject(projectName)
    if (!/^R\d{4}$/.test(reportId)) invalid()
    const resource = parseResource(resourceInput)
    if (resource.toLowerCase() === 'readme.md') {
      throw new BackendStreamServiceError('RESOURCE_NOT_FOUND', 'Report README is not an asset')
    }
    const entries = await readDirectoryEntries(join(project.root, 'docs', 'reports'))
    const matches = entries.filter((entry) => {
      const match = entry.isDirectory() ? REPORT_BUNDLE_PATTERN.exec(entry.name) : null
      return match && `R${match[1]}` === reportId
    })
    if (matches.length === 0) {
      throw new BackendStreamServiceError('RESOURCE_NOT_FOUND', 'Report bundle not found')
    }
    if (matches.length > 1) {
      throw new BackendStreamServiceError('AMBIGUOUS_RESOURCE', 'Report bundle is ambiguous')
    }
    return this.resolveBundleAsset(project, `docs/reports/${matches[0]!.name}`, resource)
  }

  /**
   * Wiki bundle asset. Pages live two levels deep (`docs/wiki/<kind>/<page>/`)
   * and the id is unique across kinds, so every kind directory is searched.
   */
  async resolveWikiAsset(projectName: string, wikiId: string, resourceInput: string) {
    const project = this.requireProject(projectName)
    if (!/^W\d{4}$/.test(wikiId)) invalid()
    const resource = parseResource(resourceInput)
    if (resource.toLowerCase() === 'readme.md') {
      throw new BackendStreamServiceError('RESOURCE_NOT_FOUND', 'Wiki README is not an asset')
    }
    const wikiDirectory = join(project.root, 'docs', 'wiki')
    const kinds = await readDirectoryEntries(wikiDirectory)
    const matches: string[] = []
    for (const kind of kinds) {
      if (!kind.isDirectory()) continue
      for (const entry of await readDirectoryEntries(join(wikiDirectory, kind.name))) {
        const match = entry.isDirectory() ? WIKI_BUNDLE_PATTERN.exec(entry.name) : null
        if (match && `W${match[1]}` === wikiId) {
          matches.push(`docs/wiki/${kind.name}/${entry.name}`)
        }
      }
    }
    if (matches.length === 0) {
      throw new BackendStreamServiceError('RESOURCE_NOT_FOUND', 'Wiki bundle not found')
    }
    if (matches.length > 1) {
      throw new BackendStreamServiceError('AMBIGUOUS_RESOURCE', 'Wiki bundle is ambiguous')
    }
    return this.resolveBundleAsset(project, matches[0]!, resource)
  }

  private async resolveBundleAsset(
    project: ProjectConfig,
    bundleResource: string,
    resource: string,
  ): Promise<BackendByteResource> {
    const bundle = await this.resolveContained(project, bundleResource, 'directory')
    const assetResource = `${bundleResource}/${resource}`
    const resolved = await this.resolveContained(project, assetResource, 'file')
    if (!isWithin(bundle.realPath, resolved.realPath)) invalid()
    const version = createHash('sha1')
      .update(`${resolved.stat.size}:${resolved.stat.mtimeMs}:${resolved.stat.ino}`)
      .digest('hex')
    return {
      project: project.name,
      resource: assetResource,
      absolutePath: resolved.realPath,
      contentType: contentTypeFor(assetResource),
      size: resolved.stat.size,
      mtimeMs: resolved.stat.mtimeMs,
      etag: `W/"${version}"`,
      version,
    }
  }

  openByteStream(resource: BackendByteResource, range?: ByteRangeInput): Readable {
    return createReadStream(resource.absolutePath, {
      ...(range ? { start: range.start, end: range.end } : {}),
      highWaterMark: 64 * 1024,
    })
  }

  private requireProject(name: string): ProjectConfig {
    const project = this.projects.get(name)
    if (!project) throw new BackendStreamServiceError('PROJECT_NOT_FOUND', 'Project not found')
    return project
  }

  private async indexFor(realPath: string): Promise<LineIndex> {
    let pending = this.indexes.get(realPath)
    if (!pending) {
      pending = LineIndex.build(realPath)
      this.indexes.set(realPath, pending)
      pending.catch(() => this.indexes.delete(realPath))
    }
    return pending
  }

  private async scanLogDirectory(
    project: ProjectConfig,
    directoryResource: string,
    output: Array<{ name: string; resource: string; size: number; mtime: number }>,
  ): Promise<void> {
    let directory: Awaited<ReturnType<FilesystemStreamService['resolveContained']>>
    try {
      directory = await this.resolveContained(project, directoryResource, 'directory')
    } catch (error) {
      if (error instanceof BackendStreamServiceError && error.code === 'RESOURCE_NOT_FOUND') return
      throw error
    }
    const entries = await fs.readdir(directory.realPath, { withFileTypes: true, encoding: 'utf8' })
    for (const entry of entries) {
      if (!entry.isFile() || !LOG_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
      const resource = `${directoryResource}/${entry.name}`
      const resolved = await this.resolveContained(project, resource, 'file').catch(() => null)
      if (!resolved) continue
      output.push({
        name: basename(resource),
        resource,
        size: resolved.stat.size,
        mtime: resolved.stat.mtimeMs,
      })
    }
  }

  private async resolveContained(
    project: ProjectConfig,
    resource: string,
    kind: 'file' | 'directory',
  ) {
    const parsed = parseResource(resource)
    const lexicalRoot = resolve(project.root)
    const lexicalTarget = resolve(lexicalRoot, parsed)
    if (!isWithin(lexicalRoot, lexicalTarget)) invalid()
    let realRoot: string
    let realPath: string
    try {
      ;[realRoot, realPath] = await Promise.all([
        fs.realpath(lexicalRoot),
        fs.realpath(lexicalTarget),
      ])
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new BackendStreamServiceError('RESOURCE_NOT_FOUND', 'Resource not found')
      }
      throw error
    }
    if (!isWithin(realRoot, realPath)) invalid()
    const stat = await fs.stat(realPath)
    if ((kind === 'file' && !stat.isFile()) || (kind === 'directory' && !stat.isDirectory())) {
      throw new BackendStreamServiceError('RESOURCE_NOT_FOUND', 'Resource kind is invalid')
    }
    return { resource: parsed, realPath, stat }
  }
}

function parseResource(input: string): ReturnType<typeof ResourceIdSchema.parse> {
  const parsed = ResourceIdSchema.safeParse(input)
  if (!parsed.success) invalid()
  return parsed.data
}

function parseLogResource(input: string): ReturnType<typeof ResourceIdSchema.parse> {
  const resource = parseResource(input)
  if (!LOG_EXTENSIONS.has(extname(resource).toLowerCase())) invalid()
  return resource
}

/** Directory listing that treats a missing directory as empty. */
async function readDirectoryEntries(directory: string): Promise<Dirent[]> {
  return fs.readdir(directory, { withFileTypes: true, encoding: 'utf8' }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  })
}

function invalid(): never {
  throw new BackendStreamServiceError('INVALID_RESOURCE', 'Stream resource is invalid')
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep))
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolveDelay) => {
    const timer = setTimeout(done, ms)
    timer.unref?.()
    const onAbort = () => done()
    signal.addEventListener('abort', onAbort, { once: true })
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolveDelay()
    }
  })
}

function contentTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8'
    case '.json':
    case '.map':
      return 'application/json; charset=utf-8'
    case '.yaml':
    case '.yml':
      return 'application/yaml; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.avif':
      return 'image/avif'
    case '.ico':
      return 'image/x-icon'
    case '.pdf':
      return 'application/pdf'
    case '.wasm':
      return 'application/wasm'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    case '.ttf':
      return 'font/ttf'
    case '.otf':
      return 'font/otf'
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.xml':
      return 'application/xml; charset=utf-8'
    case '.csv':
      return 'text/csv; charset=utf-8'
    case '.txt':
    case '.md':
      return 'text/plain; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}
