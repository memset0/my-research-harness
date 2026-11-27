import { randomUUID } from 'node:crypto'
import { isFileAccessError } from '@memon/file-protocol'
import { dirname, isFileURI } from '@memon/file-protocol/paths'
import { isScalar, parseDocument } from 'yaml'
import { writeFileAtomic } from '../atomic-write.js'
import { withFileWriterLock } from '../file-writer-lock.js'
import { ProjectCatalogSchema, publishDiscussionCatalog } from '../project-catalogs.js'
import { loadProjectDeclaration } from '../project-declaration/load.js'
import { getProjectFileContext, projectFileContextStorage } from '../project-file-context.js'
import { projectFs as fs } from '../project-file-store.js'
import { resolveProjectResource } from '../project-resource.js'
import { patchFrontMatterFields } from '../readme/frontmatter-patch.js'
import { formatIsoLocal } from '../time.js'
import { appendDiscussionLine } from './append.js'
import {
  DISCUSSION_ID,
  DISCUSSION_STATUSES,
  type DiscussionEvent,
  DiscussionEventSchema,
  type DiscussionStatus,
  DiscussionSummarySchema,
  discussionHash,
  parseDiscussion,
  parseDiscussionEvents,
  pendingDiscussionResponses,
  QUESTION_WORK_STATES,
  type QuestionDecider,
  QuestionMetadataSchema,
  type QuestionStatus,
  type QuestionWorkState,
  questionDisplayStatus,
  questionHistory,
  questionSettled,
  responseWithSection,
  validateDiscussionAnswer,
} from './model.js'
import { deriveDiscussionProgress, progressSegment } from './progress.js'
import { type ReportRegistration, resolveDiscussionRefs } from './refs.js'

export class DiscussionError extends Error {
  constructor(
    public readonly code: 'BAD_REQUEST' | 'NOT_FOUND' | 'NOT_REFRESHED' | 'CONFLICT' | 'PARTIAL',
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'DiscussionError'
  }
}
export async function freshDiscussionWork<T>(work: () => Promise<T>): Promise<T> {
  const context = getProjectFileContext()
  return context
    ? projectFileContextStorage().run({ ...context, observationPolicy: 'fresh' }, work)
    : work()
}
async function safePath(root: string, resource: string, forCreate = false): Promise<string> {
  return (await resolveProjectResource(root, resource, { forCreate })).path
}
async function optionalText(root: string, resource: string): Promise<string> {
  const resolved = await resolveProjectResource(root, resource, { forCreate: true })
  return resolved.exists ? fs.readFile(resolved.path, 'utf8') : ''
}

export async function discussionRegistrations(root: string) {
  try {
    const text = await fs.readFile(await safePath(root, '.memon/index/discussions.json'), 'utf8')
    const catalog = ProjectCatalogSchema.parse(JSON.parse(text))
    if (catalog.kind !== 'discussions') throw new Error('catalog kind mismatch')
    return catalog.entries.map((entry) => {
      if (!entry.resource.startsWith(`docs/discussions/${entry.id}-`))
        throw new Error('discussion catalog identity mismatch')
      return { ...entry, summary: DiscussionSummarySchema.parse(entry.summary) }
    })
  } catch (e) {
    if (isFileAccessError(e)) throw e
    throw new DiscussionError(
      'NOT_REFRESHED',
      'Discussion catalog is missing or invalid; run memon refresh at the project source',
      { cause: String(e) },
    )
  }
}
/**
 * Published Report registrations for citation titles. A missing or unreadable Reports catalog
 * yields none, so citations show as unresolved instead of failing the discussion read.
 */
