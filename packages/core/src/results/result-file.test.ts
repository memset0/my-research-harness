import { describe, expect, it } from 'vitest'
import {
  checkResultFilesConsistency,
  checkResultFileTypes,
  editResultFileContent,
  encodeResultValue,
  inferScalarResultType,
  interpretResultText,
  parseResultFile,
  type ResultColumnShape,
  ResultFileEditError,
  resultContentHash,
  resultFileEntries,
  serializeResultFile,
} from './result-file.js'

const codes = (content: string) => parseResultFile(content).diagnostics.map((d) => d.code)

const DESIGN_EXAMPLE = [
  'path,stat,value',
  '$experiment_schema_version,,2',
  'params.optim.lr,,0.0001',
  'params.data.splits,,"[""train"",""val""]"',
  'env.CUDA_VERSION,,12.4',
  'metrics.eval.fid,,12.3',
  'metrics.eval.clip,mean,0.312',
  'metrics.eval.clip,std,0.021',
  'metrics.eval.clip,n,500',
  'metrics.serve.latency_ms,max.p99,140.2',
  'metrics.serve.latency_ms,mean.p99,120.1',
  'metrics.notes,,',
  '',
].join('\n')

describe('parseResultFile', () => {
  it('reads the design example without diagnostics', () => {
    const parsed = parseResultFile(DESIGN_EXAMPLE)
    expect(parsed.ok).toBe(true)
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.schemaVersion).toBe(2)
    expect(parsed.reservedRows.map((row) => row.path)).toEqual(['$experiment_schema_version'])
    expect(parsed.rows).toHaveLength(10)
    const entries = resultFileEntries(parsed)
    expect([...entries.get('metrics.eval.clip')!.stats.keys()]).toEqual(['mean', 'std', 'n'])
    expect(entries.get('metrics.notes')!.scalar!.value).toBe('')
    expect(entries.get('params.data.splits')!.scalar!.value).toBe('["train","val"]')
    expect(interpretResultText('["train","val"]', 'list')).toEqual({
      ok: true,
      value: ['train', 'val'],
    })
  })

  it('groups parameters by dotted path', () => {
    const parsed = parseResultFile(
      'path,stat,value\n$experiment_schema_version,,1\nparams.optim.lr,,0.1\nparams.optim.batch_size,,32\n',
    )
    const entries = [...resultFileEntries(parsed).keys()]
    expect(entries).toEqual(['params.optim.lr', 'params.optim.batch_size'])
  })

  it('requires the version row and rejects unknown reserved paths', () => {
    expect(codes('path,stat,value\nmetrics.fid,,1\n')).toEqual(['RESULT_SCHEMA_VERSION_MISSING'])
    expect(codes('path,stat,value\n$experiment_schema_version,,1\n$wandb,,abc\n')).toEqual([
      'RESULT_RESERVED_PATH_UNKNOWN',
    ])
    expect(
      codes('path,stat,value\n$experiment_schema_version,mean,1\n$experiment_schema_version,,2\n'),
    ).toEqual(['RESULT_RESERVED_ROW_STAT', 'RESULT_RESERVED_ROW_DUPLICATE'])
    expect(codes('path,stat,value\nmetrics.fid,,1\n$experiment_schema_version,,1\n')).toEqual([
      'RESULT_RESERVED_ROW_ORDER',
    ])
    const invalid = parseResultFile('path,stat,value\n$experiment_schema_version,,v2\n')
    expect(invalid.schemaVersion).toBeNull()
    expect(invalid.diagnostics.map((d) => d.code)).toEqual(['RESULT_SCHEMA_VERSION_INVALID'])
  })

  it('reports a leaf that is also a group', () => {
    const parsed = parseResultFile(
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.eval,,1\nmetrics.eval.fid,,2\n',
    )
    expect(parsed.diagnostics).toMatchObject([
      { code: 'RESULT_PATH_CONFLICT', field: 'metrics.eval', line: 3 },
    ])
  })

  it('keeps a statistic outside the vocabulary verbatim but reports it', () => {
    const content = 'path,stat,value\n$experiment_schema_version,,1\nmetrics.lat,median,5\n'
    const parsed = parseResultFile(content)
    expect(parsed.diagnostics.map((d) => d.code)).toEqual(['RESULT_STAT_UNKNOWN'])
    expect(parsed.rows[0]).toMatchObject({ raw: 'metrics.lat,median,5', valid: false })
    expect(resultFileEntries(parsed).size).toBe(0)
  })

  it('names both lines of a duplicate pair', () => {
    const parsed = parseResultFile(
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.eval.fid,,1\nmetrics.eval.is,,2\nmetrics.eval.fid,,3\n',
    )
    expect(parsed.duplicates).toEqual([{ path: 'metrics.eval.fid', stat: '', lines: [3, 5] }])
    expect(parsed.diagnostics[0]).toMatchObject({ code: 'RESULT_DUPLICATE_ROW', line: 5 })
  })

  it('reports a path recorded as both a scalar and statistics in one file', () => {
    expect(
      codes('path,stat,value\n$experiment_schema_version,,1\nmetrics.x,,1\nmetrics.x,mean,2\n'),
    ).toEqual(['RESULT_TYPE_CONFLICT'])
  })

  it('reports a bad header, a broken quote and a wrong cell count', () => {
    expect(parseResultFile('metric,value\nx,1\n').ok).toBe(false)
    expect(codes('metric,value\n')).toEqual(['RESULT_HEADER_INVALID'])
    const unterminated = parseResultFile(
      'path,stat,value\n$experiment_schema_version,,1\nm.x,,"abc\n',
    )
    expect(unterminated.ok).toBe(false)
    expect(unterminated.diagnostics[0]).toMatchObject({ code: 'RESULT_CSV_INVALID', line: 3 })
    expect(
      codes('path,stat,value\n$experiment_schema_version,,1\nmetrics.fid,12\nmetrics.a,,"x"y\n'),
    ).toEqual(['RESULT_ROW_INVALID', 'RESULT_CSV_INVALID'])
  })

  it('reads CRLF line endings, a byte-order mark and quoted multi-line cells', () => {
    const content =
      '﻿path,stat,value\r\n$experiment_schema_version,,3\r\nmetrics.note,,"two\r\nlines"\r\nmetrics.fid,,1\r\n'
    const parsed = parseResultFile(content)
    expect(parsed).toMatchObject({ ok: true, bom: true, eol: '\r\n', schemaVersion: 3 })
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.rows.map((row) => [row.line, row.value])).toEqual([
      [3, 'two\r\nlines'],
      [5, '1'],
    ])
  })

  it('rejects a non-number statistic value', () => {
    expect(codes('path,stat,value\n$experiment_schema_version,,1\nmetrics.x,mean,abc\n')).toEqual([
      'RESULT_VALUE_TYPE_MISMATCH',
    ])
  })
})

