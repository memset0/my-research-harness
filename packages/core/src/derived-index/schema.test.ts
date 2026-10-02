import { describe, expect, it } from 'vitest'
import {
  eventFileName,
  eventFileTime,
  isEventFileName,
  isProjectRelativePath,
  resolveIndexPaths,
} from './paths.js'
import { type IndexSnapshot, parseEvent, parseSnapshot } from './schema.js'

const FP = { ino: 1, size: 2, mtime_ms: 3, ctime_ms: 4 }
const TS = '2026-10-01T10:00:00+08:00'

function sampleSnapshot(): IndexSnapshot {
  return {
    index_version: 2,
    fs_convention_version: 9,
    generated_at: TS,
    generator: { release: '8.0.0', role: 'rebuild' },
    run_dirs: ['logs/*'],
    run_dirs_source: 'default',
    walk: { verified_at: TS, paths: ['logs/a-260901-090000'] },
    merged_events: [],
    runs: {
      'logs/a-260901-090000': {
        readme_fp: FP,
        dir_fp: FP,
        result_fp: FP,
        result_schema_version: 2,
        verified_at: TS,
        has_readme: true,
        status: 'RUNNING',
        created_at: TS,
        updated_at: TS,
        archived: false,
        archive_source: 'frontmatter',
        deprecated: false,
        eligibility_error: null,
        contained: true,
        owner: null,
        row: {
          mtime: 1,
          readme_mtime: 1,
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
      },
    },
    experiments: {},
    wiki: {},
  }
}

describe('derived index schema', () => {
  it('round-trips a snapshot through JSON', () => {
    const snapshot = sampleSnapshot()
    const verdict = parseSnapshot(JSON.parse(JSON.stringify(snapshot)))
    expect(verdict).toEqual({ ok: true, value: snapshot })
  })

  it('classifies higher and lower index versions without parsing them', () => {
    expect(parseSnapshot({ ...sampleSnapshot(), index_version: 3 })).toEqual({
      ok: false,
      reason: 'unsupported',
      version: 3,
    })
    // An FS v8 (index_version 1) snapshot is outdated under v9 tooling.
    expect(parseSnapshot({ ...sampleSnapshot(), index_version: 1 })).toEqual({
      ok: false,
      reason: 'outdated',
      version: 1,
    })
    expect(parseEvent({ index_version: 9, anything: true })).toMatchObject({
      reason: 'unsupported',
    })
  })

  it('requires the v2 Run result fields and the description fingerprint', () => {
    const missing = sampleSnapshot()
    const { result_fp: _fp, ...entry } = missing.runs['logs/a-260901-090000']!
    missing.runs = { 'logs/a-260901-090000': entry as never }
    expect(parseSnapshot(missing)).toMatchObject({ ok: false, reason: 'invalid' })
    const experiment = {
      dir: 'docs/experiments/E0001-foo',
      id: 'E0001-foo',
      slug: 'foo',
      status: 'OPEN',
      archived: false,
      runs: [],
      readme_fp: FP,
      bundle_fp: { implementation: FP, investigation: FP, results: FP },
      verified_at: TS,
      row: {
        readme_mtime: 1,
        title: 'Foo',
        tags: [],
        created_at: TS,
        updated_at: TS,
        hypothesis_count: 0,
        open_warning_count: 0,
        parse_errors: [],
        parse_warnings: [],
      },
    }
    expect(
      parseSnapshot({ ...sampleSnapshot(), experiments: { [experiment.dir]: experiment } }),
    ).toMatchObject({ ok: false, reason: 'invalid' })
    const v2 = {
      ...experiment,
      bundle_fp: { implementation: FP, investigation: null, description: FP },
    }
    expect(parseSnapshot({ ...sampleSnapshot(), experiments: { [v2.dir]: v2 } })).toMatchObject({
      ok: true,
    })
  })

  it('rejects absolute and escaping keys, unknown fields and offset-less times', () => {
    const absolute = sampleSnapshot()
    absolute.runs = { '/abs/logs/a-260901-090000': absolute.runs['logs/a-260901-090000']! }
    expect(parseSnapshot(absolute)).toMatchObject({ ok: false, reason: 'invalid' })
    const escaping = sampleSnapshot()
    escaping.walk.paths = ['../outside-260901-090000']
    expect(parseSnapshot(escaping)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(parseSnapshot({ ...sampleSnapshot(), host: 'x' })).toMatchObject({ reason: 'invalid' })
    expect(
      parseSnapshot({ ...sampleSnapshot(), generated_at: '2026-10-01T10:00:00' }),
    ).toMatchObject({ reason: 'invalid' })
    expect(parseSnapshot([])).toMatchObject({ reason: 'invalid' })
  })

  it('validates events', () => {
    const event = {
      index_version: 2,
      written_at: TS,
      writer: { release: '8.0.0', role: 'cli', op: 'run.status' },
      upserts: { runs: sampleSnapshot().runs },
      removals: { experiments: ['docs/experiments/E0001-foo'] },
    }
    expect(parseEvent(event)).toMatchObject({ ok: true })
    expect(parseEvent({ ...event, removals: { runs: ['C:/x'] } })).toMatchObject({
      reason: 'invalid',
    })
  })
})

describe('derived index paths', () => {
  it('resolves the layout inside the project root', () => {
    const paths = resolveIndexPaths('/p/root/../root')
    expect(paths).toEqual({
      rootAbs: '/p/root',
      dir: '/p/root/.memon/index',
      gitignore: '/p/root/.memon/index/.gitignore',
      snapshot: '/p/root/.memon/index/snapshot.json',
      lock: '/p/root/.memon/index/compact.lock',
      events: '/p/root/.memon/index/events',
      results: '/p/root/.memon/index/results',
    })
  })

  it('names events <13-digit ts>-<pid>-<8 hex>.json', () => {
    const name = eventFileName(new Date(1_700_000_000_123), 42)
    expect(name).toMatch(/^1700000000123-42-[0-9a-f]{8}\.json$/)
    expect(isEventFileName(name)).toBe(true)
    expect(isEventFileName(`.tmp-${name}`)).toBe(false)
    expect(eventFileTime(name)).toBe(1_700_000_000_123)
    expect(eventFileName(new Date(5), 1).startsWith('0000000000005-1-')).toBe(true)
  })

  it('accepts only project-relative POSIX paths', () => {
    expect(isProjectRelativePath('logs/a-260901-090000')).toBe(true)
    for (const bad of ['', '/abs', 'a//b', './a', 'a/../b', 'a\\b', 'C:/x'])
      expect(isProjectRelativePath(bad)).toBe(false)
  })
})
