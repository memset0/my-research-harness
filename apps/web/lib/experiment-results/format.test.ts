// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { buildColumns } from './columns'
import { resultsDocument, variant } from './fixtures.test-helpers'
import {
  displayText,
  formatScalar,
  gitBlobUrl,
  gitCommitUrl,
  isEmptyValue,
  isSafeRelativePath,
  keyedLines,
  normalizedRepositoryUrl,
  operatorSymbol,
  parseWandbUrl,
  plainCellValue,
  sortActionLabel,
  sortDirectionLabel,
  sortDirectionSymbol,
  sotaRankClass,
  splitDisplayLines,
  valueText,
} from './format'

describe('value text', () => {
  it.each([
    [undefined, '', '—', true],
    [null, '', '—', true],
    ['', '', '—', true],
    [[], '', '—', true],
    [0, '0', '0', false],
    [false, 'false', 'false', false],
    [Number.NaN, 'NaN', 'NaN', false],
    ['a<br/>b', 'a<br/>b', 'a\nb', false],
    [['r1', 'r2'], 'r1\nr2', 'r1\nr2', false],
  ])('%j', (value, text, display, empty) => {
    expect(valueText(value)).toBe(text)
    expect(displayText(value)).toBe(display)
    expect(isEmptyValue(value)).toBe(empty)
  })

  it('plainCellValue reads through the column', () => {
    const row = variant('V1', { metrics: { notes: 'x<BR>y' } })
    const notes = buildColumns(resultsDocument([row])).find((c) => c.id === 'schema:notes')!
    expect(plainCellValue(notes, row)).toBe('x\ny')
  })
})

describe('lines', () => {
  it.each([
    ['one', ['one']],
    ['a<br>b<br/>c<br />d\ne\r\nf', ['a', 'b', 'c', 'd', 'e', 'f']],
    ['', ['']],
  ])('splits %j', (value, expected) => {
    expect(splitDisplayLines(value)).toEqual(expected)
  })

  it('keys repeated lines uniquely', () => {
    expect(keyedLines('x<br>x<br>y').map((entry) => entry.key)).toEqual([
      'x\u00001',
      'x\u00002',
      'y\u00001',
    ])
  })
})

describe('formatScalar', () => {
  it.each([
    [0.1, 2, '0.10', true],
    [3, 0, '3', true],
    [0.123, undefined, '0.123', false],
    [Number.NaN, 2, 'NaN', false],
    [Number.POSITIVE_INFINITY, 2, 'Infinity', false],
    ['0.5', 2, '0.5', false],
    [true, 1, 'true', false],
  ])('%j with %j places', (value, places, text, formatted) => {
    expect(formatScalar(value, places)).toEqual({ text, decimalFormatted: formatted })
  })
})

describe('parseWandbUrl', () => {
  it.each([
    [
      'https://wandb.ai/acme/p/runs/abc123',
      { href: 'https://wandb.ai/acme/p/runs/abc123', label: 'abc123' },
    ],
    [
      'http://team.wandb.ai/x/run%20one',
      { href: 'http://team.wandb.ai/x/run%20one', label: 'run one' },
    ],
    ['https://wandb.ai/', { href: 'https://wandb.ai/', label: 'wandb.ai' }],
    ['https://wandb.ai/a/%E0%A4%A', { href: 'https://wandb.ai/a/%E0%A4%A', label: '%E0%A4%A' }],
    [' https://wandb.ai/a', null],
    ['https://notwandb.ai/a', null],
    ['https://wandb.ai.evil.com/a', null],
    ['ftp://wandb.ai/a', null],
    ['not a url', null],
    ['', null],
  ])('%j', (value, expected) => {
    expect(parseWandbUrl(value)).toEqual(expected)
  })
})

describe('git links', () => {
  const withProvenance = (provenance: Record<string, string>) => variant('V1', { provenance })

  it.each([
    ['https://github.com/o/r.git', 'https://github.com/o/r'],
    ['https://github.com/o/r/?x=1#y', 'https://github.com/o/r'],
    ['git@github.com:o/r.git', null],
    ['file:///tmp/repo', null],
  ])('normalizes %s', (repo, expected) => {
    expect(normalizedRepositoryUrl(repo)).toBe(expected)
  })

  it.each([
    ['train.py', true],
    ['dir\\file.py', true],
    ['', false],
    ['/abs/path', false],
    ['../escape', false],
    ['https://x/y', false],
  ])('safe path %j', (path, expected) => {
    expect(isSafeRelativePath(path)).toBe(expected)
  })

  it('builds blob and commit URLs only with repo and commit', () => {
    const row = withProvenance({ repo: 'https://github.com/o/r.git', commit: 'abc' })
    expect(gitBlobUrl(row, 'src/a b.py')).toBe('https://github.com/o/r/blob/abc/src/a%20b.py')
    expect(gitCommitUrl(row)).toBe('https://github.com/o/r/commit/abc')
    expect(gitBlobUrl(withProvenance({ repo: 'https://github.com/o/r' }), 'a.py')).toBeNull()
    expect(gitCommitUrl(variant('V2'))).toBeNull()
  })
})

describe('labels', () => {
  it.each([
    ['eq', '='],
    ['neq', '≠'],
    ['gt', '>'],
    ['lt', '<'],
  ] as const)('operator %s', (operator, symbol) => {
    expect(operatorSymbol(operator)).toBe(symbol)
  })

  it('sort direction labels', () => {
    expect(sortDirectionSymbol('asc')).toBe('↑')
    expect(sortDirectionSymbol('desc')).toBe('↓')
    expect(sortDirectionLabel('desc')).toBe('descending')
    expect(sortActionLabel(null)).toMatch(/^default sort/)
    expect(sortActionLabel('asc')).toMatch(/activate for descending$/)
    expect(sortActionLabel('desc')).toMatch(/activate for default sort$/)
  })

  it.each([
    [1, 'font-bold underline'],
    [2, 'font-bold'],
    [3, 'underline'],
    [undefined, ''],
  ] as const)('SOTA rank %s', (rank, classes) => {
    expect(sotaRankClass(rank)).toBe(classes)
  })
})
