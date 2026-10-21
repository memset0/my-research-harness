// Central share registry: every share token this dashboard issues, with its
// Host-qualified Project, scope (the whole Project or one Experiment, Wiki
// page or Report) and the page its link lands on.
//
// The file lives beside the instance config (`shares.json`, mode 0600) and is
// never written into a Project, so read-only and File Agent Projects can be
// shared. It is re-read on every validation (no positive caching), so a
// revocation takes effect on the next request; an unreadable file fails
// closed. Writes go through a temp file + rename under an in-process queue.

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { formatIsoLocal, parseDuration } from '@memon/core'
import { z } from 'zod'

export const SHARE_REGISTRY_FILENAME = 'shares.json'
export const SHARE_DOCUMENT_KINDS = ['experiment', 'wiki', 'report'] as const
export type ShareDocumentKind = (typeof SHARE_DOCUMENT_KINDS)[number]

const DOCUMENT_ID: Record<ShareDocumentKind, RegExp> = {
  experiment: /^E\d{4}-[a-z0-9][a-z0-9-]*$/,
  wiki: /^W\d{4}$/,
  report: /^R\d{4}$/,
}
const DOCUMENT_ROUTE: Record<ShareDocumentKind, string> = {
  experiment: 'e',
  wiki: 'wiki',
  report: 'reports',
}

export const ShareScopeSchema = z.union([
  z.object({ kind: z.literal('project') }).strict(),
  z
    .object({ kind: z.enum(SHARE_DOCUMENT_KINDS), id: z.string() })
    .strict()
    .refine((scope) => DOCUMENT_ID[scope.kind].test(scope.id), {
      message: 'document id does not match its kind',
    }),
])
export type ShareScope = z.infer<typeof ShareScopeSchema>
export type ShareDocumentScope = Extract<ShareScope, { id: string }>

const ShareRegistryRecordSchema = z
  .object({
    id: z.string().regex(/^shr_[A-Za-z0-9_-]{8}$/),
    token: z.string().regex(/^[A-Za-z0-9_-]{24}$/),
    label: z.string().max(64).optional(),
    host: z.string().min(1).nullable(),
    project: z.string().min(1),
    scope: ShareScopeSchema,
    path: z.string().regex(/^\/(?![/\\])/),
    created_at: z.string(),
    expires_at: z.string().nullable(),
    /** A public Report/Wiki page: readable by anyone, its token grants nothing. */
    public: z.literal(true).optional(),
  })
  .strict()
export type ShareRegistryRecord = z.infer<typeof ShareRegistryRecordSchema>

const ShareRegistryFileSchema = z
  .object({ version: z.literal(1), shares: z.array(ShareRegistryRecordSchema) })
  .strict()

export class ShareRegistryInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShareRegistryInputError'
  }
}

export function shareRegistryPath(configPath: string): string {
  return join(dirname(configPath), SHARE_REGISTRY_FILENAME)
}

export function isDocumentScope(scope: ShareScope): scope is ShareDocumentScope {
  return scope.kind !== 'project'
}

/** The Project's route prefix: `/h/<host>/p/<project>` in central mode, else `/p/<project>`. */
export function projectRoutePrefix(host: string | null, project: string): string {
  const base = `/p/${encodeURIComponent(project)}`
  return host === null ? base : `/h/${encodeURIComponent(host)}${base}`
}

/**
 * The page a link lands on. Document scope: the document's own page. Project
 * scope: the client's current page only when it lies inside the Project's
 * route and carries no dot-segment or scheme tricks, else the Project root.
 */
export function shareLandingPath(
  host: string | null,
  project: string,
  scope: ShareScope,
  currentPath?: string | null,
): string {
  const base = projectRoutePrefix(host, project)
  if (isDocumentScope(scope))
    return `${base}/${DOCUMENT_ROUTE[scope.kind]}/${encodeURIComponent(scope.id)}`
  if (!currentPath || currentPath.length > 2048) return base
  const path = currentPath.split('#')[0]!
  if (path !== base && !path.startsWith(`${base}/`) && !path.startsWith(`${base}?`)) return base
  const pathname = path.split('?')[0]!
  if (/[\\\0]/.test(path) || pathname.includes('//')) return base
  try {
    if (
      decodeURIComponent(pathname)
        .split('/')
        .some((part) => part === '.' || part === '..')
    )
      return base
  } catch {
    return base
  }
  return path
}

function tokenMatches(candidate: string, token: string): boolean {
  const a = Buffer.from(candidate)
  const b = Buffer.from(token)
  if (a.length !== b.length) {
    timingSafeEqual(a, Buffer.alloc(a.length))
    return false
  }
  return timingSafeEqual(a, b)
}

function isExpired(record: ShareRegistryRecord, nowMs: number): boolean {
  if (record.expires_at === null) return false
  const expires = Date.parse(record.expires_at)
  return !Number.isNaN(expires) && expires <= nowMs
}

/**
 * The scope `token` grants for exactly `{host, project}` among `records`, or
 * null. Every record is compared in constant time and expiry is honoured.
 */
