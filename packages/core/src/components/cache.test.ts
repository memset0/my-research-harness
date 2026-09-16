import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { componentAssetsDir, readComponentCache, writeComponentCache } from './cache.js'

let root = ''
const DOCUMENT = 'docs/wiki/note/W0004-fid.md'
const BASE = { componentType: 'datatable@1', sourceHash: 'a'.repeat(64), durationMs: 12 }

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-component-cache-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('componentAssetsDir', () => {
  it.each([
    ['docs/wiki/note/W0004-x.md', 'docs/wiki/note/W0004-x__assets'],
    ['docs/wiki/note/W0004-x/README.md', 'docs/wiki/note/W0004-x/README__assets'],
    ['README.md', 'README__assets'],
    ['logs/x-260901-010203/README.markdown', 'logs/x-260901-010203/README__assets'],
    ['docs/notes/plain', 'docs/notes/plain__assets'],
  ])('maps %s to %s', (document, expected) => {
    expect(componentAssetsDir(document)).toBe(expected)
  })
})

describe('writeComponentCache', () => {
  it('reports unchanged when only the key order differs, and updated on real change', async () => {
    const first = await writeComponentCache({
      root,
      documentPath: DOCUMENT,
      id: 'fid',
      ...BASE,
      data: { columns: ['a', 'b'], data: [[1, 2]] },
    })
    expect(first).toEqual({ status: 'updated', path: 'docs/wiki/note/W0004-fid__assets/fid.json' })

    const reordered = await writeComponentCache({
      root,
      documentPath: DOCUMENT,
      id: 'fid',
      ...BASE,
      durationMs: 99,
      data: { data: [[1, 2]], columns: ['a', 'b'] },
    })
    expect(reordered.status).toBe('unchanged')
    expect((await readComponentCache(root, DOCUMENT, 'fid'))?.durationMs).toBe(99)

    const changed = await writeComponentCache({
      root,
      documentPath: DOCUMENT,
      id: 'fid',
      ...BASE,
      data: { columns: ['a', 'b'], data: [[1, 3]] },
    })
    expect(changed.status).toBe('updated')
  })

  it('strips reserved keys the function itself returned', async () => {
    await writeComponentCache({
      root,
      documentPath: DOCUMENT,
      id: 'fid',
      ...BASE,
      data: { value: 1, __component_id: 'spoofed', __last_error: { at: 'x', message: 'y' } },
    })
    const cached = await readComponentCache(root, DOCUMENT, 'fid')
    expect(cached?.data).toEqual({ value: 1 })
    expect(cached?.componentId).toBe('fid')
    expect(cached?.lastError).toBeNull()
  })

  it('records a first-run failure as hidden keys plus __last_error, with no data', async () => {
    const result = await writeComponentCache({
      root,
      documentPath: DOCUMENT,
      id: 'fid',
      ...BASE,
      error: 'boom',
    })
    expect(result.status).toBe('failed')
    const raw = JSON.parse(await fs.readFile(join(root, result.path), 'utf8')) as Record<
      string,
      unknown
    >
    expect(Object.keys(raw).every((key) => key.startsWith('__'))).toBe(true)
    expect(raw.__last_error).toMatchObject({ message: 'boom' })
    expect(raw.__updated_at).toEqual(expect.any(String))
  })

  it('keeps the successful __updated_at and data when a later run fails', async () => {
    await writeComponentCache({
      root,
      documentPath: DOCUMENT,
      id: 'fid',
      ...BASE,
      data: { value: 1 },
      now: new Date('2026-09-01T10:00:00+08:00'),
    })
    const succeeded = await readComponentCache(root, DOCUMENT, 'fid')
    await writeComponentCache({
      root,
      documentPath: DOCUMENT,
      id: 'fid',
      ...BASE,
      error: 'boom',
      now: new Date('2026-09-02T10:00:00+08:00'),
    })
    const failed = await readComponentCache(root, DOCUMENT, 'fid')
    expect(failed?.data).toEqual({ value: 1 })
    expect(failed?.updatedAt).toBe(succeeded?.updatedAt)
    expect(failed?.lastError?.at).not.toBe(succeeded?.updatedAt)
  })

  it('clears __last_error once the block succeeds again', async () => {
    await writeComponentCache({ root, documentPath: DOCUMENT, id: 'fid', ...BASE, error: 'boom' })
    await writeComponentCache({
      root,
      documentPath: DOCUMENT,
      id: 'fid',
      ...BASE,
      data: { value: 2 },
    })
    expect((await readComponentCache(root, DOCUMENT, 'fid'))?.lastError).toBeNull()
  })

  it('writes pretty JSON with a trailing newline', async () => {
    const { path } = await writeComponentCache({
      root,
      documentPath: DOCUMENT,
      id: 'fid',
      ...BASE,
      data: { value: 1 },
    })
    const text = await fs.readFile(join(root, path), 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n  "value": 1,')
  })
})

describe('readComponentCache', () => {
  it('returns null for a missing file and for one that is not a JSON object', async () => {
    expect(await readComponentCache(root, DOCUMENT, 'fid')).toBeNull()
    await fs.mkdir(join(root, componentAssetsDir(DOCUMENT)), { recursive: true })
    await fs.writeFile(join(root, componentAssetsDir(DOCUMENT), 'fid.json'), '[1]', 'utf8')
    expect(await readComponentCache(root, DOCUMENT, 'fid')).toBeNull()
  })
})
