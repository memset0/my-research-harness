import { createHash } from 'node:crypto'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { parseDocument } from 'yaml'
import { z } from 'zod'
import {
  DISCUSSION_STATUSES,
  type DiscussionStatus,
  QUESTION_STATUSES,
  type QuestionStatus,
} from '../types.js'

export const DISCUSSION_ID = /^D\d{4}$/
export const QUESTION_ID = /^[A-Z0-9][A-Z0-9-]{0,63}$/
export const DISCUSSION_DIRECTORY = /^D\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/
export type { DiscussionStatus, QuestionStatus } from '../types.js'
export { DISCUSSION_STATUSES, QUESTION_STATUSES } from '../types.js'
export type QuestionDisplayStatus = QuestionStatus | 'ANSWERED' | 'REVISED'
const decisionSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1), z.boolean()])
export const QuestionMetadataSchema = z
  .object({
    id: z.string().regex(QUESTION_ID),
    type: z.enum(['choice', 'multi', 'confirm', 'text']),
    category: z.string().trim().min(1).max(128),
    status: z.enum(QUESTION_STATUSES),
    options: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            label: z.string().min(1),
            detail: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    prefer: z
      .object({
        option: z.union([z.string(), z.array(z.string()), z.boolean()]),
        reason: z.string().optional(),
      })
      .strict()
      .optional(),
    decision: decisionSchema.optional(),
    rationale: z.string().optional(),
  })
  .passthrough()
  .superRefine((q, ctx) => {
    const options = q.options?.map((o) => o.id) ?? []
    const error = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message })
    if (new Set(options).size !== options.length) error('option IDs must be unique')
    if (['text', 'confirm'].includes(q.type) && q.options !== undefined)
      error('options require choice or multi type')
    if (q.prefer && (q.type === 'text' || !validSelection(q.type, q.prefer.option, options)))
      error('preference must match the question type and options')
    if (q.status === 'DECIDED' && q.decision === undefined) error('DECIDED requires decision')
    if (q.decision !== undefined && !validDecision(q.type, q.decision, options))
      error('decision must match the question type and options')
  })
export type QuestionMetadata = z.infer<typeof QuestionMetadataSchema>
function validSelection(type: string, value: unknown, options: string[]): boolean {
  if (type === 'confirm') return typeof value === 'boolean'
  if (type === 'choice') return typeof value === 'string' && options.includes(value)
  if (type === 'multi')
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      new Set(value).size === value.length &&
      value.every((v) => typeof v === 'string' && options.includes(v))
    )
  return typeof value === 'string' && value.trim().length > 0
}
function validDecision(type: string, value: unknown, options: string[]): boolean {
  if ((type === 'choice' || type === 'multi') && !options.length)
    return typeof value === 'string' && value.trim().length > 0
  return validSelection(type, value, options)
}
export interface DiscussionDiagnostic {
  line: number
  message: string
  question?: string
}
export interface DiscussionQuestion {
  title: string
  line: number
  start: number
  end: number
  fenceStart: number
  fenceEnd: number
  section: string
  snapshot: string
  sectionHash: string
  body: string
  metadata: QuestionMetadata | null
  diagnostics: DiscussionDiagnostic[]
}
export type DiscussionPart =
  | { type: 'prose'; markdown: string; start: number }
  | { type: 'question'; index: number }