describe('declared types', () => {
  const columns = new Map<string, ResultColumnShape>([
    ['metrics.eval.fid', { path: 'metrics.eval.fid', type: 'number' }],
    ['metrics.eval.clip', { path: 'metrics.eval.clip', type: 'stats' }],
    ['params.precision', { path: 'params.precision', type: 'enum', options: ['fp32', 'bf16'] }],
    ['metrics.lat', { path: 'metrics.lat', type: 'stats', over: 'gpu' }],
    ['params.data.splits', { path: 'params.data.splits', type: 'list' }],
  ])

  it('accepts matching values and undeclared paths', () => {
    const parsed = parseResultFile(
      [
        'path,stat,value',
        '$experiment_schema_version,,1',
        'metrics.eval.fid,,12.3',
        'metrics.eval.clip,mean,0.31',
        'params.precision,,bf16',
        'metrics.lat,max.p99,5',
        'params.data.splits,,"[""a""]"',
        'metrics.eval.lpips,,0.2',
        '',
      ].join('\n'),
    )
    expect(checkResultFileTypes(parsed, columns)).toEqual([])
  })

  it('reports violations of the declared type', () => {
    const parsed = parseResultFile(
      [
        'path,stat,value',
        '$experiment_schema_version,,1',
        'metrics.eval.fid,,abc',
        'metrics.eval.clip,,0.31',
        'params.precision,,fp8',
        'metrics.lat,max,5',
        'params.data.splits,mean,1',
        '',
      ].join('\n'),
    )
    expect(checkResultFileTypes(parsed, columns).map((d) => [d.code, d.line])).toEqual([
      ['RESULT_VALUE_TYPE_MISMATCH', 3],
      ['RESULT_VALUE_TYPE_MISMATCH', 4],
      ['RESULT_VALUE_TYPE_MISMATCH', 5],
      ['RESULT_STAT_LEVEL_MISMATCH', 6],
      ['RESULT_STAT_ON_SCALAR', 7],
    ])
  })

  it('infers undeclared types from recorded texts', () => {
    expect(inferScalarResultType(['1', '2.5', '', '1e-5'])).toBe('number')
    expect(inferScalarResultType(['true', 'false'])).toBe('boolean')
    expect(inferScalarResultType(['["a"]', '[]'])).toBe('list')
    expect(inferScalarResultType(['1', 'abc'])).toBe('string')
    expect(inferScalarResultType(['', ''])).toBe('string')
  })

  it('reports a path recorded as a scalar in one file and as statistics in another', () => {
    const scalar = parseResultFile(
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.eval.fid,,1\n',
    )
    const stats = parseResultFile(
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.eval.fid,mean,1\n',
    )
    const diagnostics = checkResultFilesConsistency([
      { file: 'logs/a-260901-090000/result.csv', parsed: scalar },
      { file: 'logs/b-260901-090000/result.csv', parsed: stats },
    ])
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]!.code).toBe('RESULT_TYPE_CONFLICT')
    expect(diagnostics[0]!.message).toContain('logs/a-260901-090000/result.csv')
    expect(diagnostics[0]!.message).toContain('logs/b-260901-090000/result.csv')
  })
})

