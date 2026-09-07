// Deprecation (page level and section level) plus the bundle `entry` check.
//
// Page level: frontmatter `deprecated: { at, reason, superseded_by? }`. A
// deprecated page sorts last within its kind and is never reported stale —
// its sources are not expected to be current any more.
//
// Section level: a `> [!DEPRECATED] <reason>` blockquote directly under a
// heading marks that heading's section; the heading text lands in
// `deprecatedSections` so the list projection can show partially outdated
// pages without reading the body. The same marker anywhere else marks only
// its own blockquote but still needs a reason.

import { maskWikiCode } from './components.js'
import { wikiDeprecationValue } from './frontmatter.js'
import {
  WIKI_ID_REGEX,
  WIKI_TIMESTAMP_REGEX,
  type WikiDeprecation,
  type WikiDiagnostic,
  type WikiPageFormat,
} from './types.js'

const HEADING_REGEX = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const DEPRECATED_MARKER_REGEX = /^ {0,3}>\s*\[!DEPRECATED\]\s*(.*)$/
const BLOCKQUOTE_LINE_REGEX = /^ {0,3}>\s?(.*)$/
/** `since <YYYY-MM-DD>: <reason>` — the dated marker form. */
const DEPRECATED_SINCE_REGEX = /^since\s+(\d{4}-\d{2}-\d{2})\s*:\s*(.*)$/

export interface WikiDeprecationResult {
  deprecation: WikiDeprecation | null
  diagnostics: WikiDiagnostic[]
}

/**
 * Validate the frontmatter `deprecated` object. A malformed object still
 * marks the page deprecated (so it sorts last and stops going stale) as long
 * as it carries a usable `at`/`reason`; anything missing is reported as
 * `WIKI_DEPRECATION_INVALID`.
 */
export function validateWikiDeprecation(raw: unknown): WikiDeprecationResult {
  if (raw === undefined) return { deprecation: null, diagnostics: [] }
  const diagnostics: WikiDiagnostic[] = []
  const value = wikiDeprecationValue(raw)
  if (!value) {
    return {
      deprecation: null,
      diagnostics: [
        {
          code: 'WIKI_DEPRECATION_INVALID',
          severity: 'error',
          message: 'frontmatter `deprecated` must be an object with `at` and `reason`',
        },
      ],
    }
  }
  const at = typeof value.at === 'string' ? value.at.trim() : ''
  const reason = typeof value.reason === 'string' ? value.reason.trim() : ''
  if (!at) {
    diagnostics.push({
      code: 'WIKI_DEPRECATION_INVALID',
      severity: 'error',
      message: 'frontmatter `deprecated` is missing `at`',
    })
  } else if (!WIKI_TIMESTAMP_REGEX.test(at)) {
    diagnostics.push({
      code: 'WIKI_DEPRECATION_INVALID',
      severity: 'error',
      message: `frontmatter \`deprecated.at\` must be ISO8601 with an explicit offset; got "${at}"`,
    })
  }
  if (!reason) {
    diagnostics.push({
      code: 'WIKI_DEPRECATION_INVALID',
      severity: 'error',
      message: 'frontmatter `deprecated` is missing a non-empty `reason`',
    })
  }
  const supersededBy = typeof value.superseded_by === 'string' ? value.superseded_by.trim() : ''
  if (supersededBy && !WIKI_ID_REGEX.test(supersededBy)) {
    diagnostics.push({
      code: 'WIKI_DEPRECATION_INVALID',
      severity: 'error',
      message: `frontmatter \`deprecated.superseded_by\` must be W<NNNN>; got "${supersededBy}"`,
    })
  }
  return {
    deprecation: {
      at,
      reason,
      ...(supersededBy ? { superseded_by: supersededBy } : {}),
    },
    diagnostics,
  }
}

export interface WikiDeprecatedSection {
  /** Heading text the marker deprecates. */
  heading: string
  /** Heading level (1-6). */
  level: number
  /** 1-based line of the heading. */
  line: number
  /** Reason text after the marker. */
  reason: string
  /** `YYYY-MM-DD` from the `since <date>: <reason>` form, else null. */
  since: string | null
}

