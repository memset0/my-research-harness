// Layout of the derived index under `<projectRoot>/.memon/index/`.
//
//   .memon/index/
//     .gitignore            "*" — written before anything else
//     snapshot.json         merged state, replaced only by rename
//     compact.lock          lease of the current compactor (optional)
//     events/
//       <ts>-<pid>-<rand>.json   one write's upserts/removals
//       .tmp-<ts>-<pid>-<rand>   in-flight event (ignored by readers)
//     results/
//       <experiment-id>.json     generated Results summary (FS v9)
//       .<name>                  in-flight summary (ignored by readers)
//
// `<ts>` is the writer's epoch milliseconds zero-padded to 13 digits — an
// ordering key in a file name, never a timestamp field.

import { randomBytes } from 'node:crypto'
import { resolve } from '@memon/file-protocol/paths'

export const INDEX_DIR_RELPATH = '.memon/index'
export const INDEX_GITIGNORE_CONTENT = '*\n'

/** `<ts>-<pid>-<rand>.json`: 13-digit epoch ms, process id, 8 lowercase hex. */
export const EVENT_FILE_REGEX = /^(\d{13})-(\d+)-([0-9a-f]{8})\.json$/

export interface IndexPaths {
  rootAbs: string
  dir: string
  gitignore: string
  snapshot: string
  lock: string
  events: string
  /** Generated Results summaries, one `<experiment-id>.json` per Experiment. */
  results: string
}

/**
 * Resolve every index path for `projectRoot` and assert the result stays
 * inside the root after normalisation (the `fs-version/paths.ts` guard).
 */
export function resolveIndexPaths(projectRoot: string): IndexPaths {
  const rootAbs = resolve(projectRoot)
  const dir = resolve(rootAbs, '.memon', 'index')
  if (dir !== `${rootAbs === '/' ? '' : rootAbs}/.memon/index`) {
    throw new Error(`derived index path "${dir}" escapes project root "${rootAbs}"`)
  }
  return {
    rootAbs,
    dir,
    gitignore: `${dir}/.gitignore`,
    snapshot: `${dir}/snapshot.json`,
    lock: `${dir}/compact.lock`,
    events: `${dir}/events`,
    results: `${dir}/results`,
  }
}

/** Eight lowercase hex characters. */
export function randomHex8(): string {
  return randomBytes(4).toString('hex')
}

/** A fresh event file name for `now` and this process. */
export function eventFileName(now: Date = new Date(), pid: number = process.pid): string {
  return `${String(now.getTime()).padStart(13, '0')}-${pid}-${randomHex8()}.json`
}

/** True for a published event file name (dot files and temporaries excluded). */
export function isEventFileName(name: string): boolean {
  return EVENT_FILE_REGEX.test(name)
}

/** The writer's epoch milliseconds encoded in an event file name. */
export function eventFileTime(name: string): number | null {
  const match = EVENT_FILE_REGEX.exec(name)
  return match ? Number(match[1]) : null
}

/**
 * True for a project-relative POSIX path: no leading `/`, no backslash or
 * NUL, no empty, `.` or `..` segment. Index files store only such keys.
 */
export function isProjectRelativePath(value: string): boolean {
  if (value.length === 0 || value.startsWith('/') || /[\\\0]/.test(value)) return false
  if (/^[A-Za-z]:/.test(value)) return false
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}