describe('writing', () => {
  it('creates a minimal file with the header and the version row', () => {
    const edit = editResultFileContent(null, {
      schemaVersion: 1,
      set: [{ path: 'metrics.fid', value: '12.3' }],
    })
    expect(edit).toMatchObject({ created: true, changed: true, appended: 1 })
    expect(edit.content).toBe('path,stat,value\n$experiment_schema_version,,1\nmetrics.fid,,12.3\n')
    expect(parseResultFile(edit.content).diagnostics).toEqual([])
  })

  it('quotes list values and other cells only when needed', () => {
    expect(
      serializeResultFile(1, [
        { path: 'params.data.splits', value: encodeResultValue(['train', 'val']) },
        { path: 'metrics.note', value: 'a, "b"' },
        { path: 'metrics.lr', value: encodeResultValue(0.000008) },
      ]),
    ).toBe(
      'path,stat,value\n$experiment_schema_version,,1\nparams.data.splits,,"[""train"",""val""]"\nmetrics.note,,"a, ""b"""\nmetrics.lr,,0.000008\n',
    )
  })

  it('upserts in place and keeps unrelated rows byte-identical and in position', () => {
    const content =
      'path,stat,value\n$experiment_schema_version,,2\nmetrics.eval.fid,,12.3\n"metrics.eval.is",,"40.1"\n'
    const edit = editResultFileContent(content, {
      schemaVersion: 2,
      set: [
        { path: 'metrics.eval.fid', value: '11.9' },
        { path: 'metrics.eval.clip', stat: 'mean', value: '0.31' },
      ],
    })
    expect(edit).toMatchObject({ changed: true, replaced: 1, appended: 1 })
    expect(edit.content).toBe(
      'path,stat,value\n$experiment_schema_version,,2\nmetrics.eval.fid,,11.9\n"metrics.eval.is",,"40.1"\nmetrics.eval.clip,mean,0.31\n',
    )
  })

  it('round-trips an untouched file byte for byte', () => {
    const content =
      '﻿path,stat,value\r\n$experiment_schema_version,,1\r\n"metrics.a",,"1"\r\nmetrics.b,,2'
    const same = editResultFileContent(content, {
      schemaVersion: 1,
      set: [{ path: 'metrics.a', value: '1' }],
    })
    expect(same).toMatchObject({ changed: false, content })
    const appended = editResultFileContent(content, {
      schemaVersion: 1,
      set: [{ path: 'metrics.c', value: '3' }],
    })
    expect(appended.content).toBe(`${content}\r\nmetrics.c,,3\r\n`)
  })

  it('unsets a pair with its line terminator', () => {
    const content = 'path,stat,value\n$experiment_schema_version,,1\nmetrics.a,,1\nmetrics.b,,2\n'
    const edit = editResultFileContent(content, {
      schemaVersion: 1,
      unset: [{ path: 'metrics.a' }],
    })
    expect(edit.content).toBe('path,stat,value\n$experiment_schema_version,,1\nmetrics.b,,2\n')
    expect(edit.removed).toBe(1)
  })

  it('refuses a stale version, a duplicated target and an unreadable file', () => {
    const content = 'path,stat,value\n$experiment_schema_version,,1\nmetrics.a,,1\nmetrics.a,,2\n'
    expect(() =>
      editResultFileContent(content, {
        schemaVersion: 2,
        set: [{ path: 'metrics.b', value: '1' }],
      }),
    ).toThrow(expect.objectContaining({ code: 'RESULT_SCHEMA_MISMATCH' }))
    expect(() =>
      editResultFileContent(content, {
        schemaVersion: 1,
        set: [{ path: 'metrics.a', value: '3' }],
      }),
    ).toThrow(ResultFileEditError)
    expect(() => editResultFileContent('x,y\n', { schemaVersion: 1, set: [] })).toThrow(
      expect.objectContaining({ code: 'RESULT_FILE_INVALID' }),
    )
  })

  it('hashes content with sha256', () => {
    expect(resultContentHash('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
})
