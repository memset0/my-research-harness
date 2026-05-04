// memon journal {read,append,digest-mark}

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  appendJournalEvent,
  parseJournal,
  updateLastDigestAt,
  type JournalEventTag,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitJson, type OutputFormat } from '../lib/output.js'

const VALID_TAGS_FOR_APPEND: JournalEventTag[] = [
  'NOTE',
  'REQUEST',
  'ERROR',
  'ARCHIVE',
  'CREATE',
] as const // STATUS is excluded by design

export interface JournalReadInput {
  projectRoot?: string
  cwd: string
  format: OutputFormat
  since?: string
  tag?: string
  experimentId?: string
  limit?: number
}

export async function runJournalRead(input: JournalReadInput): Promise<void> {
  const ctx = await resolveContext({
    projectRoot: input.projectRoot,
    cwd: input.cwd,
  })
  const root = singleProjectRoot(ctx)
  const journalPath = join(root, 'JOURNAL.md')

  let parsed
  try {
    const content = await fs.readFile(journalPath, 'utf8')
    parsed = parseJournal(content)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      parsed = { lastDigestAt: null, events: [], parseErrors: [], parseWarnings: [] }
    } else {
      throw err
    }
  }

  let events = parsed.events
  if (input.since) {
    events = events.filter((e) => e.timestamp >= input.since!)
  }
  if (input.tag) {
    events = events.filter((e) => e.tag === input.tag)
  }
  if (input.experimentId) {
    events = events.filter((e) => e.experimentId === input.experimentId)
  }
  const limit = Math.max(1, Math.min(input.limit ?? 200, 1000))
  events = events.slice(0, limit)

  emitJson({
    path: journalPath,
    lastDigestAt: parsed.lastDigestAt,
    events,
  })
}

export interface JournalAppendInput {
  projectRoot?: string
  cwd: string
  tag: string
  body: string
  experimentId?: string
  at?: string
}

export async function runJournalAppend(input: JournalAppendInput): Promise<void> {
  if (input.tag === 'STATUS') {
    emitErrorAndExit(
      'BAD_REQUEST',
      "STATUS events must be emitted via 'memon experiment status set'",
    )
  }
  if (!(VALID_TAGS_FOR_APPEND as string[]).includes(input.tag)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `tag must be one of: ${VALID_TAGS_FOR_APPEND.join(', ')}`,
    )
  }
  if (!input.body.trim()) {
    emitErrorAndExit('BAD_REQUEST', 'body is required and must be non-empty')
  }

  const ctx = await resolveContext({
    projectRoot: input.projectRoot,
    cwd: input.cwd,
  })
  const root = singleProjectRoot(ctx)
  const journalPath = join(root, 'JOURNAL.md')

  const timestamp = input.at ?? nowIso()
  const expPart = input.experimentId ? `\`${input.experimentId}\` ` : ''
  await appendJournalEvent({
    path: journalPath,
    event: { timestamp, tag: input.tag as JournalEventTag, body: `${expPart}${input.body}` },
  })

  emitJson({ ok: true, appended: 1, timestamp, path: journalPath })
}

export interface JournalDigestMarkInput {
  projectRoot?: string
  cwd: string
  at: string
}

export async function runJournalDigestMark(input: JournalDigestMarkInput): Promise<void> {
  if (!isValidIso(input.at)) {
    emitErrorAndExit('BAD_REQUEST', `--at must be ISO8601 with offset, got: ${input.at}`)
  }
  const ctx = await resolveContext({
    projectRoot: input.projectRoot,
    cwd: input.cwd,
  })
  const root = singleProjectRoot(ctx)
  const journalPath = join(root, 'JOURNAL.md')

  // Seed with empty event list if missing — needed for the regex anchor
  try {
    await fs.access(journalPath)
  } catch {
    await fs.writeFile(journalPath, '---\nlast_digest_at: null\n---\n\n', 'utf8')
  }

  await updateLastDigestAt(journalPath, input.at)
  emitJson({ ok: true, lastDigestAt: input.at, path: journalPath })
}

function nowIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const absMin = Math.abs(offsetMin)
  const oh = pad(Math.floor(absMin / 60))
  const om = pad(absMin % 60)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`
}

function isValidIso(s: string): boolean {
  // YYYY-MM-DDTHH:MM:SS(+|-)HH:MM  or  ...Z
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/.test(s)
}
