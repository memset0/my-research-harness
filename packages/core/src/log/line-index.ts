// LineIndex — sparse byte-offset index for absolute-line random access in large logs.
//
// Design:
//   - Build streams the file once, scanning for `\n` (0x0A) bytes and recording
//     a (lineNumber, byteOffset) anchor every `anchorEvery` lines.
//   - range(endLine, count) finds the largest anchor ≤ start, seeks there, and
//     reads forward to materialize the desired range.
//   - appendDelta() reads only the new bytes after the previously recorded
//     `size`, extending anchors without rebuilding.
//   - Rotation/truncation (size shrinks or inode changes) returns
//     `{ rotated: true }` so the caller can rebuild.
//
// Notes on counting:
//   * We count newlines, not "lines" by some other definition.
//   * If the file ends with `\n`, totalLines = newlineCount.
//     If it doesn't, totalLines = newlineCount + 1 (a final un-terminated line).
//   * An empty file has totalLines = 0.

import { projectFs as fs } from '../project-file-store.js'

const open = fs.open

const NEWLINE = 0x0a

export interface LineIndexOptions {
  /** Sparse anchor spacing — one anchor per `anchorEvery` lines. */
  anchorEvery?: number
}

export interface LineRange {
  lineNumber: number
  text: string
}

export interface LineRangeOptions {
  /** Abort before a selected line can grow into an unbounded allocation. */
  maxLineBytes?: number
}

export interface AppendResult {
  /** Lines added since last build/appendDelta. */
  added: number
  /** True if rotation/truncation detected — caller should rebuild. */
  rotated: boolean
}

interface Anchor {
  lineNumber: number
  byteOffset: number
}

export const DEFAULT_ANCHOR_EVERY = 1024

export class LineIndex {
  private constructor(
    public readonly path: string,
    public size: number,
    public mtime: number,
    public ino: number,
    public totalLines: number,
    private readonly anchors: Anchor[],
    public readonly anchorEvery: number,
    public readonly fileId?: string,
  ) {}

  static async build(path: string, opts: LineIndexOptions = {}): Promise<LineIndex> {
    const anchorEvery = opts.anchorEvery ?? DEFAULT_ANCHOR_EVERY
    const handle = await fs.open(path, 'r')
    try {
      const stat = await handle.stat()
      const anchors: Anchor[] = [{ lineNumber: 1, byteOffset: 0 }]

      let newlineCount = 0
      let lastByte = -1
      let byteOffset = 0

      if (stat.size > 0) {
        const stream = handle.createReadStream({
          end: stat.size - 1,
          autoClose: false,
          highWaterMark: 64 * 1024,
        })
        for await (const chunk of stream) {
          const buf = chunk as Buffer
          for (let i = 0; i < buf.length; i++) {
            if (buf[i] === NEWLINE) {
              newlineCount += 1
              if (newlineCount % anchorEvery === 0) {
                anchors.push({
                  lineNumber: newlineCount + 1,
                  byteOffset: byteOffset + i + 1,
                })
              }
            }
            lastByte = buf[i]!
          }
          byteOffset += buf.length
        }
      }

      const totalLines =
        stat.size === 0 ? 0 : lastByte === NEWLINE ? newlineCount : newlineCount + 1

      return new LineIndex(
        path,
        stat.size,
        stat.mtimeMs,
        stat.ino,
        totalLines,
        anchors,
        anchorEvery,
        readFileId(handle),
      )
    } finally {
      await handle.close()
    }
  }

  /**
   * Re-hydrate from a cached record (see ./cache.ts). Caller must verify the
   * cache is still valid against the file's current `mtime + size + ino`
   * before calling this.
   */
  static fromCache(record: {
    path: string
    size: number
    mtime: number
    ino: number
    anchorEvery: number
    totalLines: number
    fileId?: string
    anchors: ReadonlyArray<readonly [number, number]>
  }): LineIndex {
    return new LineIndex(
      record.path,
      record.size,
      record.mtime,
      record.ino,
      record.totalLines,
      record.anchors.map(([lineNumber, byteOffset]) => ({ lineNumber, byteOffset })),
      record.anchorEvery,
      record.fileId,
    )
  }

  /** Snapshot anchors for serialization. */
  exportAnchors(): [number, number][] {
    return this.anchors.map((a) => [a.lineNumber, a.byteOffset] as [number, number])
  }

