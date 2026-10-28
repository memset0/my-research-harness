// Title-only rewrites of Report and Wiki documents and their catalog entries.
//
// A title edit may run on a Project whose File Agent grant only admits small
// document replacements, so every function here changes the title bytes and
// nothing else: other keys, formatting, comments and the body come back
// exactly as they were.

import { splitFrontmatter } from './frontmatter.js'
import { patchFrontMatterFields } from './readme/frontmatter-patch.js'

export const MAX_DOCUMENT_TITLE_LENGTH = 512

/**
 * Bytes a `read-edit` File Agent grant lets one replacement change: the larger
 * of the old and new byte counts outside their common prefix and suffix.
 */
export const SCOPED_EDIT_MAX_SPAN = 4096

export class DocumentTitleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentTitleError'
  }
}

/** The trimmed title, or a {@link DocumentTitleError} for an unusable one. */
export function normalizeDocumentTitle(input: unknown): string {
  if (typeof input !== 'string') throw new DocumentTitleError('Title must be a string')
  const title = input.trim()
  if (!title) throw new DocumentTitleError('Title must not be empty')
  if (/[\r\n]/.test(title)) throw new DocumentTitleError('Title must be a single line')
  if (title.length > MAX_DOCUMENT_TITLE_LENGTH)
    throw new DocumentTitleError(`Title must be at most ${MAX_DOCUMENT_TITLE_LENGTH} characters`)
  return title
}

/** The changed span of two texts in UTF-8 bytes, as the File Agent measures it. */
export function changedByteSpan(before: string, after: string): number {
  const a = new TextEncoder().encode(before)
  const b = new TextEncoder().encode(after)
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix += 1
  return Math.max(a.length - prefix - suffix, b.length - prefix - suffix)
}

/** Offset just past the JSON string starting at `start` (a `"`). */
function stringEnd(text: string, start: number): number {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === '\\') index += 1
    else if (text[index] === '"') return index + 1
  }
  throw new DocumentTitleError('Manifest is not valid JSON')
}

/** Source range of the string value of a top-level key in a JSON object. */
function topLevelStringRange(text: string, key: string): [number, number] | null {
  let depth = 0
  let expectKey = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      const end = stringEnd(text, index)
      if (depth === 1 && expectKey) {
        const name = JSON.parse(text.slice(index, end)) as string
        let cursor = end
        while (/\s/.test(text[cursor] ?? '')) cursor += 1
        if (text[cursor] !== ':') throw new DocumentTitleError('Manifest is not valid JSON')
        cursor += 1
        while (/\s/.test(text[cursor] ?? '')) cursor += 1
        if (name === key) return text[cursor] === '"' ? [cursor, stringEnd(text, cursor)] : null
        expectKey = false
        index = cursor - 1
        continue
      }
      index = end - 1
    } else if (char === '{' || char === '[') {
      depth += 1
      expectKey = depth === 1 && char === '{'
    } else if (char === '}' || char === ']') {
      depth -= 1
    } else if (char === ',' && depth === 1) {
      expectKey = true
    }
  }
  return null
}

/** Replace the top-level `title` string of a manifest. */
export function setManifestTitle(text: string, title: string): string {
  try {
    JSON.parse(text)
  } catch {
    throw new DocumentTitleError('Manifest is not valid JSON')
  }
  const range = topLevelStringRange(text, 'title')
  if (!range) throw new DocumentTitleError('Manifest has no title string')
  return text.slice(0, range[0]) + JSON.stringify(title) + text.slice(range[1])
}

const H1_LINE = /^#[ \t]+\S.*$/
const FENCE_LINE = /^```/

/**
 * Set a Markdown document's title: the frontmatter `title` (added when the
 * block lacks it); without frontmatter, the first H1 outside code fences, or a
 * new frontmatter block holding the title when there is no H1.
 */
export function setMarkdownTitle(text: string, title: string): string {
  const quoted = JSON.stringify(title)
  const split = splitFrontmatter(text)
  if (split.status === 'unterminated')
    throw new DocumentTitleError('Frontmatter block is not terminated')
  if (split.status === 'ok') {
    try {
      return patchFrontMatterFields(text, { title: quoted })
    } catch (error) {
      throw new DocumentTitleError((error as Error).message)
    }
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  let inFence = false
  let offset = 0
  for (const line of text.split('\n')) {
    const bare = line.endsWith('\r') ? line.slice(0, -1) : line
    if (FENCE_LINE.test(bare)) inFence = !inFence
    else if (!inFence && H1_LINE.test(bare)) {
      return `${text.slice(0, offset)}# ${title}${text.slice(offset + bare.length)}`
    }
    offset += line.length + 1
  }
  const bom = text.charCodeAt(0) === 0xfeff ? '﻿' : ''
  return `${bom}---${newline}title: ${quoted}${newline}---${newline}${text.slice(bom.length)}`
}

/**
 * The published catalog text with one entry's summary `title` (and `mtime`,
 * when given and present) replaced. Other bytes keep the catalog writer's
 * two-space JSON layout.
 */
export function setCatalogEntryTitle(
  text: string,
  id: string,
  change: { title?: string; mtime?: number },
): string {
  let catalog: { entries?: Array<{ id?: unknown; summary?: Record<string, unknown> }> }
  try {
    catalog = JSON.parse(text)
  } catch {
    throw new DocumentTitleError('Catalog is not valid JSON')
  }
  const entry = catalog.entries?.find((item) => item.id === id)
  if (!entry?.summary) throw new DocumentTitleError(`Catalog has no entry ${id}`)
  if (change.title !== undefined) entry.summary.title = change.title
  if (change.mtime !== undefined && 'mtime' in entry.summary) entry.summary.mtime = change.mtime
  return `${JSON.stringify(catalog, null, 2)}\n`
}
