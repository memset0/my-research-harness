import { createHash } from 'node:crypto'
import { request } from 'node:https'
import { z } from 'zod'
import {
  ConditionalOptionsSchema,
  DirectoryListResultSchema,
  FILE_WRITER_LOCK_VERSION,
  FileAccessError,
  type FileAdapter,
  FileErrorSchema,
  FileMutationRequestSchema,
  FileRangeRequestSchema,
  FileRangeResultSchema,
  FileReadAtRequestSchema,
  FileReadHandleSchema,
  FileReadResultSchema,
  FileStatResultSchema,
  FileTargetSchema,
  requireFileCapabilities,
} from './index.js'

export interface AgentConnection {
  endpoint: string
  ca: string | Buffer
  certificate: string | Buffer
  key: string | Buffer
  expectedSourceIdentity: string
  timeoutMs?: number
  maxResponseBytes?: number
  concurrency?: number | (() => number)
  onResponse?: (operation: string, bodyBytes: number, conditional: boolean) => void
}

interface Response {
  status: number
  headers: Record<string, string | string[] | undefined>
  bytes: Buffer
}

export class FileAgentClient implements FileAdapter {
  readonly sourceIdentity: string
  readonly authorityIdentity: string
  private readonly endpoint: URL
  private readonly handshakes = new Map<
    string,
    Promise<ReturnType<typeof requireFileCapabilities>>
  >()

  constructor(private readonly connection: AgentConnection) {
    this.endpoint = new URL(connection.endpoint)
    if (
      this.endpoint.protocol !== 'https:' ||
      this.endpoint.username ||
      this.endpoint.password ||
      this.endpoint.search ||
      this.endpoint.hash ||
      (this.endpoint.pathname !== '/' && this.endpoint.pathname !== '')
    ) {
      throw new FileAccessError('BAD_REQUEST')
    }
    this.sourceIdentity = connection.expectedSourceIdentity
    this.authorityIdentity = createHash('sha256')
      .update(connection.endpoint)
      .update(connection.certificate)
      .update(connection.key)
      .update(connection.ca)
      .digest('hex')
    if (
      !this.sourceIdentity ||
      (connection.timeoutMs !== undefined &&
        (!Number.isFinite(connection.timeoutMs) || connection.timeoutMs <= 0))
    ) {
      throw new FileAccessError('BAD_REQUEST')
    }
  }

  private call(
    operation: string,
    query: Record<string, string>,
    payload?: unknown,
  ): Promise<Response> {
    const url = new URL(`/v1/${operation}`, this.endpoint)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    const concurrency =
      typeof this.connection.concurrency === 'function'
        ? this.connection.concurrency()
        : (this.connection.concurrency ?? 10)
    if (!Number.isSafeInteger(concurrency) || concurrency < 1)
      throw new FileAccessError('BAD_REQUEST')
    const body = payload === undefined ? undefined : Buffer.from(JSON.stringify(payload))
    const limit = this.connection.maxResponseBytes ?? 40 * 1024 * 1024
    return new Promise<Response>((resolve, reject) => {
      const req = request(
        url,
        {
          method: body === undefined ? 'GET' : 'POST',
          ca: this.connection.ca,
          cert: this.connection.certificate,
          key: this.connection.key,
          rejectUnauthorized: true,
          minVersion: 'TLSv1.3',
          headers:
            body === undefined
              ? {
                  'x-memon-concurrency': String(concurrency),
                  'x-memon-expected-source-identity': this.sourceIdentity,
                  ...(query.knownVersion ? { 'if-none-match': `"${query.knownVersion}"` } : {}),
                }
              : {
                  'x-memon-concurrency': String(concurrency),
                  'x-memon-expected-source-identity': this.sourceIdentity,
                  'content-type': 'application/json',
                  'content-length': body.length,
                },
        },
        (response) => {
          const chunks: Buffer[] = []
          let received = 0
          let recorded = false
          const record = () => {
            if (recorded) return
            recorded = true
            try {
              this.connection.onResponse?.(operation, received, Boolean(query.knownVersion))
            } catch {
              /* Telemetry never changes transport results. */
            }
          }
          response.once('close', record)
          response.on('data', (chunk: Buffer) => {
            received += chunk.length
            if (received > limit) {
              req.destroy(new FileAccessError('LIMIT_EXCEEDED'))
              return
            }
            chunks.push(chunk)
          })
          response.on('error', (cause) =>
            reject(new FileAccessError('SOURCE_UNAVAILABLE', { cause })),
          )
          response.on('end', () => {
            record()
            if (
              response.statusCode !== undefined &&
              response.statusCode < 400 &&
              operation !== 'batch' &&
              response.headers['x-memon-source-identity'] !== this.sourceIdentity
            ) {
              reject(new FileAccessError('SOURCE_UNAVAILABLE'))
              return
            }
            resolve({
              status: response.statusCode ?? 500,
              headers: response.headers,
              bytes: Buffer.concat(chunks),
            })
          })
        },
      )
      const deadline = setTimeout(
        () => req.destroy(new FileAccessError('SOURCE_UNAVAILABLE')),
        this.connection.timeoutMs ?? 10_000,
      )
      req.once('close', () => clearTimeout(deadline))
      req.on('error', (cause) =>
        reject(
          cause instanceof FileAccessError
            ? cause
            : new FileAccessError('SOURCE_UNAVAILABLE', { cause }),
        ),
      )
      req.end(body)
    }).catch((cause) => {
      if (cause instanceof FileAccessError) throw cause
      throw new FileAccessError('SOURCE_UNAVAILABLE', { cause })
    })
  }