  async appendDelta(): Promise<AppendResult> {
    const handle = await open(this.path, 'r')
    try {
      const stat = await handle.stat()
      if (
        stat.ino !== this.ino ||
        stat.size < this.size ||
        (this.fileId !== undefined && readFileId(handle) !== this.fileId)
      ) {
        return { added: 0, rotated: true }
      }
      if (stat.size === this.size) {
        return { added: 0, rotated: false }
      }

      const oldSize = this.size
      const oldTotal = this.totalLines

      // Read the byte just before the new region to know if the prior file ended
      // mid-line (no trailing newline). That decides whether `oldTotal`'s last
      // line is still incomplete or already counted.
      let lastByteOfPrev = -1
      if (oldSize > 0) {
        const buf = Buffer.alloc(1)
        await handle.read(buf, 0, 1, oldSize - 1)
        lastByteOfPrev = buf[0]!
      }

      // newlineCount that produced oldTotal:
      //   if last byte of prev was '\n' → newlineCount === oldTotal
      //   else → newlineCount === oldTotal - 1 (last line was incomplete)
      let newlineCount =
        oldSize === 0 || lastByteOfPrev === NEWLINE ? oldTotal : Math.max(oldTotal - 1, 0)

      let lastByte = lastByteOfPrev
      let byteOffset = oldSize

      const stream = handle.createReadStream({
        autoClose: false,
        start: oldSize,
        end: stat.size - 1,
        highWaterMark: 64 * 1024,
      })
      for await (const chunk of stream) {
        const buf = chunk as Buffer
        for (let i = 0; i < buf.length; i++) {
          if (buf[i] === NEWLINE) {
            newlineCount += 1
            if (newlineCount % this.anchorEvery === 0) {
              this.anchors.push({
                lineNumber: newlineCount + 1,
                byteOffset: byteOffset + i + 1,
              })
            }
          }
          lastByte = buf[i]!
        }
        byteOffset += buf.length
      }

      const newTotalLines = lastByte === NEWLINE ? newlineCount : newlineCount + 1
      const added = newTotalLines - oldTotal

      this.size = stat.size
      this.mtime = stat.mtimeMs
      this.totalLines = newTotalLines

      return { added, rotated: false }
    } finally {
      await handle.close()
    }
  }

  /**
   * Materialize lines `[endLine - count + 1 .. endLine]` (1-indexed, inclusive),
   * clamped to the file's actual range. Returns each line with its absolute
   * line number. Trailing newlines are stripped from the returned text.
   */
  async range(
    endLine: number,
    count: number,
    options: LineRangeOptions = {},
  ): Promise<LineRange[]> {
    if (count <= 0 || this.totalLines === 0) return []
    const maxLineBytes = options.maxLineBytes ?? Number.MAX_SAFE_INTEGER
    if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes <= 0) {
      throw new Error('maxLineBytes must be a positive safe integer')
    }

    const last = Math.min(endLine, this.totalLines)
    const first = Math.max(1, last - count + 1)
    if (first > last) return []

    const anchor = this.findAnchor(first)

    const handle = await fs.open(this.path, 'r')
    const metadata = await handle.stat().catch(async (error) => {
      await handle.close()
      throw error
    })
    if (
      metadata.ino !== this.ino ||
      metadata.size < this.size ||
      (this.fileId !== undefined && readFileId(handle) !== this.fileId)
    ) {
      await handle.close()
      throw Object.assign(new Error('log rotated before range read'), {
        code: 'SOURCE_UNAVAILABLE',
      })
    }
    const stream = handle.createReadStream({
      start: anchor.byteOffset,
      end: Math.max(this.size - 1, anchor.byteOffset),
      highWaterMark: 64 * 1024,
    })

    const result: LineRange[] = []
    let currentLine = anchor.lineNumber
    let currentLineParts: Buffer[] = []
    let currentLineBytes = 0

    const appendPart = (part: Buffer): void => {
      currentLineBytes += part.byteLength
      if (currentLineBytes > maxLineBytes) throw new Error('selected log line exceeds byte limit')
      currentLineParts.push(part)
    }

    for await (const chunk of stream) {
      const buf = chunk as Buffer
      let lineStart = 0
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === NEWLINE) {
          if (currentLine >= first && currentLine <= last) {
            appendPart(buf.subarray(lineStart, i))
            result.push({
              lineNumber: currentLine,
              text: Buffer.concat(currentLineParts).toString('utf8'),
            })
          }
          currentLineParts = []
          currentLineBytes = 0
          if (currentLine >= last && currentLine >= first) {
            return result
          }
          currentLine += 1
          lineStart = i + 1
        }
      }
      if (lineStart < buf.length) {
        if (currentLine >= first && currentLine <= last) {
          appendPart(buf.subarray(lineStart))
        }
      }
    }

    // Final line without trailing newline
    if (currentLineParts.length > 0 && currentLine >= first && currentLine <= last) {
      result.push({
        lineNumber: currentLine,
        text: Buffer.concat(currentLineParts).toString('utf8'),
      })
    }

    return result
  }

  private findAnchor(target: number): Anchor {
    let lo = 0
    let hi = this.anchors.length - 1
    let result = this.anchors[0]!
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      const a = this.anchors[mid]!
      if (a.lineNumber <= target) {
        result = a
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return result
  }
}

function readFileId(handle: unknown): string | undefined {
  if (typeof handle !== 'object' || handle === null) return undefined
  const id = Reflect.get(handle, 'fileId')
  return typeof id === 'string' ? id : undefined
}
