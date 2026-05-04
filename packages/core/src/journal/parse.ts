// parseJournal — turn a JOURNAL.md body into structured events.
//
// Format (per spec):
//   ---
//   last_digest_at: 2026-05-03T10:00:00+08:00
//   ---
//
//   - 2026-05-03T08:28:00+08:00 [CREATE]   `foo-260503-082800` PENDING
//   - 2026-05-03T08:30:15+08:00 [STATUS]   `foo-260503-082800` PENDING → RUNNING
//   - 2026-05-03T10:15:00+08:00 [NOTE]     `foo-260503-082800` converged faster than expected
//   - 2026-05-03T11:00:00+08:00 [REQUEST]  please summarize experiments related to H0007

import matter from 'gray-matter'
import type { JournalEvent, ParseIssue, ParsedJournal, Status } from '../types.js'
import { JournalFrontMatterSchema } from '../schemas.js'
import { JOURNAL_TAG_VALUES, STATUS_VALUES } from '../types.js'
import { matterOptions } from '../yaml-engine.js'

const EVENT_LINE_REGEX = /^-\s+(\S+)\s+\[(\w+)\]\s+(.*)$/
const EXPERIMENT_BACKTICK_REGEX = /`([^`]+)`/
const STATUS_TRANSITION_REGEX = /^([A-Z]+)\s*→\s*([A-Z]+)\b/
const KNOWN_TAGS = new Set<string>(JOURNAL_TAG_VALUES)
const KNOWN_STATUSES = new Set<string>(STATUS_VALUES)

export function parseJournal(content: string): ParsedJournal {
  const errors: ParseIssue[] = []
  const warnings: ParseIssue[] = []

  let parsed: ReturnType<typeof matter>
  try {
    parsed = matter(content, matterOptions)
  } catch (err) {
    errors.push({
      message: `failed to parse JOURNAL frontmatter: ${(err as Error).message}`,
      severity: 'error',
    })
    return { lastDigestAt: null, events: [], parseErrors: errors, parseWarnings: warnings }
  }

  let lastDigestAt: string | null = null
  if (Object.keys(parsed.data).length === 0 && parsed.content === content) {
    // No frontmatter block at all
    warnings.push({
      message: 'JOURNAL.md has no frontmatter; lastDigestAt treated as null',
      severity: 'warning',
    })
  } else {
    const validation = JournalFrontMatterSchema.safeParse(parsed.data)
    if (!validation.success) {
      for (const issue of validation.error.issues) {
        errors.push({
          field: issue.path.join('.'),
          message: issue.message,
          severity: 'error',
        })
      }
    } else {
      lastDigestAt = validation.data.last_digest_at ?? null
    }
  }

  const events: JournalEvent[] = []
  const lineNumber = { i: 0 }
  for (const rawLine of parsed.content.split('\n')) {
    lineNumber.i += 1
    const line = rawLine.replace(/\r$/, '')
    if (line.trim() === '') continue
    const m = EVENT_LINE_REGEX.exec(line)
    if (!m) {
      // Lines that don't match are tolerated (could be prose) but warned about
      // unless they look totally empty / decorative
      if (line.startsWith('-')) {
        warnings.push({
          message: `line ${lineNumber.i}: malformed event line: ${line.slice(0, 80)}`,
          severity: 'warning',
        })
      }
      continue
    }
    const [, timestamp, tag, body] = m as unknown as [string, string, string, string]
    if (!KNOWN_TAGS.has(tag)) {
      warnings.push({
        message: `line ${lineNumber.i}: unknown event tag [${tag}] (kept as-is)`,
        severity: 'warning',
      })
    }
    const expMatch = EXPERIMENT_BACKTICK_REGEX.exec(body)
    const experimentId = expMatch ? expMatch[1]! : null

    let statusFrom: Status | null = null
    let statusTo: Status | null = null
    if (tag === 'STATUS') {
      // body looks like "`<id>` <FROM> → <TO>"
      const afterBackticks = expMatch ? body.slice(expMatch.index + expMatch[0].length).trim() : body
      const tm = STATUS_TRANSITION_REGEX.exec(afterBackticks)
      if (tm) {
        const [, from, to] = tm as unknown as [string, string, string]
        if (KNOWN_STATUSES.has(from)) statusFrom = from as Status
        if (KNOWN_STATUSES.has(to)) statusTo = to as Status
      }
    }
    events.push({
      timestamp,
      tag,
      body: body.trim(),
      experimentId,
      statusFrom,
      statusTo,
      raw: line,
    })
  }

  return {
    lastDigestAt,
    events,
    parseErrors: errors,
    parseWarnings: warnings,
  }
}