export interface ParsedDiscussion {
  status: DiscussionStatus
  title: string
  categories: string[]
  questions: DiscussionQuestion[]
  parts: DiscussionPart[]
  diagnostics: DiscussionDiagnostic[]
}
export function discussionHash(section: string): string {
  return `sha256:${createHash('sha256').update(section).digest('hex')}`
}
interface Node {
  type: string
  depth?: number
  lang?: string | null
  meta?: string | null
  value?: string
  children?: Node[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}
function nodeText(n: Node): string {
  return n.value ?? n.children?.map(nodeText).join('') ?? ''
}

export function parseDiscussion(source: string): ParsedDiscussion {
  const result: ParsedDiscussion = {
    status: 'DRAFT',
    title: '',
    categories: [],
    questions: [],
    parts: [],
    diagnostics: [],
  }
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)
  const offset = front?.[0].length ?? 0
  try {
    if (!front) throw new Error('discussion requires title frontmatter')
    const doc = parseDocument(front[1]!)
    if (doc.errors.length) throw new Error(doc.errors.map((e) => e.message).join('; '))
    const fm = z
      .object({
        title: z.string().trim().min(1),
        status: z.enum(DISCUSSION_STATUSES),
        categories: z.array(z.string().min(1)).optional(),
      })
      .parse(doc.toJS())
    result.status = fm.status
    result.title = fm.title
    result.categories = [...new Set(fm.categories ?? [])]
  } catch (e) {
    result.diagnostics.push({ line: 1, message: e instanceof Error ? e.message : String(e) })
  }
  const body = source.slice(offset)
  const nodes = (unified().use(remarkParse).parse(body) as unknown as Node).children ?? []
  let cursor = offset
  for (let i = 0; i < nodes.length; i++) {
    const heading = nodes[i]!,
      fence = nodes[i + 1]
    if (
      heading.type !== 'heading' ||
      fence?.type !== 'code' ||
      fence.lang !== 'question' ||
      fence.meta
    )
      continue
    // A question is a top-level document section, never a fenced example.
    const start = offset + heading.position!.start.offset!
    let next = i + 2
    while (
      next < nodes.length &&
      !(nodes[next]!.type === 'heading' && nodes[next]!.depth! <= heading.depth!)
    )
      next++
    const end = next < nodes.length ? offset + nodes[next]!.position!.start.offset! : source.length
    const fenceStart = offset + fence.position!.start.offset!,
      fenceEnd = offset + fence.position!.end.offset!
    const line = source.slice(0, fenceStart).split('\n').length
    const diagnostics: DiscussionDiagnostic[] = []
    let metadata: QuestionMetadata | null = null
    try {
      const yaml = parseDocument(fence.value ?? '')
      if (yaml.errors.length) throw new Error(yaml.errors.map((e) => e.message).join('; '))
      // remark accepts unclosed fences; the on-disk grammar does not.
      const fenceSource = source.slice(fenceStart, fenceEnd)
      const marker = /^(?: {0,3})(`{3,}|~{3,})/.exec(fenceSource)?.[1]
      if (
        !marker ||
        !new RegExp(`\\n {0,3}${marker[0]}{${marker.length},}[ \\t]*$`).test(fenceSource)
      )
        throw new Error('question fence is not closed')
      metadata = QuestionMetadataSchema.parse(yaml.toJS())
    } catch (e) {
      diagnostics.push({ line, message: e instanceof Error ? e.message : String(e) })
    }
    const section = source.slice(start, end)
    if (start > cursor)
      result.parts.push({ type: 'prose', markdown: source.slice(cursor, start), start: cursor })
    result.parts.push({ type: 'question', index: result.questions.length })
    const title = nodeText(heading),
      description = source.slice(fenceEnd, end).replace(/^\r?\n/, '')
    const snapshot = discussionHash(
      JSON.stringify({
        title,
        type: metadata?.type,
        options: metadata?.options,
        prefer: metadata?.prefer,
        body: description.trimEnd(),
      }),
    )
    result.questions.push({
      title,
      line,
      start,
      end,
      fenceStart,
      fenceEnd,
      section,
      sectionHash: discussionHash(section),
      snapshot,
      body: description,
      metadata,
      diagnostics,
    })
    cursor = end
    i = next - 1
  }
  if (cursor < source.length)
    result.parts.push({ type: 'prose', markdown: source.slice(cursor), start: cursor })
  const ids = new Map<string, DiscussionQuestion[]>()
  for (const q of result.questions)
    if (q.metadata) ids.set(q.metadata.id, [...(ids.get(q.metadata.id) ?? []), q])
  for (const [id, questions] of ids)
    if (questions.length > 1)
      for (const q of questions) {
        q.diagnostics.push({ line: q.line, question: id, message: `duplicate question ID ${id}` })
        q.metadata = null
      }
  result.diagnostics.push(...result.questions.flatMap((q) => q.diagnostics))
  return result
}

const at = z
  .string()
  .datetime({ offset: true })
  .regex(/[+-]\d{2}:\d{2}$/)
const eventId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/)
const questionId = z.string().regex(QUESTION_ID)
export const DiscussionResponseSchema = z
  .object({
    type: z.literal('response'),
    id: eventId,
    question: questionId,
    at,
    by: z.literal('owner'),
    snapshot: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    section_hash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    choice: z.string().optional(),
    choices: z.array(z.string()).optional(),
    confirm: z.boolean().optional(),
    text: z.string().optional(),
    comment: z.string().optional(),
    section: z.string().optional(),
    section_truncated: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const answers = [v.choice, v.choices, v.confirm, v.text].filter((x) => x !== undefined)
    if (answers.length > 1 || (answers.length === 0 && !v.comment?.trim()))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'provide one typed answer or a nonempty comment',
      })
  })
export const DiscussionEventSchema = z.union([
  DiscussionResponseSchema,
  z
    .object({
      type: z.literal('ack'),
      id: eventId.optional(),
      response: eventId,
      at,
      by: z.literal('agent'),
      note: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('reply'),
      id: eventId,
      question: questionId,
      at,
      by: z.literal('agent'),
      text: z.string().trim().min(1),
    })
    .strict(),
])
export type DiscussionEvent = z.infer<typeof DiscussionEventSchema>
export type DiscussionResponse = z.infer<typeof DiscussionResponseSchema>
export function parseDiscussionEvents(source: string): {
  events: DiscussionEvent[]
  diagnostics: DiscussionDiagnostic[]
} {
  const events: DiscussionEvent[] = [],
    diagnostics: DiscussionDiagnostic[] = [],
    ids = new Set<string>(),
    responses = new Set<string>()
  const lines = source.split('\n')
  lines.forEach((line, i) => {
    if (!line && i === lines.length - 1) return
    try {
      if (i === lines.length - 1) throw new Error('response log has an incomplete final line')
      const event = DiscussionEventSchema.parse(JSON.parse(line))
      if (event.id && ids.has(event.id)) throw new Error(`duplicate event ID ${event.id}`)
      if (event.type === 'ack' && !responses.has(event.response))
        throw new Error(`ack references unknown response ${event.response}`)
      if (event.id) ids.add(event.id)
      if (event.type === 'response') responses.add(event.id)
      events.push(event)
    } catch (e) {
      diagnostics.push({ line: i + 1, message: e instanceof Error ? e.message : String(e) })
    }
  })
  return { events, diagnostics }
}
export function pendingDiscussionResponses(events: DiscussionEvent[]): DiscussionResponse[] {
  const acked = new Set(events.flatMap((e) => (e.type === 'ack' ? [e.response] : [])))
  return events.filter((e): e is DiscussionResponse => e.type === 'response' && !acked.has(e.id))
}
export function questionHistory(
  q: { metadata: Pick<QuestionMetadata, 'id'> | null },
  events: DiscussionEvent[],
): DiscussionEvent[] {
  const ids = new Set(
    events.flatMap((e) => (e.type === 'response' && e.question === q.metadata?.id ? [e.id] : [])),
  )
  return events.filter((e) =>
    e.type === 'ack' ? ids.has(e.response) : e.question === q.metadata?.id,
  )
}
export function questionDisplayStatus(
  q: { metadata: Pick<QuestionMetadata, 'id' | 'status'> | null; snapshot: string },
  events: DiscussionEvent[],
): QuestionDisplayStatus | 'INVALID' {
  if (!q.metadata) return 'INVALID'
  const history = questionHistory(q, events)
  const latest = history.filter((e): e is DiscussionResponse => e.type === 'response').at(-1)
  if (latest && latest.snapshot !== q.snapshot) return 'REVISED'
  if (pendingDiscussionResponses(history).length) return 'ANSWERED'
  return q.metadata.status
}
export function validateDiscussionAnswer(
  q: QuestionMetadata,
  input: unknown,
): Pick<DiscussionResponse, 'choice' | 'choices' | 'confirm' | 'text' | 'comment'> {
  const answer = z
    .object({
      choice: z.string().optional(),
      choices: z.array(z.string()).optional(),
      confirm: z.boolean().optional(),
      text: z.string().trim().min(1).optional(),
      comment: z.string().trim().min(1).optional(),
    })
    .strict()
    .parse(input)
  const keys = ['choice', 'choices', 'confirm', 'text'] as const
  const present = keys.filter((k) => answer[k] !== undefined)
  const expected = { choice: 'choice', multi: 'choices', confirm: 'confirm', text: 'text' } as const
  if (
    present.length > 1 ||
    (present.length === 0 && !answer.comment) ||
    (present.length === 1 &&
      (present[0] !== expected[q.type] ||
        !validSelection(q.type, answer[present[0]!], q.options?.map((o) => o.id) ?? [])))
  )
    throw new Error('answer must match the question type and declared options')
  return answer
}
/** Fit a valid response including an honest UTF-8-safe fallback into the append budget. */
export function responseWithSection(
  response: DiscussionResponse,
  section: string,
): DiscussionResponse {
  const base = { ...response, section: '', section_truncated: false }
  if (Buffer.byteLength(`${JSON.stringify(base)}\n`) > 4096)
    throw new Error('response exceeds the 4096-byte append limit')
  let kept = ''
  for (const char of section) {
    if (Buffer.byteLength(`${JSON.stringify({ ...base, section: kept + char })}\n`) > 4096) break
    kept += char
  }
  return { ...response, section: kept, section_truncated: kept !== section }
}

export const DiscussionSummarySchema = z.object({
  id: z.string().regex(DISCUSSION_ID),
  slug: z.string().min(1),
  resource: z.string().regex(/^docs\/discussions\/D\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\/README\.md$/),
  title: z.string(),
  status: z.enum(DISCUSSION_STATUSES),
  mtime: z.number().finite(),
  categories: z.array(z.string()),
  questions: z.array(
    z.object({
      id: z.string().nullable(),
      title: z.string(),
      category: z.string(),
      status: z.enum(QUESTION_STATUSES).nullable(),
      snapshot: z.string(),
      line: z.number().int().positive(),
      decision: decisionSchema.optional(),
      rationale: z.string().optional(),
    }),
  ),
  diagnostics: z.array(
    z.object({ line: z.number(), message: z.string(), question: z.string().optional() }),
  ),
})
export type DiscussionSummary = z.infer<typeof DiscussionSummarySchema>
export function summarizeDiscussion(
  id: string,
  slug: string,
  resource: string,
  parsed: ParsedDiscussion,
  mtime: number,
): DiscussionSummary {
  return DiscussionSummarySchema.parse({
    id,
    slug,
    resource,
    title: parsed.title || id,
    status: parsed.status,
    mtime,
    categories: parsed.categories,
    diagnostics: parsed.diagnostics,
    questions: parsed.questions.map((q) => ({
      id: q.metadata?.id ?? null,
      title: q.title,
      category: q.metadata?.category ?? '',
      status: q.metadata?.status ?? null,
      snapshot: q.snapshot,
      line: q.line,
      ...(q.metadata?.decision === undefined ? {} : { decision: q.metadata.decision }),
      ...(q.metadata?.rationale === undefined ? {} : { rationale: q.metadata.rationale }),
    })),
  })
}

export const DiscussionResponseInputSchema = z
  .object({
    question: z.string().regex(QUESTION_ID),
    snapshot: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    answer: z.unknown().refine((v) => v !== undefined),
    responseId: eventId.optional(),
  })
  .strict()
export const DiscussionStatusInputSchema = z
  .object({
    status: z.enum(['OPEN', 'CLOSED']),
    expectedMtime: z.number().finite(),
    expectedHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict()
