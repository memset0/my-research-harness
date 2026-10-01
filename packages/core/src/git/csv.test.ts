import { describe, expect, it } from 'vitest'
import { parseCsvRecords, quoteCsvField } from './csv.js'

describe('shared CSV helpers', () => {
  it('round-trips quoted fields with commas, quotes and newlines', () => {
    const fields = ['plain', 'a,b', 'say "hi"', 'two\nlines', '']
    const line = fields.map(quoteCsvField).join(',')
    expect(parseCsvRecords(`h1,h2,h3,h4,h5\n${line}\n`)).toEqual([
      ['h1', 'h2', 'h3', 'h4', 'h5'],
      fields,
    ])
  })

  it('accepts CRLF and skips blank lines', () => {
    expect(parseCsvRecords('a,b\r\n\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps a final record without a trailing newline', () => {
    expect(parseCsvRecords('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})