export async function reportRegistrations(root: string): Promise<ReportRegistration[]> {
  try {
    const resolved = await resolveProjectResource(root, '.memon/index/reports.json', {
      forCreate: true,
    })
    if (!resolved.exists) return []
    const catalog = ProjectCatalogSchema.parse(JSON.parse(await fs.readFile(resolved.path, 'utf8')))
    if (catalog.kind !== 'reports') return []
    return catalog.entries.map((e) => ({
      id: e.id,
      resource: e.resource,
      title: String(e.summary.title ?? e.id),
    }))
  } catch (e) {
    if (isFileAccessError(e)) throw e
    return []
  }
}
export async function loadDiscussion(root: string, id: string, allowDraft = false) {
  if (!DISCUSSION_ID.test(id))
    throw new DiscussionError('BAD_REQUEST', 'Use a padded discussion ID such as D0001')
  const entry = (await discussionRegistrations(root)).find((e) => e.id === id)
  if (!entry)
    throw new DiscussionError(
      'NOT_FOUND',
      `Discussion ${id} is not registered; run memon refresh after authoring it`,
    )
  const path = await safePath(root, entry.resource)
  const [source, stat] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
  const parsed = parseDiscussion(source)
  if (parsed.status === 'DRAFT' && !allowDraft)
    throw new DiscussionError('NOT_FOUND', 'Discussion is still being prepared')
  const logResource = `${dirname(entry.resource)}/responses.jsonl`
  const log = await optionalText(root, logResource)
  const history = parseDiscussionEvents(log)
  const cited = resolveDiscussionRefs(
    entry.resource,
    parsed.questions,
    history.events,
    await reportRegistrations(root),
  )
  const questions = parsed.questions.map((q) => {
    const displayStatus = questionDisplayStatus(q, history.events)
    return {
      ...q,
      displayStatus,
      segment: progressSegment({
        type: q.metadata?.type,
        status: q.metadata?.status,
        work: q.metadata?.work,
        displayStatus,
      }),
      history: questionHistory(q, history.events),
      refs: (q.metadata && cited.refs.get(q.metadata.id)) || [],
    }
  })
  return {
    id,
    slug: entry.slug,
    resource: entry.resource,
    ...parsed,
    diagnostics: [...parsed.diagnostics, ...cited.diagnostics],
    questions,
    progress: deriveDiscussionProgress(
      questions.map((q) => ({
        type: q.metadata?.type,
        status: q.metadata?.status,
        work: q.metadata?.work,
        displayStatus: q.displayStatus,
      })),
    ),
    events: history.events,
    historyDiagnostics: history.diagnostics,
    mtime: stat.mtimeMs,
    hash: discussionHash(source),
    source,
    logResource,
    logSize: Buffer.byteLength(log),
  }
}
export type DiscussionDocument = Awaited<ReturnType<typeof loadDiscussion>>
export async function listDiscussions(root: string, allowDraft = false) {
  const entries = await discussionRegistrations(root)
  const summaries = []
  for (const entry of entries) {
    const summary = entry.summary
    if (!allowDraft && summary.status === 'DRAFT') continue
    // Published identities drive inventories; only registered response logs are read.
    const history = parseDiscussionEvents(
      await optionalText(root, `${dirname(entry.resource)}/responses.jsonl`),
    )
    const questions = summary.questions.map((q) => {
      const displayStatus = questionDisplayStatus(
        {
          metadata: q.id && q.status ? { id: q.id, status: q.status, type: q.type } : null,
          snapshot: q.snapshot,
        },
        history.events,
      )
      return { ...q, displayStatus, segment: progressSegment({ ...q, displayStatus }) }
    })
    summaries.push({
      ...summary,
      historyDiagnostics: history.diagnostics,
      questions,
      progress: deriveDiscussionProgress(questions),
    })
  }
  return summaries
}
export async function appendDiscussionEvent(
  root: string,
  logResource: string,
  event: DiscussionEvent,
): Promise<void> {
  const parsed = DiscussionEventSchema.parse(event)
  const line = `${JSON.stringify(parsed)}\n`
  for (let attempt = 0; attempt < 4; attempt++) {
    const text = await freshDiscussionWork(() => optionalText(root, logResource))
    const history = parseDiscussionEvents(text)
    if (history.diagnostics.length)
      throw new DiscussionError(
        'BAD_REQUEST',
        'Repair the malformed response log before appending',
        history.diagnostics,
      )
    const prior = parsed.id ? history.events.find((e) => e.id === parsed.id) : undefined
    if (prior) {
      if (JSON.stringify(prior) === JSON.stringify(parsed)) return
      throw new DiscussionError('CONFLICT', 'Event identity already belongs to different content')
    }
    try {
      await appendDiscussionLine(root, logResource, line, Buffer.byteLength(text))
      return
    } catch (e) {
      if (!isFileAccessError(e) || e.code !== 'CONFLICT' || attempt === 3) throw e
    }
  }
}
export async function respondToDiscussion(
  root: string,
  id: string,
  input: { question: string; snapshot: string; answer: unknown; responseId?: string },
) {
  return freshDiscussionWork(() =>
    withFileWriterLock(root, async () => {
      const doc = await loadDiscussion(root, id, true)
      if (doc.status !== 'OPEN')
        throw new DiscussionError('CONFLICT', 'Discussion is closed; reload its current state')
      const q = doc.questions.find((q) => q.metadata?.id === input.question)
      if (!q?.metadata) throw new DiscussionError('BAD_REQUEST', 'Question is missing or invalid')
      if (q.snapshot !== input.snapshot)
        throw new DiscussionError(
          'CONFLICT',
          'Question changed; review the current version before answering',
        )
      let answer: ReturnType<typeof validateDiscussionAnswer>
      try {
        answer = validateDiscussionAnswer(q.metadata, input.answer)
      } catch (e) {
        throw new DiscussionError('BAD_REQUEST', String(e))
      }
      if (input.responseId) {
        const prior = doc.events.find((e) => e.type === 'response' && e.id === input.responseId)
        if (prior?.type === 'response') {
          const same =
            prior.question === input.question &&
            prior.snapshot === input.snapshot &&
            ['choice', 'choices', 'confirm', 'text', 'comment'].every(
              (key) =>
                JSON.stringify(Reflect.get(prior, key)) ===
                JSON.stringify(Reflect.get(answer, key)),
            )
          if (!same)
            throw new DiscussionError(
              'CONFLICT',
              'Response identity already belongs to different content',
            )
          return doc
        }
      }
      let event: ReturnType<typeof responseWithSection>
      try {
        event = responseWithSection(
          {
            type: 'response',
            id: input.responseId ?? randomUUID(),
            question: q.metadata.id,
            at: formatIsoLocal(new Date()),
            by: 'owner',
            snapshot: q.snapshot,
            section_hash: q.sectionHash,
            ...answer,
          },
          q.section,
        )
      } catch (error) {
        throw new DiscussionError('BAD_REQUEST', String(error))
      }
      await appendDiscussionEvent(root, doc.logResource, event)
      return loadDiscussion(root, id)
    }),
  )
}
async function guardedSourceWrite(
  root: string,
  resource: string,
  next: string,
  expected: { mtime: number; hash: string },
): Promise<void> {
  const path = await safePath(root, resource)
  const [source, stat] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
  if (stat.mtimeMs !== expected.mtime || discussionHash(source) !== expected.hash)
    throw new DiscussionError('CONFLICT', 'Discussion changed concurrently; reload before writing')
  await writeFileAtomic(path, next, isFileURI(root) ? {} : { mode: stat.mode & 0o7777 })
}
function scalarPatches(
  text: string,
  changes: Array<{ keys: (string | number)[]; value: unknown }>,
): string {
  const doc = parseDocument(text)
  if (doc.errors.length) throw new DiscussionError('BAD_REQUEST', 'Invalid catalog JSON')
  const patches = changes
    .map(({ keys, value }) => {
      const node = doc.getIn(keys, true)
      if (!isScalar(node) || !node.range)
        throw new DiscussionError('BAD_REQUEST', 'Missing catalog status or mtime field')
      return { start: node.range[0], end: node.range[1], value: JSON.stringify(value) }
    })
    .sort((a, b) => b.start - a.start)
  for (const patch of patches)
    text = text.slice(0, patch.start) + patch.value + text.slice(patch.end)
  return text
}
export async function setDiscussionStatus(
  root: string,
  id: string,
  status: DiscussionStatus,
  expected?: { mtime: number; hash: string },
  browser = false,
) {
  if (!DISCUSSION_STATUSES.includes(status))
    throw new DiscussionError('BAD_REQUEST', 'Invalid discussion status')
  return freshDiscussionWork(() =>
    withFileWriterLock(root, async () => {
      const doc = await loadDiscussion(root, id, !browser)
      if (browser && (doc.status === 'DRAFT' || status === 'DRAFT'))
        throw new DiscussionError('BAD_REQUEST', 'Only agents publish drafts')
      const next = patchFrontMatterFields(doc.source, { status: JSON.stringify(status) })
      await guardedSourceWrite(root, doc.resource, next, expected ?? doc)
      const stat = await fs.stat(await safePath(root, doc.resource))
      const catalogResource = '.memon/index/discussions.json'
      const catalogPath = await safePath(root, catalogResource)
      const [catalogText, catalogStat] = await Promise.all([
        fs.readFile(catalogPath, 'utf8'),
        fs.stat(catalogPath),
      ])
      const catalog = ProjectCatalogSchema.parse(JSON.parse(catalogText))
      const index = catalog.entries.findIndex((e) => e.id === id)
      if (index < 0)
        throw new DiscussionError(
          'PARTIAL',
          'Status saved; run memon refresh to repair its missing catalog registration',
        )
      const patched = scalarPatches(catalogText, [
        { keys: ['entries', index, 'summary', 'status'], value: status },
        { keys: ['entries', index, 'summary', 'mtime'], value: stat.mtimeMs },
      ])
      try {
        await guardedSourceWrite(root, catalogResource, patched, {
          mtime: catalogStat.mtimeMs,
          hash: discussionHash(catalogText),
        })
      } catch (e) {
        throw new DiscussionError(
          'PARTIAL',
          'Status saved but catalog update failed; retry or run memon refresh',
          { cause: String(e) },
        )
      }
      return loadDiscussion(root, id, !browser)
    }),
  )
}
export async function createDiscussion(root: string, slug: string, title: string) {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    !title.trim() ||
    title.length > 512 ||
    /[\r\n]/.test(title)
  )
    throw new DiscussionError(
      'BAD_REQUEST',
      'Provide a lowercase hyphenated slug and a one-line title',
    )
  if (!(await loadProjectDeclaration(root)))
    throw new DiscussionError(
      'BAD_REQUEST',
      'Declare this project in .memon/project.yml before creating a discussion',
    )
  return withFileWriterLock(root, async () => {
    const dir = await safePath(root, 'docs/discussions', true)
    await fs.mkdir(dir, { recursive: true })
    const ids = (await fs.readdir(dir)).flatMap((name) =>
      /^D\d{4}-/.test(name) ? [Number(name.slice(1, 5))] : [],
    )
    const n = Math.max(0, ...ids) + 1
    if (n > 9999) throw new DiscussionError('BAD_REQUEST', 'Discussion ID range exhausted')
    const id = `D${String(n).padStart(4, '0')}`
    const resource = `docs/discussions/${id}-${slug}/README.md`
    const path = await safePath(root, resource, true)
    await fs.mkdir(dirname(path))
    await fs.writeFile(
      path,
      `---\ntitle: ${JSON.stringify(title.trim())}\nstatus: DRAFT\n---\n\n`,
      { flag: 'wx' },
    )
    await publishDiscussionCatalog(root)
    return loadDiscussion(root, id, true)
  })
}
function questionTarget(target: string): [string, string] {
  const [id, questionId, extra] = target.split('/')
  if (!id || !questionId || extra) throw new DiscussionError('BAD_REQUEST', 'Use D0001/QUESTION-ID')
  return [id, questionId]
}
/**
 * Rewrite fields of one question fence under mtime-and-hash locking. `undefined` leaves a field
 * alone and `null` removes it; every byte outside that fence is preserved.
 */
