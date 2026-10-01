// Wiki page frontmatter: split / parse / serialize.
//
// The body is treated as opaque bytes on both paths — `parseWikiFrontmatter`
// returns everything after the closing `---` verbatim and `serializeWikiPage`
// concatenates it back untouched (gray-matter's content normalization is
// deliberately avoided, matching `code-review/parse.ts`). Frontmatter keys
// keep their declaration order because js-yaml dumps a plain object in
// insertion order, so unknown keys such as `owner:` survive every write in
// place.

import yaml from 'js-yaml'
import { splitFrontmatter } from '../frontmatter.js'
import type { WikiDeprecation, WikiFrontmatter } from './types.js'

export interface ParsedWikiFrontmatter {
  /** null when the file has no frontmatter block or its YAML is unusable. */
  frontmatter: WikiFrontmatter | null
  /** Everything after the closing delimiter, byte-for-byte. */
  body: string
  /** The raw YAML text between the delimiters (`''` when there is none). */
  raw: string
  /** Present when the YAML failed to parse or was not a mapping. */
  error?: string
}

/**
 * Split a page into frontmatter + body. Tolerant by design: a page whose
 * frontmatter is missing or broken still yields its body so the reader can
 * show it, and the caller turns `frontmatter === null` into diagnostics.
 */
export function parseWikiFrontmatter(content: string): ParsedWikiFrontmatter {
  const split = splitFrontmatter(content)
  if (split.status !== 'ok')
    return { frontmatter: null, body: content, raw: '', error: 'missing frontmatter' }
  const { raw, body } = split
  let data: unknown
  try {
    data = yaml.load(raw, { schema: yaml.JSON_SCHEMA })
  } catch (err) {
    return { frontmatter: null, body, raw, error: (err as Error).message }
  }
  if (data == null) return { frontmatter: {} as WikiFrontmatter, body, raw }
  if (typeof data !== 'object' || Array.isArray(data)) {
    return { frontmatter: null, body, raw, error: 'frontmatter is not a YAML mapping' }
  }
  return { frontmatter: data as WikiFrontmatter, body, raw }
}

/**
 * Render frontmatter + body back into a page file. Key order is the object's
 * own insertion order, so a parse → mutate → serialize round trip keeps
 * unknown keys where the author put them.
 */
export function serializeWikiPage(frontmatter: WikiFrontmatter, body: string): string {
  const dumped = yaml.dump(frontmatter, {
    schema: yaml.JSON_SCHEMA,
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
  })
  const yamlText = dumped.endsWith('\n') ? dumped : `${dumped}\n`
  return `---\n${yamlText}---\n${body}`
}

/**
 * Replace a subset of frontmatter keys, keeping declaration order for keys
 * that already exist and appending genuinely new ones at the end. `undefined`
 * removes a key. Used by every writer (`memon wiki set`, `move`, migration).
 */
export function updateWikiFrontmatter(
  frontmatter: WikiFrontmatter,
  patch: Record<string, unknown>,
): WikiFrontmatter {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(frontmatter)) {
    if (key in patch) {
      if (patch[key] !== undefined) next[key] = patch[key]
      continue
    }
    next[key] = value
  }
  for (const [key, value] of Object.entries(patch)) {
    if (key in frontmatter || value === undefined) continue
    next[key] = value
  }
  return next as WikiFrontmatter
}

/** Read `sources` / `tags`, dropping non-string members of a malformed list. */
export function wikiStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * Narrow a raw `deprecated` value to the object form. Returns null for absent
 * or non-object values; shape errors are the lint pass's business
 * (`WIKI_DEPRECATION_INVALID`), so a partial object still comes back here.
 */
export function wikiDeprecationValue(value: unknown): Partial<WikiDeprecation> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Partial<WikiDeprecation>
}
