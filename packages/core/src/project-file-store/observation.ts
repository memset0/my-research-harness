// project-file-store/observation — observed values, their fingerprints,
// and the replayable negative (missing) answers.

import { createHash } from 'node:crypto'
import type { Stats } from 'node:fs'
import {
  type DirEntryData,
  type DirEntryKind,
  ProjectStats,
  type StatsFields,
} from '../project-io.js'

/** Directory entry kinds and stat fields travel with the isolated worker. */
export type CachedDirEntry = DirEntryData

export interface FileValue {
  kind: 'file'
  bytes: Buffer
  /** Lazily memoised utf8 decode — most project documents are read as utf8. */
  text?: string
}
export interface DirValue {
  kind: 'dir'
  entries: CachedDirEntry[]
}
export interface StatValue {
  kind: 'stat'
  stats: Stats
}
export interface PathValue {
  kind: 'path'
  target: string
}

export type PresentValue = FileValue | DirValue | StatValue | PathValue

/** A successful observation: either present data or a successful "missing". */
export interface Observation {
  present: boolean
  value: PresentValue | null
  /** The original ENOENT/ENOTDIR error, replayed on cached-missing hits. */
  missingError: NodeJS.ErrnoException | null
  fingerprint: string
  /** Cached content bytes attributable to this observation. */
  bytes: number
}

/**
 * Minimal `Dirent` reconstruction for cached listings. Node's `Dirent` is not
 * publicly constructible, and callers only use the name plus the type
 * predicates.
 */
export class CachedDirent {
  readonly name: string
  readonly parentPath: string
  private readonly kind: DirEntryKind

  constructor(name: string, parentPath: string, kind: DirEntryKind) {
    this.name = name
    this.parentPath = parentPath
    this.kind = kind
  }

  /** Deprecated alias Node still exposes. */
  get path(): string {
    return this.parentPath
  }

  isFile(): boolean {
    return this.kind === 'file'
  }
  isDirectory(): boolean {
    return this.kind === 'directory'
  }
  isSymbolicLink(): boolean {
    return this.kind === 'symlink'
  }
  isBlockDevice(): boolean {
    return false
  }
  isCharacterDevice(): boolean {
    return false
  }
  isFIFO(): boolean {
    return false
  }
  isSocket(): boolean {
    return false
  }
}

export function fileObservation(bytes: Buffer): Observation {
  return {
    present: true,
    value: { kind: 'file', bytes },
    missingError: null,
    fingerprint: `f:${bytes.length}:${createHash('sha1').update(bytes).digest('hex')}`,
    bytes: bytes.length,
  }
}

export function dirObservation(entries: CachedDirEntry[]): Observation {
  const hash = createHash('sha1')
  for (const name of entries.map((entry) => `${entry.kind[0]}${entry.name}`).sort()) {
    hash.update(name)
    hash.update('\u0000')
  }
  return {
    present: true,
    value: { kind: 'dir', entries },
    missingError: null,
    fingerprint: `d:${entries.length}:${hash.digest('hex')}`,
    bytes: Buffer.byteLength(JSON.stringify(entries)),
  }
}

export function statObservation(fields: StatsFields): Observation {
  return {
    present: true,
    value: { kind: 'stat', stats: new ProjectStats(fields) as unknown as Stats },
    missingError: null,
    fingerprint: `s:${String(fields.mtimeMs)}:${String(fields.size)}:${String(fields.ino)}:${String(fields.mode)}`,
    bytes: 0,
  }
}

export function pathObservation(target: string): Observation {
  return {
    present: true,
    value: { kind: 'path', target },
    missingError: null,
    fingerprint: `p:${target}`,
    bytes: 0,
  }
}

export function missingObservation(error: NodeJS.ErrnoException): Observation {
  return {
    present: false,
    value: null,
    missingError: error,
    fingerprint: `missing:${error.code ?? 'ENOENT'}`,
    bytes: 0,
  }
}

/** ENOENT / ENOTDIR are successful negative observations; everything else is an error. */
export function toNegativeOrThrow(error: unknown): Observation {
  const err = error as NodeJS.ErrnoException
  if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return missingObservation(err)
  throw err
}

/** The replayable negative error for a cached-missing observation. */
export function missingErrorOf(
  observation: Observation,
  absolutePath: string,
): NodeJS.ErrnoException {
  if (observation.missingError !== null) return observation.missingError
  const error = new Error(
    `ENOENT: no such file or directory, access '${absolutePath}'`,
  ) as NodeJS.ErrnoException
  error.code = 'ENOENT'
  error.errno = -2
  error.syscall = 'access'
  error.path = absolutePath
  return error
}
