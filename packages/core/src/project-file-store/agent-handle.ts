import { Readable } from 'node:stream'
import { FileAccessError, type FileMetadataSchema } from '@memon/file-protocol'
import type { z } from 'zod'
import { ProjectStats, type StatsFields } from '../project-io.js'
import { agentAdapter, missingAgentPath } from './agent-adapters.js'
import { storeAccess } from './store-access.js'

const AGENT_STREAM_RANGE_BYTES = 1024 * 1024

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
    const bounded = Math.min(length, 1024 * 1024, storeAccess().effectiveOptions().byteBurst)
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
    const highWaterMark = options.highWaterMark ?? 64 * 1024
    if (!Number.isSafeInteger(highWaterMark) || highWaterMark < 1)
      throw new RangeError('invalid stream buffer')
    // Each range is one round trip to the source, so ranges use the largest
    // bounded size rather than the consumer's buffer size, and the next range
    // is requested while the consumer takes the current one.
    const size = AGENT_STREAM_RANGE_BYTES
    const end = options.end ?? Infinity
    const readFrom = (at: number): Promise<Buffer> | null => {
      if (at > end) return null
      const buffer = Buffer.alloc(Math.min(size, end - at + 1))
      const pending = handle
        .read(buffer, 0, buffer.length, at)
        .then(({ bytesRead }) => buffer.subarray(0, bytesRead))
      pending.catch(() => undefined)
      return pending
    }
    const stream = Readable.from(
      (async function* () {
        let position = options.start ?? handle.position
        try {
          let pending = readFrom(position)
          while (pending) {
            if (options.signal?.aborted) throw options.signal.reason
            const bytes = await pending
            if (!bytes.length) break
            position += bytes.length
            if (options.start === undefined) handle.position = position
            pending = readFrom(position)
            yield bytes
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