  private json(response: Response): unknown {
    let value: unknown
    try {
      value = JSON.parse(response.bytes.toString('utf8'))
    } catch {
      throw new FileAccessError('PROTOCOL_INCOMPATIBLE')
    }
    if (response.status >= 400) {
      const error = z.object({ error: FileErrorSchema }).strict().safeParse(value)
      if (!error.success) throw new FileAccessError('PROTOCOL_INCOMPATIBLE')
      throw new FileAccessError(error.data.error.code)
    }
    if (response.status !== 200) throw new FileAccessError('PROTOCOL_INCOMPATIBLE')
    return value
  }

  /** Authenticate the configured project without accessing its backing files. */
  async negotiate(project: string) {
    return this.handshake(project)
  }

  private async handshake(project: string) {
    let pending = this.handshakes.get(project)
    if (!pending) {
      pending = this.call('capabilities', { project }).then((response) => {
        const capabilities = requireFileCapabilities(this.json(response), [
          'read',
          'list',
          'stat',
          'range',
        ])
        if (capabilities.sourceIdentity !== this.sourceIdentity)
          throw new FileAccessError('SOURCE_UNAVAILABLE')
        return capabilities
      })
      this.handshakes.set(project, pending)
      pending.catch(() => {
        if (this.handshakes.get(project) === pending) this.handshakes.delete(project)
      })
    }
    return pending
  }

  private conditionalResponse(response: Response): unknown {
    if (response.status !== 304) return this.json(response)
    if (response.bytes.length !== 0) throw new FileAccessError('PROTOCOL_INCOMPATIBLE')
    const etag = response.headers.etag
    const checkedAt = Number(response.headers['x-memon-checked-at'])
    if (typeof etag !== 'string' || !Number.isFinite(checkedAt) || checkedAt < 0)
      throw new FileAccessError('PROTOCOL_INCOMPATIBLE')
    return { outcome: 'unchanged', version: etag.replace(/^"|"$/g, ''), checkedAt }
  }

  async read(
    target: Parameters<FileAdapter['read']>[0],
    options: Parameters<FileAdapter['read']>[1] = {},
  ) {
    FileTargetSchema.parse(target)
    ConditionalOptionsSchema.parse(options)
    await this.handshake(target.project)
    const response = await this.call('read', {
      ...target,
      ...(options.knownVersion ? { knownVersion: options.knownVersion } : {}),
    })
    const result = FileReadResultSchema.parse(this.conditionalResponse(response))
    if (result.outcome === 'unchanged' && result.version !== options.knownVersion)
      throw new FileAccessError('PROTOCOL_INCOMPATIBLE')
    return { ...result, checkedAt: Date.now() }
  }

  async list(
    target: Parameters<FileAdapter['list']>[0],
    options: Parameters<FileAdapter['list']>[1] = {},
  ) {
    FileTargetSchema.parse(target)
    ConditionalOptionsSchema.parse(options)
    await this.handshake(target.project)
    const response = await this.call('list', {
      ...target,
      ...(options.knownVersion ? { knownVersion: options.knownVersion } : {}),
    })
    const result = DirectoryListResultSchema.parse(this.conditionalResponse(response))
    if (result.outcome === 'unchanged' && result.version !== options.knownVersion)
      throw new FileAccessError('PROTOCOL_INCOMPATIBLE')
    return { ...result, checkedAt: Date.now() }
  }

  async stat(target: Parameters<FileAdapter['stat']>[0], follow = true) {
    FileTargetSchema.parse(target)
    const capabilities = await this.handshake(target.project)
    if (!follow && !capabilities.capabilities.includes('lstat'))
      throw new FileAccessError('CAPABILITY_UNAVAILABLE')
    return {
      ...FileStatResultSchema.parse(this.json(await this.call(follow ? 'stat' : 'lstat', target))),
      checkedAt: Date.now(),
    }
  }

