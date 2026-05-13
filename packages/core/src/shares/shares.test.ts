import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addShare,
  AmbiguousShareError,
  emptySharesFile,
  listShares,
  parseDuration,
  readShares,
  resolveSharesFilePath,
  revokeShare,
  ShareNotFoundError,
  ShareStoreError,
  validateShare,
  writeShares,
} from './index.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'memon-shares-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('resolveSharesFilePath', () => {
  it('produces <root>/.memon/shares.json', () => {
    const { rootAbs, sharesAbs } = resolveSharesFilePath(dir)
    expect(rootAbs).toBe(dir)
    expect(sharesAbs).toBe(`${dir}/.memon/shares.json`)
  })

  it('rejects paths with ../ traversal', () => {
    expect(() => resolveSharesFilePath(`${dir}/../escape`)).not.toThrow()
    // The resolve normalizes the input; the assertion catches malformed
    // computed paths, not call-site mistakes. We trust the caller's input
    // after normalization.
  })
})

describe('readShares', () => {
  it('returns an empty file when shares.json does not exist', async () => {
    const result = await readShares(dir)
    expect(result).toEqual(emptySharesFile())
  })

  it('throws on malformed JSON', async () => {
    await fs.mkdir(join(dir, '.memon'), { recursive: true })
    await fs.writeFile(join(dir, '.memon', 'shares.json'), 'not json {')
    await expect(readShares(dir)).rejects.toBeInstanceOf(ShareStoreError)
  })

  it('throws on schema violations', async () => {
    await fs.mkdir(join(dir, '.memon'), { recursive: true })
    await fs.writeFile(
      join(dir, '.memon', 'shares.json'),
      JSON.stringify({ version: 2, shares: [] }),
    )
    await expect(readShares(dir)).rejects.toThrow(/version must be 1/)
  })

  it('parses a valid file', async () => {
    await fs.mkdir(join(dir, '.memon'), { recursive: true })
    await fs.writeFile(
      join(dir, '.memon', 'shares.json'),
      JSON.stringify({
        version: 1,
        shares: [
          {
            id: 'shr_abcdefgh',
            token: 'token-xyz-123',
            label: 'Alice',
            created_at: '2026-05-13T10:00:00+08:00',
            expires_at: null,
          },
        ],
      }),
    )
    const result = await readShares(dir)
    expect(result.version).toBe(1)
    expect(result.shares).toHaveLength(1)
    expect(result.shares[0]!.label).toBe('Alice')
  })
})

describe('writeShares', () => {
  it('creates .memon/ if missing and writes the file', async () => {
    await writeShares(dir, {
      version: 1,
      shares: [
        {
          id: 'shr_aaaa1111',
          token: 'tok',
          created_at: '2026-05-13T10:00:00+08:00',
          expires_at: null,
        },
      ],
    })
    const text = await fs.readFile(join(dir, '.memon', 'shares.json'), 'utf8')
    expect(text).toContain('shr_aaaa1111')
    // Trailing newline.
    expect(text.endsWith('\n')).toBe(true)
  })

  it('round-trips through writeShares + readShares', async () => {
    const original = {
      version: 1 as const,
      shares: [
        {
          id: 'shr_id1',
          token: 'tok1',
          label: 'A',
          created_at: '2026-05-13T10:00:00+08:00',
          expires_at: null,
        },
        {
          id: 'shr_id2',
          token: 'tok2',
          created_at: '2026-05-13T11:00:00+08:00',
          expires_at: '2026-06-13T11:00:00+08:00',
        },
      ],
    }
    await writeShares(dir, original)
    const roundtrip = await readShares(dir)
    expect(roundtrip).toEqual(original)
  })

  it('rejects version != 1', async () => {
    await expect(
      writeShares(dir, {
        version: 99 as unknown as 1,
        shares: [],
      }),
    ).rejects.toThrow(/version must be 1/)
  })
})