async function writeQuestionFields(
  root: string,
  doc: DiscussionDocument,
  q: DiscussionDocument['questions'][number],
  fields: Record<string, unknown>,
  expected: { mtime: number; hash: string },
) {
  try {
    const merged: Record<string, unknown> = { ...q.metadata }
    for (const [key, value] of Object.entries(fields))
      if (value === null) delete merged[key]
      else if (value !== undefined) merged[key] = value
    QuestionMetadataSchema.parse(merged)
  } catch (e) {
    throw new DiscussionError('BAD_REQUEST', String(e))
  }
  const fence = doc.source.slice(q.fenceStart, q.fenceEnd)
  const begin = fence.indexOf('\n') + 1,
    end = fence.lastIndexOf('\n')
  const yaml = parseDocument(fence.slice(begin, end))
  for (const [key, value] of Object.entries(fields))
    if (value === null) yaml.delete(key)
    else if (value !== undefined) yaml.set(key, value)
  const newline = fence.includes('\r\n') ? '\r\n' : '\n'
  const content = yaml.toString().trimEnd().replace(/\r?\n/g, newline)
  const next =
    doc.source.slice(0, q.fenceStart) +
    fence.slice(0, begin) +
    content +
    newline +
    fence.slice(end + 1) +
    doc.source.slice(q.fenceEnd)
  await guardedSourceWrite(root, doc.resource, next, expected)
}
export async function resolveDiscussionQuestion(
  root: string,
  target: string,
  input: {
    status: QuestionStatus
    decision?: unknown
    note?: string
    work?: QuestionWorkState
    by?: QuestionDecider
    expectedMtime?: number
    expectedHash?: string
  },
) {
  const [id, questionId] = questionTarget(target)
  return freshDiscussionWork(() =>
    withFileWriterLock(root, async () => {
      const doc = await loadDiscussion(root, id, true)
      const q = doc.questions.find((q) => q.metadata?.id === questionId)
      if (!q?.metadata) throw new DiscussionError('BAD_REQUEST', 'Question is missing or invalid')
      const pending = pendingDiscussionResponses(q.history)
      // Who settled it: the owner when this resolve processes their feedback, else the agent.
      const decidedBy =
        input.status === 'DECIDED' ? (input.by ?? (pending.length ? 'owner' : 'agent')) : null
      await writeQuestionFields(
        root,
        doc,
        q,
        {
          status: input.status,
          decision: input.decision,
          rationale: input.note,
          work: input.work,
          decided_by: q.metadata.type === 'subgoal' ? undefined : decidedBy,
        },
        { mtime: input.expectedMtime ?? doc.mtime, hash: input.expectedHash ?? doc.hash },
      )
      const acked: string[] = []
      try {
        for (const r of pending) {
          await appendDiscussionEvent(root, doc.logResource, {
            type: 'ack',
            id: randomUUID(),
            response: r.id,
            at: formatIsoLocal(new Date()),
            by: 'agent',
            ...(input.note ? { note: input.note } : {}),
          })
          acked.push(r.id)
        }
        await publishDiscussionCatalog(root)
      } catch (e) {
        throw new DiscussionError(
          'PARTIAL',
          'Question metadata saved; some acknowledgements or catalog publication remain',
          {
            acked,
            remaining: pending.filter((r) => !acked.includes(r.id)).map((r) => r.id),
            cause: String(e),
          },
        )
      }
      return loadDiscussion(root, id, true)
    }),
  )
}
/** Set one question's implementation state; never acknowledges feedback. */
export async function setDiscussionWork(
  root: string,
  target: string,
  work: QuestionWorkState,
  expected?: { mtime: number; hash: string },
) {
  if (!QUESTION_WORK_STATES.includes(work))
    throw new DiscussionError(
      'BAD_REQUEST',
      `work must be one of ${QUESTION_WORK_STATES.join(', ')}`,
    )
  const [id, questionId] = questionTarget(target)
  return freshDiscussionWork(() =>
    withFileWriterLock(root, async () => {
      const doc = await loadDiscussion(root, id, true)
      const q = doc.questions.find((q) => q.metadata?.id === questionId)
      if (!q?.metadata) throw new DiscussionError('BAD_REQUEST', 'Question is missing or invalid')
      if ((work === 'DOING' || work === 'DONE') && !questionSettled(q.metadata))
        throw new DiscussionError(
          'BAD_REQUEST',
          `work ${work} requires a DECIDED question or a subgoal; resolve it first`,
        )
      await writeQuestionFields(root, doc, q, { work }, expected ?? doc)
      try {
        await publishDiscussionCatalog(root)
      } catch (e) {
        throw new DiscussionError('PARTIAL', 'Work saved; run memon refresh to republish', {
          cause: String(e),
        })
      }
      return loadDiscussion(root, id, true)
    }),
  )
}
export async function replyToDiscussion(root: string, target: string, text: string) {
  const [id, questionId, extra] = target.split('/')
  if (!id || !questionId || extra || !text.trim())
    throw new DiscussionError('BAD_REQUEST', 'Provide D0001/QUESTION-ID and a nonempty reply')
  const doc = await loadDiscussion(root, id, true)
  if (!doc.questions.some((q) => q.metadata?.id === questionId))
    throw new DiscussionError('BAD_REQUEST', 'Question is missing or invalid')
  await appendDiscussionEvent(root, doc.logResource, {
    type: 'reply',
    id: randomUUID(),
    question: questionId,
    at: formatIsoLocal(new Date()),
    by: 'agent',
    text: text.trim(),
  })
  // Replies can cite Reports, so the published citation index follows them.
  try {
    await publishDiscussionCatalog(root)
  } catch (e) {
    throw new DiscussionError('PARTIAL', 'Reply saved; run memon refresh to republish', {
      cause: String(e),
    })
  }
  return loadDiscussion(root, id, true)
}
/**
 * Questions in published (OPEN/CLOSED) discussions that cite one Report, from catalog
 * registrations only. Drafts never appear.
 */
export async function discussionCitations(root: string, report: string) {
  if (!/^R\d{4}$/.test(report))
    throw new DiscussionError('BAD_REQUEST', 'Use a padded Report ID such as R0001')
  const citations = []
  for (const d of await listDiscussions(root))
    for (const q of d.questions) {
      const refs = (q.refs ?? []).filter((r) => r.report === report)
      if (!q.id || !refs.length) continue
      citations.push({
        discussion: d.id,
        discussionTitle: d.title,
        discussionStatus: d.status,
        question: q.id,
        title: q.title,
        displayStatus: q.displayStatus,
        anchors: [...new Set(refs.flatMap((r) => (r.anchor ? [r.anchor] : [])))],
      })
    }
  return { report, citations }
}
