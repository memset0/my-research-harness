// appendJournalEvent — append a new event line to docs/journal.md without ever
// modifying the frontmatter.
//
// Strategy:
//   1. If an invocation ledger scope is active, the event is absorbed into
//      that receipt as typed metadata and NO bytes are written: the preserved
//      legacy file must not grow a second, duplicate history alongside the
//      receipt that already records the same operation.
//   2. Otherwise (an unscoped native caller) the historical behaviour is
//      unchanged: read file (or seed if missing), append at end, write
//      atomically via temp-file rename. No receipt is fabricated for a call
//      that no invocation claimed.
//
// If the file lacks a frontmatter block, we add `last_digest_at: null` first so
// subsequent reads of the legacy file have a deterministic shape. The cursor is
// retired: no supported code path writes a value into it.

import { writeFileAtomic } from '../atomic-write.js'
import { splitFrontmatter } from '../frontmatter.js'
import { projectFs as fs } from '../project-file-store.js'
import type { JournalEvent, JournalEventTag } from '../types.js'
import { captureLegacyJournalEvent } from './invocation.js'
import { formatJournalEvent } from './serialize.js'

export interface AppendJournalInput {
  /** Absolute path to the project's docs/journal.md */
  path: string
  /** Event to append */
  event: Pick<JournalEvent, 'timestamp' | 'tag' | 'body'> & { tag: JournalEventTag | string }
}

const SEED = '---\nlast_digest_at: null\n---\n\n'

export async function appendJournalEvent(input: AppendJournalInput): Promise<void> {
  const { path, event } = input
  if (captureLegacyJournalEvent(event)) return
  const line = formatJournalEvent(event)
  let existing: string
  try {
    existing = await fs.readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Seed and append
      await writeFileAtomic(path, `${SEED}${line}\n`, { fs, mkdir: true })
      return
    }
    throw err
  }

  if (!hasFrontmatter(existing)) {
    // Prepend seed frontmatter, preserving any existing body lines
    const updated = `${SEED}${existing.trimStart()}${existing.endsWith('\n') ? '' : '\n'}${line}\n`
    await writeFileAtomic(path, updated, { fs, mkdir: true })
    return
  }

  const updated = appendAfterFrontmatter(existing, line)
  await writeFileAtomic(path, updated, { fs, mkdir: true })
}

// ---------- internals ----------

function hasFrontmatter(content: string): boolean {
  return splitFrontmatter(content).status === 'ok'
}

function appendAfterFrontmatter(content: string, line: string): string {
  // We know hasFrontmatter is true. Append at end of file.
  if (content.endsWith('\n')) {
    return `${content}${line}\n`
  }
  return `${content}\n${line}\n`
}
