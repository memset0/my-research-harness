// appendJournalEvent — append a new event line to docs/journal.md without ever
// modifying the frontmatter (which only the digest agent may touch).
//
// Strategy:
//   1. Read file (or seed if missing)
//   2. Locate the closing `---` of the frontmatter block; preserve everything
//      up to and including the blank line after it
//   3. Append new line(s) at end
//   4. Write atomically via temp-file rename
//
// If the file lacks a frontmatter block, we add `last_digest_at: null` first
// so subsequent reads have a deterministic shape.

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { JournalEvent, JournalEventTag } from '../types.js'
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

/**
 * For the digest agent: rewrite ONLY the `last_digest_at` field, preserving the
 * body verbatim. Throws if no frontmatter is present.
 */
export async function updateLastDigestAt(path: string, isoTimestamp: string): Promise<void> {
  const existing = await fs.readFile(path, 'utf8')
  if (!hasFrontmatter(existing)) {
    throw new Error(`cannot update last_digest_at: ${path} has no frontmatter`)
  }
  const replaced = replaceLastDigestAt(existing, isoTimestamp)
  await atomicWrite(path, replaced)
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

function replaceLastDigestAt(content: string, isoTimestamp: string): string {
  const closing = content.indexOf('\n---', 4)
  if (closing === -1) return content
  const fmBlock = content.slice(4, closing)
  const rest = content.slice(closing)
  const fmLines = fmBlock.split('\n')
  let replaced = false
  const newLines = fmLines.map((l) => {
    if (l.startsWith('last_digest_at:')) {
      replaced = true
      return `last_digest_at: ${isoTimestamp}`
    }
    return l
  })
  if (!replaced) {
    newLines.push(`last_digest_at: ${isoTimestamp}`)
  }
  return `---\n${newLines.join('\n')}${rest}`
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