  async resolve(target: Parameters<FileAdapter['resolve']>[0]): Promise<string> {
    FileTargetSchema.parse(target)
    const capabilities = await this.handshake(target.project)
    if (!capabilities.capabilities.includes('resolve'))
      throw new FileAccessError('CAPABILITY_UNAVAILABLE')
    const value = z
      .object({ path: z.string() })
      .strict()
      .parse(this.json(await this.call('resolve', target)))
    FileTargetSchema.parse({ project: target.project, path: value.path })
    return value.path
  }

  async readRange(input: Parameters<FileAdapter['readRange']>[0]) {
    const value = FileRangeRequestSchema.parse(input)
    const capabilities = await this.handshake(value.project)
    if (value.length > capabilities.limits.maxRangeBytes)
      throw new FileAccessError('LIMIT_EXCEEDED')
    const result = this.json(
      await this.call('range', {
        project: value.project,
        path: value.path,
        offset: String(value.offset),
        length: String(value.length),
      }),
    )
    if (
      typeof result === 'object' &&
      result !== null &&
      'outcome' in result &&
      result.outcome === 'missing'
    ) {
      return {
        ...z
          .object({ outcome: z.literal('missing'), checkedAt: z.number().finite().nonnegative() })
          .strict()
          .parse(result),
        checkedAt: Date.now(),
      }
    }
    const parsed = FileRangeResultSchema.parse(result)
    if (
      parsed.offset !== value.offset ||
      Buffer.from(parsed.content, 'base64').length > value.length
    )
      throw new FileAccessError('PROTOCOL_INCOMPATIBLE')
    return { ...parsed, checkedAt: Date.now() }
  }

  async openRead(target: Parameters<FileAdapter['read']>[0]) {
    FileTargetSchema.parse(target)
    const capabilities = await this.handshake(target.project)
    if (!capabilities.capabilities.includes('read-handles-v1'))
      throw new FileAccessError('CAPABILITY_UNAVAILABLE')
    return FileReadHandleSchema.parse(this.json(await this.call('open-read', target)))
  }
  async readAt(input: z.infer<typeof FileReadAtRequestSchema>) {
    const value = FileReadAtRequestSchema.parse(input)
    const capabilities = await this.handshake(value.project)
    if (!capabilities.capabilities.includes('read-handles-v1'))
      throw new FileAccessError('CAPABILITY_UNAVAILABLE')
    if (value.length > capabilities.limits.maxRangeBytes)
      throw new FileAccessError('LIMIT_EXCEEDED')
    const result = FileRangeResultSchema.parse(
      this.json(
        await this.call('read-at', {
          project: value.project,
          readToken: value.readToken,
          offset: String(value.offset),
          length: String(value.length),
        }),
      ),
    )
    if (
      result.offset !== value.offset ||
      Buffer.from(result.content, 'base64').length > value.length
    )
      throw new FileAccessError('PROTOCOL_INCOMPATIBLE')
    return result
  }
  async closeRead(target: { project: string; readToken: string }) {
    z.object({ project: z.string().min(1), readToken: z.string().min(1).max(256) })
      .strict()
      .parse(target)
    z.object({ outcome: z.literal('closed') })
      .strict()
      .parse(this.json(await this.call('close-read', target)))
  }

  async mutate(input: Parameters<FileAdapter['mutate']>[0]) {
    const value = FileMutationRequestSchema.parse(input)
    if (value.operation === 'rename' && value.fileChecks?.length === 0) delete value.fileChecks
    const capabilities = await this.handshake(value.project)
    if (
      !capabilities.capabilities.includes('mutate') ||
      !capabilities.capabilities.includes('replay')
    )
      throw new FileAccessError('CAPABILITY_UNAVAILABLE')
    if (
      value.operation === 'rename' &&
      value.fileChecks?.length &&
      !capabilities.capabilities.includes('directory-guards-v1')
    )
      throw new FileAccessError('CAPABILITY_UNAVAILABLE')
    if (capabilities.writerLockVersion !== FILE_WRITER_LOCK_VERSION)
      throw new FileAccessError('WRITER_UPGRADE_REQUIRED')
    // A lost response can be retried only with the identical payload and ID.
    let response: Response
    try {
      response = await this.call('mutate', {}, value)
    } catch (error) {
      if (!(error instanceof FileAccessError) || error.code !== 'SOURCE_UNAVAILABLE') throw error
      response = await this.call('mutate', {}, value)
    }
    z.object({ outcome: z.literal('applied') })
      .strict()
      .parse(this.json(response))
  }
}
