import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatIsoLocal } from '../time.js'
import { acquireIndexLease, compactIndex } from './compact.js'
import { appendIndexEvent, type IndexSink } from './events.js'
import { defaultIndexFs, type IndexFs } from './fs.js'
import { ensureIndexDirectory } from './gitignore.js'
import { resolveIndexPaths } from './paths.js'
import { mergedIndexView, readDerivedIndex } from './snapshot.js'

let root: string
let sink: IndexSink

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-index-compact-'))
  sink = { projectRoot: root, role: 'cli' }
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const index = (...parts: string[]) => join(root, '.memon/index', ...parts)

async function removal(run: string) {
  const result = await appendIndexEvent(sink, 'test', {
    upserts: {},
    removals: { runs: [`logs/${run}-260901-090000`] },
  })
  return result.name!
}

async function eventNames(): Promise<string[]> {
  return (await fs.readdir(index('events'))).filter((name) => !name.startsWith('.')).sort()
}

describe('compactIndex', () => {
  it('does nothing on a project without an index', async () => {
    const result = await compactIndex(root, { role: 'cli' })
    expect(result.status).toBe('unchanged')
    await expect(fs.access(join(root, '.memon'))).rejects.toThrow()
  })

  it('merges events into the snapshot and deletes exactly the merged names', async () => {
    const names = [await removal('a'), await removal('b')]
    const result = await compactIndex(root, { role: 'cli' })
    expect(result.status).toBe('compacted')
    expect(result.merged).toEqual([...names].sort())
    expect(await eventNames()).toEqual([])
    const read = await readDerivedIndex(root)
    expect(read.snapshotState).toBe('ok')
    expect(read.snapshot?.merged_events).toEqual([...names].sort())
    expect(read.snapshot?.run_dirs_source).toBe('default')
    // A second compaction without new events keeps an equivalent snapshot.
    const again = await compactIndex(root, { role: 'cli' })
    expect(again.status).toBe('unchanged')
    expect((await readDerivedIndex(root)).snapshot).toEqual(read.snapshot)
  })

  it('never deletes an event published while compaction runs', async () => {
    await removal('a')
    let late: string | null = null
    const hooked: IndexFs = {
      ...defaultIndexFs,
      rename: (async (from: string, to: string) => {
        if (to === index('snapshot.json') && late === null) late = await removal('late')
        return defaultIndexFs.rename(from, to)
      }) as IndexFs['rename'],
    }
    const result = await compactIndex(root, { role: 'central', fs: hooked })
    expect(result.status).toBe('compacted')
    expect(result.merged).not.toContain(late)
    expect(await eventNames()).toEqual([late])
    const view = mergedIndexView(await readDerivedIndex(root), {
      runDirs: [],
      runDirsSource: 'default',
    })
    expect(view?.merged_events).toEqual([late])
  })

  it('two concurrent compactions never lose an event', async () => {
    const names = await Promise.all(['a', 'b', 'c', 'd'].map(removal))
    const results = await Promise.all([
      compactIndex(root, { role: 'cli' }),
      compactIndex(root, { role: 'central' }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(
      results.some((result) => result.status === 'conflict')
        ? ['compacted', 'conflict']
        : ['compacted', 'unchanged'],
    )
    const merged = results.flatMap((result) => result.merged)
    expect([...new Set(merged)].sort()).toEqual([...names].sort())
    expect(await eventNames()).toEqual([])
  })

  it('compaction concurrent with publishers keeps every event merged or pending', async () => {
    const before = await Promise.all(['a', 'b'].map(removal))
    const [result, ...during] = await Promise.all([
      compactIndex(root, { role: 'cli' }),
      removal('c'),
      removal('d'),
    ])
    const remaining = await eventNames()
    for (const name of [...before, ...during]) {
      expect(result!.merged.includes(name) || remaining.includes(name)).toBe(true)
    }
  })

  it('refuses while an unexpired lease is held and changes no index file', async () => {
    await removal('a')
    const lease = await acquireIndexLease(root, { role: 'central' })
    expect(lease).not.toBeNull()
    const result = await compactIndex(root, { role: 'cli' })
    expect(result.status).toBe('conflict')
    await expect(fs.access(index('snapshot.json'))).rejects.toThrow()
    expect(await eventNames()).toHaveLength(1)
    await lease!.release()
    await expect(fs.access(index('compact.lock'))).rejects.toThrow()
  })

  it('an expired lease is taken over by exactly one contender', async () => {
    await ensureIndexDirectory(resolveIndexPaths(root))
    await fs.writeFile(
      index('compact.lock'),
      JSON.stringify({
        pid: 1,
        role: 'central',
        expires_at: formatIsoLocal(new Date(Date.now() - 1000)),
        token: 'old',
      }),
    )
    for (let round = 0; round < 5; round += 1) {
      const leases = await Promise.all(
        Array.from({ length: 6 }, () => acquireIndexLease(root, { role: 'cli' })),
      )
      expect(leases.filter((lease) => lease !== null)).toHaveLength(1)
      // Expire the winner's lease for the next round.
      const winner = JSON.parse(await fs.readFile(index('compact.lock'), 'utf8'))
      await fs.writeFile(
        index('compact.lock'),
        JSON.stringify({ ...winner, expires_at: formatIsoLocal(new Date(Date.now() - 1000)) }),
      )
    }
  })

  it('never overwrites a snapshot with a newer index_version', async () => {
    await removal('a')
    await fs.writeFile(index('snapshot.json'), JSON.stringify({ index_version: 2, future: true }))
    const result = await compactIndex(root, { role: 'cli' })
    expect(result.status).toBe('unsupported')
    expect(JSON.parse(await fs.readFile(index('snapshot.json'), 'utf8'))).toEqual({
      index_version: 2,
      future: true,
    })
    expect(await eventNames()).toHaveLength(1)
    expect(
      mergedIndexView(await readDerivedIndex(root), { runDirs: [], runDirsSource: 'default' }),
    ).toBeNull()
  })

  it('removes temporaries older than one hour and keeps younger ones', async () => {
    await removal('a')
    const old = index('events', '.tmp-0000000000001-1-aaaaaaaa')
    const young = index('.tmp-snapshot-bbbbbbbb')
    await fs.writeFile(old, '{')
    await fs.writeFile(young, '{')
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await fs.utimes(old, past, past)
    const result = await compactIndex(root, { role: 'cli' })
    expect(result.removedTemporaries).toEqual(['events/.tmp-0000000000001-1-aaaaaaaa'])
    await expect(fs.access(old)).rejects.toThrow()
    await fs.access(young)
  })
})

describe('damaged index', () => {
  it('a truncated, invalid or missing snapshot reads as no index', async () => {
    expect((await readDerivedIndex(root)).snapshotState).toBe('missing')
    await ensureIndexDirectory(resolveIndexPaths(root))
    await fs.writeFile(index('snapshot.json'), '{"index_version": 1, "runs": {')
    const truncated = await readDerivedIndex(root)
    expect(truncated.snapshotState).toBe('invalid')
    expect(mergedIndexView(truncated, { runDirs: [], runDirsSource: 'default' })).toBeNull()
    await fs.writeFile(index('snapshot.json'), JSON.stringify({ index_version: 1, runs: [] }))
    expect((await readDerivedIndex(root)).snapshotState).toBe('invalid')
  })

  it('skips and reports unparsable events older than 60 s, keeps younger ones pending', async () => {
    const good = await removal('a')
    await fs.writeFile(index('events', '0000000000001-1-aaaaaaaa.json'), '{"index_version":')
    const fresh = `${String(Date.now()).padStart(13, '0')}-1-bbbbbbbb.json`
    await fs.writeFile(index('events', fresh), 'nope')
    await fs.writeFile(index('events', '.tmp-whatever'), 'partial')
    const read = await readDerivedIndex(root)
    expect(read.events.map((event) => event.name)).toEqual([good])
    expect(read.skipped).toEqual([
      { name: '0000000000001-1-aaaaaaaa.json', reason: 'invalid', message: expect.any(String) },
    ])
    expect(read.pending).toEqual([fresh])
    const result = await compactIndex(root, { role: 'cli' })
    expect(result.merged).toEqual([good])
    expect(result.skipped.map((skip) => skip.name)).toEqual(['0000000000001-1-aaaaaaaa.json'])
    expect(await eventNames()).toEqual(['0000000000001-1-aaaaaaaa.json', fresh].sort())
  })
})
