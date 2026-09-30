// @vitest-environment node
// The declaration grammar and the payload model exist twice: once here in the
// dashboard, where 'use client' components import them (client code must not
// pull `@memon/core` runtime), and once in `@memon/core`, where the CLI runner
// and structural lint need them without a React dependency. Neither copy may
// drift, so this test runs both over one fixture list and asserts identical
// results. It lives in the dashboard because only this package may depend on
// both sides; core never imports dashboard sources.

import {
  derivePayload as coreDerivePayload,
  executableFunctionName as coreExecutableFunctionName,
  parseComponentDeclaration as coreParseDeclaration,
  stripHiddenKeys as coreStripHiddenKeys,
} from '@memon/core'
import { describe, expect, it } from 'vitest'

import { parseComponentDeclaration } from './declaration'
import { derivePayload, executableFunctionName, stripHiddenKeys } from './payload'

const INFO_STRINGS = [
  '',
  'yaml',
  'yaml datatable@1',
  'yaml datatable@1 #fid',
  'yaml datatable',
  'json checklist@2 #plan',
  'html embed@1 #chart',
  'python collect@1',
  'yaml datatable@0 #fid',
  'yaml datatable@01 #fid',
  'yaml datatable@1 #fid title="x"',
  'yaml datatable@1 fid',
  'yaml datatable@1 #bad-id',
  'yaml Datatable@1',
  'yaml datatable@1 #fid #other',
  '  yaml   datatable@1   #fid  ',
  'yaml datatable@1.2',
  'mermaid flowchart',
]

const PAYLOADS: { lang: string; body: string }[] = [
  { lang: 'yaml', body: 'columns: [a, b]\ndata: [[1, 2]]\n' },
  { lang: 'yaml', body: '' },
  { lang: 'yaml', body: '- 1\n- 2\n' },
  { lang: 'yaml', body: 'a: 1\na: 2\n' },
  { lang: 'yaml', body: 'base: &b {x: 1}\nother: *b\n' },
  { lang: 'yaml', body: 'a: [unclosed\n' },
  { lang: 'yaml', body: 'script: ../scripts/fid.py::collect\nrun_dir: logs/x-260901-010203\n' },
  { lang: 'yaml', body: 'script: not-a-reference\n' },
  { lang: 'yaml', body: 'script: 12\n' },
  {
    lang: 'yaml',
    body: 'code: |\n  def collect(**kw):\n      return {"columns": ["a"], "data": [[1]]}\nlimit: 3\n',
  },
  { lang: 'yaml', body: 'code: |\n  x = 1\n' },
  { lang: 'yaml', body: 'code: |\n  def a():\n      pass\n  def b():\n      pass\n' },
  { lang: 'yaml', body: 'code: 12\n' },
  { lang: 'yaml', body: 'script: a.py::f\ncode: |\n  def f():\n      pass\n' },
  { lang: 'yaml', body: 'script: a.py::f\n__id: forced\n' },
  { lang: 'yml', body: 'script: a.py::f\nlimit: 2\n' },
  { lang: 'json', body: '{"columns": ["a"], "data": [[1]]}' },
  { lang: 'json', body: '[1, 2]' },
  { lang: 'json', body: '{oops}' },
  { lang: 'json', body: '{"script": "a.py::f"}' },
  { lang: 'html', body: '<p>hi</p>\n' },
  { lang: 'html', body: 'script: a.py::f\n' },
]

describe('declaration grammar parity', () => {
  it.each(INFO_STRINGS)('agrees on %j', (info) => {
    expect(parseComponentDeclaration(info)).toEqual(coreParseDeclaration(info))
  })
})

describe('payload derivation parity', () => {
  it.each(
    PAYLOADS.map((entry) => [`${entry.lang}: ${JSON.stringify(entry.body)}`, entry] as const),
  )('agrees on %s', (_label, entry) => {
    const mine = derivePayload(entry.lang, entry.body)
    expect(mine).toEqual(coreDerivePayload(entry.lang, entry.body))
    if (mine.kind === 'executable') {
      expect(executableFunctionName(mine.spec)).toBe(coreExecutableFunctionName(mine.spec))
    }
  })

  it('agrees on stripping reserved keys', () => {
    const value = { a: 1, __md_file_path: 'x.md', __last_error: { message: 'boom' }, b: 2 }
    expect(stripHiddenKeys(value)).toEqual(coreStripHiddenKeys(value))
    expect(stripHiddenKeys(value)).toEqual({ a: 1, b: 2 })
  })
})
