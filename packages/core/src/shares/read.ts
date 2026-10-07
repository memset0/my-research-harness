import { projectFs as fs } from '../project-file-store.js'
import { resolveSharesFilePath } from './paths.js'
import { emptySharesFile, type ShareRecord, ShareStoreError, type SharesFile } from './types.js'

/**
 * Read `<projectRoot>/.memon/shares.json`. If the file does not exist,
 * returns an empty `SharesFile`. Throws `ShareStoreError` on malformed JSON
 * or schema violations.
 */
export async function readShares(projectRoot: string): Promise<SharesFile> {
  const { sharesAbs } = resolveSharesFilePath(projectRoot)
  let text: string
  try {
    text = await fs.readFile(sharesAbs, 'utf8')
  } catch (err) {
    const errno = err as NodeJS.ErrnoException
    if (errno.code === 'ENOENT') return emptySharesFile()
    throw new ShareStoreError(`cannot read ${sharesAbs}: ${errno.message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new ShareStoreError(`invalid JSON at ${sharesAbs}: ${(err as Error).message}`)
  }

  return validateSharesFile(parsed, sharesAbs)
}

function validateSharesFile(value: unknown, path: string): SharesFile {
  if (!value || typeof value !== 'object') {
    throw new ShareStoreError(`${path}: root is not an object`)
  }
  const v = value as Record<string, unknown>
  if (v.version !== 1) {
    throw new ShareStoreError(`${path}: version must be 1, got ${String(v.version)}`)
  }
  if (!Array.isArray(v.shares)) {
    throw new ShareStoreError(`${path}: shares must be an array`)
  }
  const shares: ShareRecord[] = []
  for (let i = 0; i < v.shares.length; i += 1) {
    shares.push(validateShareRecord(v.shares[i], `${path}.shares[${i}]`))
  }
  return { version: 1, shares }
}

function validateShareRecord(value: unknown, ctx: string): ShareRecord {
  if (!value || typeof value !== 'object') {
    throw new ShareStoreError(`${ctx}: not an object`)
  }
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || v.id.length === 0) {
    throw new ShareStoreError(`${ctx}.id: must be non-empty string`)
  }
  if (typeof v.token !== 'string' || v.token.length === 0) {
    throw new ShareStoreError(`${ctx}.token: must be non-empty string`)
  }
  if (typeof v.created_at !== 'string' || v.created_at.length === 0) {
    throw new ShareStoreError(`${ctx}.created_at: must be non-empty string`)
  }
  if (v.expires_at !== null && typeof v.expires_at !== 'string') {
    throw new ShareStoreError(`${ctx}.expires_at: must be string or null`)
  }
  if (v.label !== undefined && typeof v.label !== 'string') {
    throw new ShareStoreError(`${ctx}.label: must be string when present`)
  }
  const out: ShareRecord = {
    id: v.id,
    token: v.token,
    created_at: v.created_at,
    expires_at: v.expires_at as string | null,
  }
  if (typeof v.label === 'string') out.label = v.label
  return out
}