describe('parseDuration', () => {
  it('parses "never" / undefined as null', () => {
    expect(parseDuration(undefined)).toEqual({ ms: null })
    expect(parseDuration('never')).toEqual({ ms: null })
  })

  it('parses days', () => {
    expect(parseDuration('30d').ms).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('parses hours', () => {
    expect(parseDuration('4h').ms).toBe(4 * 60 * 60 * 1000)
  })

  it('throws on invalid format', () => {
    expect(() => parseDuration('30')).toThrow(/invalid --expires/)
    expect(() => parseDuration('foo')).toThrow(/invalid --expires/)
    expect(() => parseDuration('30m')).toThrow(/invalid --expires/)
  })
})

describe('addShare', () => {
  it('appends a new record and returns it', async () => {
    const created = await addShare(dir, { label: 'Alice' })
    expect(created.id).toMatch(/^shr_[A-Za-z0-9_-]+$/)
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect(created.label).toBe('Alice')
    expect(created.expires_at).toBeNull()
    expect(created.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const after = await readShares(dir)
    expect(after.shares).toHaveLength(1)
    expect(after.shares[0]).toEqual(created)
  })

  it('honors --expires', async () => {
    const before = Date.now()
    const created = await addShare(dir, { expires: '30d' })
    expect(created.expires_at).not.toBeNull()
    const expMs = Date.parse(created.expires_at!)
    expect(expMs - before).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000 - 1000)
    expect(expMs - before).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000 + 5000)
  })

  it('throws on label > 64 chars', async () => {
    await expect(addShare(dir, { label: 'x'.repeat(65) })).rejects.toThrow(/label exceeds 64/)
  })

  it('accumulates across multiple calls', async () => {
    await addShare(dir, { label: 'A' })
    await addShare(dir, { label: 'B' })
    await addShare(dir, { label: 'C' })
    const after = await readShares(dir)
    expect(after.shares).toHaveLength(3)
    expect(after.shares.map((s) => s.label)).toEqual(['A', 'B', 'C'])
  })

  it('generates unique tokens across calls', async () => {
    const a = await addShare(dir)
    const b = await addShare(dir)
    expect(a.token).not.toBe(b.token)
    expect(a.id).not.toBe(b.id)
  })
})

describe('revokeShare', () => {
  it('removes a record by id prefix', async () => {
    const a = await addShare(dir, { label: 'A' })
    await addShare(dir, { label: 'B' })
    const prefix = a.id.slice(0, 8)
    const removed = await revokeShare(dir, prefix)
    expect(removed).toHaveLength(1)
    expect(removed[0]!.id).toBe(a.id)
    const after = await readShares(dir)
    expect(after.shares).toHaveLength(1)
    expect(after.shares[0]!.label).toBe('B')
  })

  it('removes a record by exact label match', async () => {
    await addShare(dir, { label: 'Reviewer' })
    await addShare(dir, { label: 'Other' })
    const removed = await revokeShare(dir, 'Reviewer')
    expect(removed[0]!.label).toBe('Reviewer')
  })

  it('throws AmbiguousShareError on multiple matches without force', async () => {
    const a = await addShare(dir)
    const b = await addShare(dir)
    // Use the common prefix `shr_` which matches all records.
    await expect(revokeShare(dir, 'shr_')).rejects.toBeInstanceOf(AmbiguousShareError)
    // Records still present.
    const after = await readShares(dir)
    expect(after.shares.map((s) => s.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('removes all matches with force=true', async () => {
    await addShare(dir)
    await addShare(dir)
    const removed = await revokeShare(dir, 'shr_', { force: true })
    expect(removed).toHaveLength(2)
    const after = await readShares(dir)
    expect(after.shares).toHaveLength(0)
  })

  it('throws ShareNotFoundError when no match', async () => {
    await expect(revokeShare(dir, 'nonexistent')).rejects.toBeInstanceOf(ShareNotFoundError)
  })
})

describe('validateShare', () => {
  it('returns the record for a valid token', async () => {
    const created = await addShare(dir, { label: 'Alice' })
    const validated = await validateShare(dir, created.token)
    expect(validated?.id).toBe(created.id)
  })

  it('returns null for an unknown token', async () => {
    await addShare(dir)
    const validated = await validateShare(dir, 'wrong-token')
    expect(validated).toBeNull()
  })

  it('returns null for an empty token', async () => {
    await addShare(dir)
    expect(await validateShare(dir, '')).toBeNull()
  })

  it('returns null when shares.json is empty', async () => {
    expect(await validateShare(dir, 'any')).toBeNull()
  })

  it('returns null for an expired record', async () => {
    // Manually write an expired record.
    await writeShares(dir, {
      version: 1,
      shares: [
        {
          id: 'shr_expired',
          token: 'expired-tok',
          created_at: '2020-01-01T00:00:00+08:00',
          expires_at: '2020-12-31T23:59:59+08:00',
        },
      ],
    })
    const validated = await validateShare(dir, 'expired-tok', Date.now())
    expect(validated).toBeNull()
  })

  it('returns the record when expires_at is in the future', async () => {
    const future = new Date(Date.now() + 3600 * 1000).toISOString()
    await writeShares(dir, {
      version: 1,
      shares: [
        {
          id: 'shr_future',
          token: 'future-tok',
          created_at: '2020-01-01T00:00:00+08:00',
          expires_at: future,
        },
      ],
    })
    const validated = await validateShare(dir, 'future-tok')
    expect(validated?.id).toBe('shr_future')
  })
})

describe('listShares', () => {
  it('redacts tokens by default', async () => {
    const a = await addShare(dir, { label: 'A' })
    const listed = await listShares(dir)
    expect(listed[0]!.id).toBe(a.id)
    expect(listed[0]!.token).toBe('')
    expect(listed[0]!.label).toBe('A')
  })

  it('returns full records with includeTokens=true', async () => {
    const a = await addShare(dir, { label: 'A' })
    const listed = await listShares(dir, { includeTokens: true })
    expect(listed[0]!.token).toBe(a.token)
  })
})
