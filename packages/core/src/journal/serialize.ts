// serializeJournal — render a ParsedJournal back to disk format.
// formatJournalEvent — render a single event line.
//
// Note on `last_digest_at` write protection: the appendJournalEvent helper
// in append.ts is the safe way to add events. serializeJournal regenerates
// the entire file including the frontmatter — only digest-mode code paths
// should ever need to call that.

import type { JournalEvent, ParsedJournal } from '../types.js'

export function formatJournalEvent(
  event: Pick<JournalEvent, 'timestamp' | 'tag' | 'body'>,
): string {
  return `- ${event.timestamp} [${event.tag}] ${event.body}`
}

export interface SerializeJournalInput {
  lastDigestAt: string | null
  events: ReadonlyArray<Pick<JournalEvent, 'timestamp' | 'tag' | 'body'>>
}

export function serializeJournal(input: SerializeJournalInput): string {
  const fmYaml = `last_digest_at: ${input.lastDigestAt === null ? 'null' : input.lastDigestAt}\n`
  const lines = input.events.map(formatJournalEvent)
  return `---\n${fmYaml}---\n\n${lines.join('\n')}${lines.length ? '\n' : ''}`
}

/**
 * Convenience to round-trip a previously parsed journal.
 */
export function reserializeJournal(parsed: ParsedJournal): string {
  return serializeJournal({
    lastDigestAt: parsed.lastDigestAt,
    events: parsed.events,
  })
}
