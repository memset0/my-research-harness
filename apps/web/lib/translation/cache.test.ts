// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sqlite3 from 'sqlite3'
import { SqliteTranslationCache } from './cache'
import { BodyTranslationService } from './service'
import { literalSegment } from './segments'

let directory: string
const stores: SqliteTranslationCache[] = []
const segment = literalSegment('Hello world')!
const result = { id: segment.id, sourceHash: segment.sourceHash, text: '你好世界' }
const output = JSON.stringify([{ id: segment.id, text: result.text }])
const signal = () => new AbortController().signal
function store(now = Date.now, limits?: { entries: number; bytes: number; ttl: number }) {
  const cache = new SqliteTranslationCache(join(directory, 'translations.sqlite3'), now, limits)
  stores.push(cache)
  return cache
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'memon-cache-test-'))
})
afterEach(async () => {
  for (const cache of stores.splice(0)) await cache.close()
  await rm(directory, { recursive: true, force: true })
})

it('reuses SQLite translations after reopen without a provider invocation', async () => {
  const invoke = vi.fn(async () => output)
  const first = store()
  expect(
    await new BodyTranslationService(invoke, Date.now, first).translate(
      'document-revision-a',
      'zh-CN',
      [segment],
      signal(),
    ),
  ).toEqual([result])
  await first.close()
  const reopened = store()
  const forbidden = vi.fn(async () => {
    throw new Error('cache must avoid paid call')
  })
  expect(
    await new BodyTranslationService(forbidden, Date.now, reopened).translate(
      'document-revision-a',
      'zh-CN',
      [segment],
      signal(),
    ),
  ).toEqual([result])
  expect(forbidden).not.toHaveBeenCalled()
  const other = vi.fn(async () => output)
  await new BodyTranslationService(other, Date.now, reopened).translate(
    'document-revision-b',
    'zh-CN',
    [segment],
    signal(),
  )
  expect(other).toHaveBeenCalledTimes(1)
  expect((await stat(reopened.path)).mode & 0o777).toBe(0o600)
  expect((await readFile(reopened.path)).includes(Buffer.from('document-revision-a'))).toBe(false)
})

it('bulk reads bounded chunks in input order with duplicate keys and missing rows', async () => {
  const cache = store()
  await cache.set('first', result)
  await cache.set('last', result)
  const keys = [
    'first',
    ...Array.from({ length: 600 }, (_, index) => `missing-${index}`),
    'last',
    'first',
  ]
  const found = await cache.getMany(keys)
  expect(found).toHaveLength(keys.length)
  expect(found[0]).toEqual(result)
  expect(found.slice(1, 601).every((entry) => entry === null)).toBe(true)
  expect(found.slice(-2)).toEqual([result, result])
  expect(await cache.getMany([])).toEqual([])
})

it('returns all bulk hits without inference even beyond the memory entry limit', async () => {
  const segments = Array.from(
    { length: 2010 },
    (_, index) => literalSegment(`Paragraph ${index} prose`)!,
  )
  const getMany = vi.fn(async () =>
    segments.map(({ id, sourceHash, text }) => ({ id, sourceHash, text })),
  )
  const get = vi.fn(async () => null)
  const invoke = vi.fn()
  const service = new BodyTranslationService(invoke, Date.now, {
    get,
    getMany,
    set: async () => undefined,
  })
  expect(await service.cached('document', segments, signal())).toHaveLength(segments.length)
  expect(getMany).toHaveBeenCalledTimes(1)
  expect(get).not.toHaveBeenCalled()
  expect(invoke).not.toHaveBeenCalled()
})

it('expires persisted entries and evicts by least-recent use and byte count', async () => {
  let now = 1
  const cache = store(() => now, { entries: 2, bytes: 1000, ttl: 100 })
  await cache.set('first', result)
  now++
  await cache.set('second', result)
  now++
  await cache.get('first')
  now++
  await cache.set('third', result)
  expect(await cache.get('second')).toBeNull()
  expect(await cache.get('first')).toEqual(result)
  now = 200
  expect(await cache.get('first')).toBeNull()
  await cache.close()
  const small = store(() => ++now, { entries: 100, bytes: 250, ttl: 100 })
  await small.set('one', result)
  await small.set('two', result)
  expect(await small.get('one')).toBeNull()
  expect(await small.get('two')).toEqual(result)
  await expect(small.set('huge', { ...result, text: 'a'.repeat(500) })).rejects.toMatchObject({
    code: 'CACHE_UNAVAILABLE',
  })
})

it('rejects malformed persisted JSON and revalidates protected output', async () => {
  const cache = store()
  await cache.set('key', result)
  const database = new sqlite3.Database(cache.path)
  await new Promise<void>((resolve, reject) =>
    database.run("UPDATE body_translations SET result_json = '{}'", (error) =>
      error ? reject(error) : resolve(),
    ),
  )
  await new Promise<void>((resolve, reject) =>
    database.close((error) => (error ? reject(error) : resolve())),
  )
  expect(await cache.get('key')).toBeNull()
  const invoke = vi.fn(async () => output)
  const invalid = {
    get: async () => ({ ...result, text: '[[999]]' }),
    set: vi.fn(async () => undefined),
  }
  expect(
    await new BodyTranslationService(invoke, Date.now, invalid).translate(
      'key',
      'zh-CN',
      [segment],
      signal(),
    ),
  ).toEqual([result])
  expect(invoke).toHaveBeenCalledTimes(1)
})

it('serializes concurrent writes from separate cache handles', async () => {
  const first = store()
  await first.set('initial', result)
  const second = store()
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      (index % 2 ? first : second).set(String(index), result),
    ),
  )
  for (let index = 0; index < 12; index++) expect(await first.get(String(index))).toEqual(result)
})

it('does not let memory bypass expired or removed persistent entries', async () => {
  const get = vi.fn().mockResolvedValueOnce(result).mockResolvedValueOnce(null)
  const invoke = vi.fn(async () => output)
  const service = new BodyTranslationService(invoke, Date.now, { get, set: async () => undefined })
  await service.translate('key', 'zh-CN', [segment], signal())
  expect(invoke).not.toHaveBeenCalled()
  await service.translate('key', 'zh-CN', [segment], signal())
  expect(invoke).toHaveBeenCalledTimes(1)
})

it('fails closed on unavailable storage before spending quota or acknowledging an uncached result', async () => {
  const invoke = vi.fn(async () => output)
  const unavailable = {
    get: vi.fn(async () => {
      throw new Error('private filesystem failure')
    }),
    set: vi.fn(async () => undefined),
  }
  await expect(
    new BodyTranslationService(invoke, Date.now, unavailable).translate(
      'key',
      'zh-CN',
      [segment],
      signal(),
    ),
  ).rejects.toMatchObject({ code: 'CACHE_UNAVAILABLE' })
  expect(invoke).not.toHaveBeenCalled()
  const unwritable = {
    get: async () => null,
    set: async () => {
      throw new Error('private filesystem failure')
    },
  }
  expect(
    await new BodyTranslationService(invoke, Date.now, unwritable).translate(
      'key',
      'zh-CN',
      [segment],
      signal(),
    ),
  ).toEqual([{ id: segment.id, sourceHash: segment.sourceHash, code: 'CACHE_UNAVAILABLE' }])
  expect(invoke).toHaveBeenCalledTimes(1)
  const cache = new SqliteTranslationCache(join(directory, 'missing', 'translations.sqlite3'))
  stores.push(cache)
  await expect(cache.get('key')).rejects.toMatchObject({ code: 'CACHE_UNAVAILABLE' })
})