export interface WikiSectionDeprecationResult {
  sections: WikiDeprecatedSection[]
  diagnostics: WikiDiagnostic[]
}

/**
 * Find every `[!DEPRECATED]` callout in the body. Markers sitting directly
 * under a heading (only blank lines in between) deprecate that heading's
 * section; the rest are standalone callouts. A marker with no reason anywhere
 * is `WIKI_DEPRECATION_INVALID`. Pass `maskedBody` (from `maskWikiCode`) when
 * the caller already has one.
 */
export function findWikiDeprecatedSections(
  body: string,
  maskedBody?: string,
): WikiSectionDeprecationResult {
  const lines = (maskedBody ?? maskWikiCode(body)).split('\n')
  const sections: WikiDeprecatedSection[] = []
  const diagnostics: WikiDiagnostic[] = []
  let pendingHeading: { text: string; level: number; line: number } | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const heading = HEADING_REGEX.exec(line)
    if (heading) {
      pendingHeading = { text: heading[2]!.trim(), level: heading[1]!.length, line: index + 1 }
      continue
    }
    const marker = DEPRECATED_MARKER_REGEX.exec(line)
    if (!marker) {
      if (line.trim() !== '') pendingHeading = null
      continue
    }
    const reason = readMarkerReason(marker[1] ?? '', lines, index + 1)
    if (!reason.text) {
      diagnostics.push({
        code: 'WIKI_DEPRECATION_INVALID',
        severity: 'error',
        message: '`> [!DEPRECATED]` marker carries no reason',
        line: index + 1,
      })
    }
    if (pendingHeading) {
      sections.push({
        heading: pendingHeading.text,
        level: pendingHeading.level,
        line: pendingHeading.line,
        reason: reason.text,
        since: reason.since,
      })
    }
    pendingHeading = null
  }
  return { sections, diagnostics }
}

/**
 * Validate frontmatter `entry`. It is a bundle-only key naming an HTML
 * document inside the page directory; a missing target, a path escaping the
 * bundle, or an `entry` on a single-file page is `WIKI_ENTRY_MISSING`.
 */
export function validateWikiEntry(
  entry: string | undefined,
  page: { format: WikiPageFormat; assets: readonly string[] },
): WikiDiagnostic[] {
  if (entry === undefined) return []
  const raw = entry.trim()
  if (!raw) {
    return [
      {
        code: 'WIKI_ENTRY_MISSING',
        severity: 'error',
        message: 'frontmatter `entry` is empty',
      },
    ]
  }
  if (page.format !== 'bundle') {
    return [
      {
        code: 'WIKI_ENTRY_MISSING',
        severity: 'error',
        message: `frontmatter \`entry\` requires the bundle form; "${raw}" cannot exist beside a single-file page`,
      },
    ]
  }
  const normalized = normalizeBundlePath(raw)
  if (normalized === null || !page.assets.includes(normalized)) {
    return [
      {
        code: 'WIKI_ENTRY_MISSING',
        severity: 'error',
        message: `frontmatter \`entry\` points at "${raw}", which does not exist inside the bundle`,
      },
    ]
  }
  return []
}

/** Bundle-relative POSIX path, or null when the path escapes the bundle. */
function normalizeBundlePath(value: string): string | null {
  const segments: string[] = []
  for (const segment of value.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return null
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.length === 0 ? null : segments.join('/')
}

function readMarkerReason(
  firstLine: string,
  lines: string[],
  nextIndex: number,
): { text: string; since: string | null } {
  let text = firstLine.trim()
  if (!text) {
    // GitHub alert style: the marker line holds only the tag, the reason
    // continues on the following blockquote lines.
    for (let index = nextIndex; index < lines.length; index += 1) {
      const quoted = BLOCKQUOTE_LINE_REGEX.exec(lines[index]!)
      if (!quoted) break
      const content = quoted[1]!.trim()
      if (content) {
        text = content
        break
      }
    }
  }
  const dated = DEPRECATED_SINCE_REGEX.exec(text)
  if (dated) return { text: dated[2]!.trim(), since: dated[1]! }
  return { text, since: null }
}
