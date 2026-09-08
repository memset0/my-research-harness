// readProjectJournal — explicit read of a project's legacy `docs/journal.md`.
//
// Journal is diagnostic operation history, not part of the research snapshot:
// `scanProjectRoot` deliberately never touches it. The callers that genuinely
// want legacy history (the CLI's diagnostic `journal read`, the Backend journal
// endpoint) ask for it by name, so a project whose history is missing or
// unreadable never breaks an ordinary scan.

import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ParsedJournal } from '../types.js'
import { parseJournal } from './parse.js'

/** Project-root-relative location of the legacy Journal file. */
export const JOURNAL_RELPATH = 'docs/journal.md'

export interface JournalSnapshot extends ParsedJournal {
  /** Absolute path when the legacy file exists, `null` when it does not. */
  path: string | null
}

const EMPTY: ParsedJournal = {
  lastDigestAt: null,
  events: [],
  parseErrors: [],
  parseWarnings: [],
}

/**
 * Read and parse `<projectRoot>/docs/journal.md`. A missing file is valid and
 * yields `path: null` with no events — memon never creates or seeds the legacy
 * file. Any other IO failure propagates so the caller can report it instead of
 * silently reporting empty history.
 */
export async function readProjectJournal(projectRoot: string): Promise<JournalSnapshot> {
  const path = join(resolve(projectRoot), 'docs', 'journal.md')
  let content: string
  try {
    content = await fs.readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { path: null, ...EMPTY }
    throw err
  }
  return { path, ...parseJournal(content) }
}