export function matchShare(
  records: readonly ShareRegistryRecord[],
  host: string | null,
  project: string,
  token: string,
  nowMs = Date.now(),
): ShareScope | null {
  let match: ShareRegistryRecord | null = null
  for (const record of records) {
    if (tokenMatches(record.token, token) && !isExpired(record, nowMs) && !record.public)
      match = record
  }
  return match && match.host === host && match.project === project ? match.scope : null
}

/** The Report and Wiki pages of `{host, project}` that are public. */
export function publicDocuments(
  records: readonly ShareRegistryRecord[],
  host: string | null,
  project: string,
  nowMs = Date.now(),
): ShareDocumentScope[] {
  return records.flatMap((record) =>
    record.public &&
    record.host === host &&
    record.project === project &&
    isDocumentScope(record.scope) &&
    !isExpired(record, nowMs)
      ? [record.scope]
      : [],
  )
}

const queues = new Map<string, Promise<unknown>>()

export interface CreateShareInput {
  host: string | null
  project: string
  scope: ShareScope
  label?: string
  expires?: string
  currentPath?: string | null
  /** Make a Report or Wiki page public instead of issuing a token link. */
  public?: boolean
}

export class ShareRegistry {
  constructor(readonly path: string) {}

  /** Missing file → no shares; anything unreadable or invalid throws (fail closed). */
  async read(): Promise<ShareRegistryRecord[]> {
    let text: string
    try {
      text = await fs.readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    return ShareRegistryFileSchema.parse(JSON.parse(text)).shares
  }

  async list(filter: { host?: string | null; project?: string } = {}) {
    return (await this.read()).filter(
      (record) =>
        (filter.host === undefined || record.host === filter.host) &&
        (filter.project === undefined || record.project === filter.project),
    )
  }

  async create(input: CreateShareInput, now = new Date()): Promise<ShareRegistryRecord> {
    const label = input.label?.trim() || undefined
    if (label !== undefined && label.length > 64)
      throw new ShareRegistryInputError('label must be at most 64 characters')
    const scope = ShareScopeSchema.safeParse(input.scope)
    if (!scope.success) throw new ShareRegistryInputError('invalid share scope')
    if (input.public) {
      if (scope.data.kind !== 'report' && scope.data.kind !== 'wiki')
        throw new ShareRegistryInputError('only Report and Wiki pages can be public')
      const existing = (await this.read()).find(
        (record) =>
          record.public &&
          record.host === input.host &&
          record.project === input.project &&
          JSON.stringify(record.scope) === JSON.stringify(scope.data),
      )
      if (existing) return existing
    }
    let durationMs: number | null
    try {
      durationMs = parseDuration(input.expires).ms
    } catch (error) {
      throw new ShareRegistryInputError((error as Error).message)
    }
    const record: ShareRegistryRecord = {
      id: `shr_${randomBytes(6).toString('base64url')}`,
      token: randomBytes(18).toString('base64url'),
      ...(label === undefined ? {} : { label }),
      host: input.host,
      project: input.project,
      scope: scope.data,
      path: shareLandingPath(input.host, input.project, scope.data, input.currentPath),
      created_at: formatIsoLocal(now),
      expires_at: durationMs === null ? null : formatIsoLocal(new Date(now.getTime() + durationMs)),
      ...(input.public ? { public: true as const } : {}),
    }
    await this.update((records) => [...records, record])
    return record
  }

  /** Delete one record; false when no record has this id. */
  async remove(id: string): Promise<boolean> {
    let removed = false
    await this.update((records) =>
      records.filter((record) => {
        if (record.id !== id) return true
        removed = true
        return false
      }),
    )
    return removed
  }

  /** The unexpired record holding this token, compared in constant time. */
  async find(token: string, nowMs = Date.now()): Promise<ShareRegistryRecord | null> {
    let found: ShareRegistryRecord | null = null
    for (const record of await this.read()) {
      if (tokenMatches(record.token, token) && !isExpired(record, nowMs) && !record.public)
        found = record
    }
    return found
  }

  /** The scope this token grants for exactly `{host, project}`, or null. */
  async validate(host: string | null, project: string, token: string): Promise<ShareScope | null> {
    return matchShare(await this.read(), host, project, token)
  }

  private async update(
    change: (records: ShareRegistryRecord[]) => ShareRegistryRecord[],
  ): Promise<void> {
    const previous = queues.get(this.path) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const records = change(await this.read())
        const body = `${JSON.stringify({ version: 1, shares: records }, null, 2)}\n`
        const temporary = `${this.path}.tmp-${randomBytes(6).toString('hex')}`
        try {
          await fs.writeFile(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
          await fs.rename(temporary, this.path)
        } catch (error) {
          await fs.rm(temporary, { force: true }).catch(() => undefined)
          throw error
        }
      })
    queues.set(this.path, next)
    await next
  }
}

export function shareRegistryFor(configPath: string): ShareRegistry {
  return new ShareRegistry(shareRegistryPath(configPath))
}
