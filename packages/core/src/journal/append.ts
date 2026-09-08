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

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
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
      await atomicWrite(path, `${SEED}${line}\n`)
      return
    }
    throw err
  }

  if (!hasFrontmatter(existing)) {
    // Prepend seed frontmatter, preserving any existing body lines
    const updated = `${SEED}${existing.trimStart()}${existing.endsWith('\n') ? '' : '\n'}${line}\n`
    await atomicWrite(path, updated)
    return
  }

  const updated = appendAfterFrontmatter(existing, line)
  await atomicWrite(path, updated)
}

// ---------- internals ----------

function hasFrontmatter(content: string): boolean {
  if (!content.startsWith('---\n')) return false
  return content.indexOf('\n---\n', 4) !== -1 || content.indexOf('\n---', 4) !== -1
}

function appendAfterFrontmatter(content: string, line: string): string {
  // We know hasFrontmatter is true. Append at end of file.
  if (content.endsWith('\n')) {
    return `${content}${line}\n`
  }
  return `${content}\n${line}\n`
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const dir = dirname(path)
  // v2 path is `<root>/docs/journal.md`; the `docs/` parent may not exist yet
  // for a brand-new project (or a fresh test fixture). Idempotent mkdir -p
  // so the first append succeeds without forcing every caller to pre-create.
  await fs.mkdir(dir, { recursive: true })
  const tmp = join(dir, `.${Date.now()}-${Math.random().toString(36).slice(2)}.journal.tmp`)
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, path)
}
