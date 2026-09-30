import { randomBytes, timingSafeEqual } from 'node:crypto'
import { formatIsoLocal } from '../time.js'
import { readShares } from './read.js'
import {
  AmbiguousShareError,
  ShareNotFoundError,
  type ShareRecord,
  ShareStoreError,
} from './types.js'
import { writeShares } from './write.js'

const TOKEN_BYTES = 18 // 24 base64url chars, 144 bits
const ID_BYTES = 6 // 8 base64url chars
const ID_PREFIX = 'shr_'
const ID_COLLISION_MAX_RETRY = 5

export interface AddShareOptions {
  /** Optional human label (≤ 64 chars). */
  label?: string
  /**
   * Expiration. One of:
   *   - `"never"` (default if omitted) → expires_at = null
   *   - `<int>d` → N days from now
   *   - `<int>h` → N hours from now
   */
  expires?: string
}

export interface RevokeShareOptions {
  /** When true, removes ALL matching records instead of erroring on ambiguity. */
  force?: boolean
}

function randomToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

function randomId(): string {
  return ID_PREFIX + randomBytes(ID_BYTES).toString('base64url')
}

export interface ParsedDuration {
  ms: number | null
}

/**
 * Parse a duration string. Returns `{ ms: number }` for `<int>d` / `<int>h`,
 * `{ ms: null }` for `"never"` (or undefined). Throws on invalid.
 */
export function parseDuration(input: string | undefined): ParsedDuration {
  if (input === undefined || input === 'never') return { ms: null }
  const m = /^(\d+)([dh])$/.exec(input.trim())
  if (!m) {
    throw new Error(`invalid --expires value: expected <int>d, <int>h, or "never"`)
  }
  const n = Number.parseInt(m[1]!, 10)
  const unit = m[2]!
  const factorMs = unit === 'd' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000
  return { ms: n * factorMs }
}

function isExpired(record: ShareRecord, nowMs: number): boolean {
  if (record.expires_at === null) return false
  const expMs = Date.parse(record.expires_at)
  if (Number.isNaN(expMs)) return false
  return expMs <= nowMs
}

/**
 * Allocate a fresh share record and append to `<projectRoot>/.memon/shares.json`.
 * Returns the new record. Retries id generation up to 5 times on collision
 * (vanishingly unlikely for 48-bit random ids; this is defense-in-depth).
 */
export async function addShare(
  projectRoot: string,
  options: AddShareOptions = {},
): Promise<ShareRecord> {
  if (options.label !== undefined && options.label.length > 64) {
    throw new ShareStoreError(`label exceeds 64 chars`)
  }
  const duration = parseDuration(options.expires)
  const now = new Date()
  const createdAt = formatIsoLocal(now)
  const expiresAt =
    duration.ms === null ? null : formatIsoLocal(new Date(now.getTime() + duration.ms))

  const file = await readShares(projectRoot)
  const existingIds = new Set(file.shares.map((s) => s.id))
  let id: string | null = null
  for (let attempt = 0; attempt < ID_COLLISION_MAX_RETRY; attempt += 1) {
    const candidate = randomId()
    if (!existingIds.has(candidate)) {
      id = candidate
      break
    }
  }
  if (id === null) {
    throw new ShareStoreError(`unable to allocate a fresh share id after retries`)
  }

  const record: ShareRecord = {
    id,
    token: randomToken(),
    created_at: createdAt,
    expires_at: expiresAt,
  }
  if (options.label !== undefined) record.label = options.label

  file.shares.push(record)
  await writeShares(projectRoot, file)
  return record
}

/**
 * Remove a record matching `idOrLabel` (id-prefix OR exact label match).
 * Throws `AmbiguousShareError` if multiple match and `opts.force` is false.
 * Throws `ShareNotFoundError` if no match.
 * Returns the removed record(s) — single by default, all matching with `force`.
 */
export async function revokeShare(
  projectRoot: string,
  idOrLabel: string,
  opts: RevokeShareOptions = {},
): Promise<ShareRecord[]> {
  if (!idOrLabel) {
    throw new ShareStoreError(`revokeShare: idOrLabel is required`)
  }
  const file = await readShares(projectRoot)
  const matches = file.shares.filter((s) => s.id.startsWith(idOrLabel) || s.label === idOrLabel)
  if (matches.length === 0) {
    throw new ShareNotFoundError(`share not found: ${idOrLabel}`)
  }
  if (matches.length > 1 && !opts.force) {
    throw new AmbiguousShareError(
      `multiple shares match "${idOrLabel}": ${matches.map((m) => m.id).join(', ')}`,
      matches.map((m) => ({ id: m.id })),
    )
  }
  const toRemoveIds = new Set(matches.map((m) => m.id))
  file.shares = file.shares.filter((s) => !toRemoveIds.has(s.id))
  await writeShares(projectRoot, file)
  return matches
}

/**
 * Look up a share by its `token` (constant-time compare). Returns the record
 * if it exists AND is not expired. Returns null otherwise.
 *
 * The token comparison uses `crypto.timingSafeEqual` to avoid leaking
 * information about token prefix matches via timing.
 */
export async function validateShare(
  projectRoot: string,
  token: string,
  nowMs: number = Date.now(),
): Promise<ShareRecord | null> {
  if (!token) return null
  const file = await readShares(projectRoot)
  if (file.shares.length === 0) return null

  // Constant-time scan across all records. We always iterate the whole array
  // and use timingSafeEqual on equal-length buffers; this prevents an
  // attacker from inferring "the matching token is near the beginning of the
  // list" via response-time differences.
  const tokenBuf = Buffer.from(token, 'utf8')
  let match: ShareRecord | null = null
  for (const record of file.shares) {
    const candidate = Buffer.from(record.token, 'utf8')
    let equal = false
    if (candidate.length === tokenBuf.length) {
      equal = timingSafeEqual(candidate, tokenBuf)
    } else {
      // Dummy compare to keep timing roughly constant.
      timingSafeEqual(candidate, Buffer.alloc(candidate.length))
    }
    if (equal && match === null) {
      if (!isExpired(record, nowMs)) {
        match = record
        // Don't break: keep iterating so we burn the same time per record.
      }
    }
  }
  return match
}

/**
 * Convenience: list all shares for a project (with their `token` redacted
 * by default unless `includeTokens === true`).
 */
export async function listShares(
  projectRoot: string,
  options: { includeTokens?: boolean } = {},
): Promise<ShareRecord[]> {
  const file = await readShares(projectRoot)
  if (options.includeTokens) return file.shares
  return file.shares.map((s) => {
    const out: ShareRecord = {
      id: s.id,
      token: '', // redacted
      created_at: s.created_at,
      expires_at: s.expires_at,
    }
    if (s.label !== undefined) out.label = s.label
    return out
  })
}

/** Test-only export. */
export const __testIsExpired = isExpired
