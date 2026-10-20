import { z } from 'zod'
import { type ParseIssue, STATUS_VALUES } from '../types.js'

export const RUN_METADATA_FILE = 'run.json'

/** A timestamp must name a real local calendar time and its numeric offset. */
export function isOffsetTimestamp(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?([+-])(\d{2}):(\d{2})$/.exec(
      value,
    )
  if (!match) return false
  const [, y, mo, d, h, mi, s, , oh, om] = match
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const days = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1]! &&
    Number(h) < 24 &&
    Number(mi) < 60 &&
    Number(s) < 60 &&
    Number(oh) <= 14 &&
    Number(om) < 60 &&
    (Number(oh) < 14 || Number(om) === 0)
  )
}

const timestamp = z
  .string()
  .refine(isOffsetTimestamp, 'must be a valid ISO8601 date-time with numeric timezone offset')
export const RunMetadataSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .refine(
        (value) => !/[\\/\0]/.test(value) && value !== '.' && value !== '..',
        'must be a directory basename',
      ),
    status: z.enum(
      STATUS_VALUES as [(typeof STATUS_VALUES)[number], ...(typeof STATUS_VALUES)[number][]],
    ),
    active: z.boolean().optional(),
    params: z.record(z.unknown()).optional(),
    description: z.string().optional(),
    assessment: z
      .object({
        kind: z.enum(['INVALID', 'LIMITED', 'SUPERSEDED', 'OTHER']),
        reason: z.string().min(1),
      })
      .optional(),
    legacy_sections: z.array(z.object({ title: z.string(), body: z.string() })).optional(),
    created_at: timestamp,
    updated_at: timestamp.optional(),
    started_at: timestamp.nullable().optional(),
    finished_at: timestamp.nullable().optional(),
    name: z.string().optional(),
    host: z.string().nullable().optional(),
    pid: z.number().int().nonnegative().nullable().optional(),
    gpus: z.array(z.number().int().nonnegative()).optional(),
    entry: z.string().optional(),
    command: z.string().optional(),
    wandb: z
      .string()
      .url()
      .refine((value) => /^https?:\/\//i.test(value), 'must be an HTTP(S) URL')
      .nullable()
      .optional(),
    scheduler: z
      .object({ system: z.string().optional(), job_id: z.string().min(1) })
      .passthrough()
      .nullable()
      .optional(),
    archived: z.boolean().optional(),
    deprecated: z.boolean().optional(),
  })
  .passthrough()

export type RunMetadata = z.infer<typeof RunMetadataSchema>

export function parseRunMetadata(content: string): {
  data: RunMetadata | null
  issues: ParseIssue[]
} {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return { data: null, issues: [{ message: 'Invalid run.json JSON', severity: 'error' }] }
  }
  const parsed = RunMetadataSchema.safeParse(value)
  if (parsed.success) return { data: parsed.data, issues: [] }
  return {
    data: null,
    issues: parsed.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
      severity: 'error',
    })),
  }
}

export function serializeRunMetadata(data: RunMetadata): string {
  const parsed = RunMetadataSchema.safeParse(data)
  if (!parsed.success)
    throw new Error(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    )
  return `${JSON.stringify(parsed.data, null, 2)}\n`
}

export function lightweightRunIdentity(
  path: string,
): { experimentId: string; variantId: string; runId: string } | null {
  const match = /^logs\/(E\d{4})\/(V\d{4}|smoke)\/([^/\\]+)$/.exec(path)
  if (!match || match[3]!.startsWith('.') || path.includes('\0')) return null
  return { experimentId: match[1]!, variantId: match[2]!, runId: match[3]! }
}
