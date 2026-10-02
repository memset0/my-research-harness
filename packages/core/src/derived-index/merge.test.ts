import { describe, expect, it } from 'vitest'
import { emptySnapshot, mergeIndexEvents, type NamedIndexEvent } from './merge.js'
import type { ExperimentIndexEntry, IndexEvent, IndexSnapshot, RunIndexEntry } from './schema.js'

const T0 = '2026-10-01T10:00:00+08:00'
const T1 = '2026-10-01T10:01:00+08:00'
const T2 = '2026-10-01T10:02:00+08:00'

function run(status: RunIndexEntry['status'], ctime: number, verifiedAt = T0): RunIndexEntry {
  const fp = { ino: 7, size: 10, mtime_ms: ctime, ctime_ms: ctime }
  return {
    readme_fp: fp,
    dir_fp: { ...fp, ctime_ms: 1 },
    verified_at: verifiedAt,
    has_readme: true,
    status,
    archived: false,
    archive_source: 'frontmatter',
    deprecated: false,
    eligibility_error: null,
    contained: false,
    owner: null,
    row: {
      mtime: ctime,
      readme_mtime: ctime,
      id: 'a-260901-090000',
      name: 'a',
      project: '',
      finished_at: null,
      host: null,
      pid: null,
      gpus: [],
      entry: '',
      command: '',
      wandb: null,
      hypotheses: [],
      tags: [],
      parse_errors: [],
      parse_warnings: [],
    },
  }
}

function experiment(id: string, runs: string[]): ExperimentIndexEntry {
  return {
    dir: `docs/experiments/${id}`,
    id,
    slug: id.slice(6),
    status: 'OPEN',
    archived: false,
    runs,
    readme_fp: { ino: 1, size: 1, mtime_ms: 1, ctime_ms: 1 },
    bundle_fp: { implementation: null, investigation: null, results: null },
    verified_at: T0,
    row: {
      readme_mtime: 1,
      title: id,
      tags: [],
      created_at: T0,
      updated_at: T0,
      hypothesis_count: 0,
      open_warning_count: 0,
      parse_errors: [],
      parse_warnings: [],
    },
  }
}

function event(
  name: string,
  writtenAt: string,
  body: Partial<Pick<IndexEvent, 'upserts' | 'removals'>>,
): NamedIndexEvent {
  return {
    name,
    event: {
      index_version: 1,
      written_at: writtenAt,
      writer: { release: '8.0.0', role: 'cli', op: 'test' },
      upserts: body.upserts ?? {},
      removals: body.removals ?? {},
    },
  }
}

function base(): IndexSnapshot {
  const snapshot = emptySnapshot({ runDirs: ['logs/*'], runDirsSource: 'default', role: 'rebuild' })
  snapshot.runs['logs/a-260901-090000'] = run('RUNNING', 100)
  snapshot.walk.paths = ['logs/a-260901-090000']
  return snapshot
}

const KEY = 'logs/a-260901-090000'

describe('mergeIndexEvents', () => {
  it('applies a newer event entry', () => {
    const merged = mergeIndexEvents(base(), [
      event('0000000000002-1-aaaaaaaa.json', T1, {
        upserts: { runs: { [KEY]: run('FINISHED', 200) } },
      }),
    ])
    expect(merged.runs[KEY]?.status).toBe('FINISHED')
    expect(merged.merged_events).toEqual(['0000000000002-1-aaaaaaaa.json'])
  })

  it('keeps a newer validation over a stale event', () => {
    const snapshot = base()
    snapshot.runs[KEY] = run('FINISHED', 300, T2)
    const merged = mergeIndexEvents(snapshot, [
      event('0000000000002-1-aaaaaaaa.json', T1, {
        upserts: { runs: { [KEY]: run('RUNNING', 200) } },
      }),
    ])
    expect(merged.runs[KEY]?.status).toBe('FINISHED')
  })

  it('applies events in file-name order regardless of input order', () => {
    const merged = mergeIndexEvents(base(), [
      event('0000000000003-1-bbbbbbbb.json', T1, {
        upserts: { runs: { [KEY]: run('FAILED', 300) } },
      }),
      event('0000000000002-1-aaaaaaaa.json', T1, {
        upserts: { runs: { [KEY]: run('FINISHED', 300) } },
      }),
    ])
    expect(merged.runs[KEY]?.status).toBe('FAILED')
  })

  it('a removal yields to a later verification and applies otherwise', () => {
    const verifiedLater = base()
    verifiedLater.runs[KEY] = run('RUNNING', 100, T2)
    expect(
      mergeIndexEvents(verifiedLater, [
        event('0000000000002-1-aaaaaaaa.json', T1, { removals: { runs: [KEY] } }),
      ]).runs[KEY],
    ).toBeDefined()
    const merged = mergeIndexEvents(base(), [
      event('0000000000002-1-aaaaaaaa.json', T1, { removals: { runs: [KEY] } }),
    ])
    expect(merged.runs[KEY]).toBeUndefined()
    expect(merged.walk.paths).toEqual([])
  })

  it('is idempotent when re-merged and never mutates its input', () => {
    const snapshot = base()
    const before = structuredClone(snapshot)
    const events = [
      event('0000000000002-1-aaaaaaaa.json', T1, {
        upserts: { runs: { 'logs/b-260901-090000': run('PENDING', 5) } },
      }),
    ]
    const once = mergeIndexEvents(snapshot, events)
    const twice = mergeIndexEvents(once, events)
    expect(snapshot).toEqual(before)
    expect(twice).toEqual(once)
    expect(once.walk.paths).toEqual(['logs/a-260901-090000', 'logs/b-260901-090000'])
  })

  it('recomputes owners from Experiment entries (unique declarer only)', () => {
    const snapshot = base()
    snapshot.runs['logs/b-260901-090000'] = run('FINISHED', 1)
    snapshot.experiments['docs/experiments/E0001-foo'] = experiment('E0001-foo', [KEY])
    const merged = mergeIndexEvents(snapshot, [
      event('0000000000002-1-aaaaaaaa.json', T1, {
        upserts: {
          experiments: {
            'docs/experiments/E0002-bar': experiment('E0002-bar', ['b-260901-090000']),
          },
        },
      }),
    ])
    expect(merged.runs[KEY]?.owner).toBe('E0001-foo')
    expect(merged.runs['logs/b-260901-090000']?.owner).toBe('E0002-bar')
    const doubled = mergeIndexEvents(merged, [
      event('0000000000003-1-aaaaaaaa.json', T1, {
        upserts: { experiments: { 'docs/experiments/E0003-baz': experiment('E0003-baz', [KEY]) } },
      }),
    ])
    expect(doubled.runs[KEY]?.owner).toBeNull()
  })
})
