import { Readable } from 'node:stream'
import { FileAccessError, type FileMetadataSchema } from '@memon/file-protocol'
import type { z } from 'zod'
import { ProjectStats, type StatsFields } from '../project-io.js'
import { agentAdapter, missingAgentPath } from './agent-adapters.js'
import { getProjectFileAccessOptions } from './runtime.js'

/** A bounded read lease retaining one opened regular file. */
export class AgentReadHandle {
  private position = 0
  private closed = false
  constructor(
    private readonly range: (offset: number, length: number) => Promise<Buffer>,
    private readonly release: () => Promise<void>,
    private readonly fields: StatsFields,
    readonly fileId?: string,
  ) {}
  static async open(path: string): Promise<AgentReadHandle> {
    const { adapter, target } = await agentAdapter(path)
    if (!adapter.openRead || !adapter.readAt || !adapter.closeRead)
      throw new FileAccessError('CAPABILITY_UNAVAILABLE')
    const opened = await adapter.openRead(target)
    if (opened.outcome === 'missing') throw missingAgentPath(path)
    const lease = { project: target.project, readToken: opened.readToken }
    const metadata: z.infer<typeof FileMetadataSchema> = opened.metadata
    return new AgentReadHandle(
      async (offset, length) => {
        const current = await agentAdapter(path)
        if (
          current.adapter.authorityIdentity !== adapter.authorityIdentity ||
          current.adapter.sourceIdentity !== adapter.sourceIdentity
        )
          throw new FileAccessError('FORBIDDEN')
        const result = await adapter.readAt!({ ...lease, offset, length })
        return Buffer.from(result.content, 'base64')
      },
      () => adapter.closeRead!(lease),
      {
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
        mode: metadata.mode | 0o100000,
        ...(metadata.ino === undefined ? {} : { ino: metadata.ino }),
        ...(metadata.dev === undefined ? {} : { dev: metadata.dev }),
        ...(metadata.ctimeMs === undefined ? {} : { ctimeMs: metadata.ctimeMs }),
      },
      metadata.fileId,
    )
  }
  async stat(options?: { bigint?: boolean }) {
    if (options?.bigint) throw new FileAccessError('CAPABILITY_UNAVAILABLE')
    return new ProjectStats(this.fields)
  }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.release()
  }
  async read(
    buffer: Uint8Array,
    offset = 0,
    length = buffer.length - offset,
    position: number | null = null,
  ) {
    if (this.closed) throw Object.assign(new Error('handle closed'), { code: 'EBADF' })
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset + length > buffer.length
    )
      throw new RangeError('invalid read bounds')
    const start = position ?? this.position
    if (!Number.isSafeInteger(start) || start < 0) throw new RangeError('invalid read position')
    if (length === 0) return { bytesRead: 0, buffer }
    const bounded = Math.min(length, 1024 * 1024, getProjectFileAccessOptions().byteBurst)
    const bytes = await this.range(start, bounded)
    buffer.set(bytes, offset)
    if (position === null) this.position += bytes.length
    return { bytesRead: bytes.length, buffer }
  }
  createReadStream(
    options: {
      start?: number
      end?: number
      highWaterMark?: number
      autoClose?: boolean
      signal?: AbortSignal
    } = {},
  ): Readable {
    const handle = this
    const size = Math.min(options.highWaterMark ?? 64 * 1024, 1024 * 1024)
    if (!Number.isSafeInteger(size) || size < 1) throw new RangeError('invalid stream buffer')
    const stream = Readable.from(
      (async function* () {
        let position = options.start ?? handle.position
        try {
          while (position <= (options.end ?? Infinity)) {
            if (options.signal?.aborted) throw options.signal.reason
            const buffer = Buffer.alloc(Math.min(size, (options.end ?? Infinity) - position + 1))
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
            if (!bytesRead) break
            position += bytesRead
            if (options.start === undefined) handle.position = position
            yield buffer.subarray(0, bytesRead)
          }
        } finally {
          if (options.autoClose !== false) await handle.close()
        }
      })(),
      { objectMode: false, ...(options.signal ? { signal: options.signal } : {}) },
    )
    stream.once('close', () => {
      if (options.autoClose !== false) void handle.close().catch(() => undefined)
    })
    return stream
  }
  async write(): Promise<never> {
    throw new FileAccessError('CAPABILITY_UNAVAILABLE')
  }
}
