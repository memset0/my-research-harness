import { describe, expect, it } from 'vitest'

import {
  findWikiDeprecatedSections,
  validateWikiDeprecation,
  validateWikiEntry,
} from './deprecation.js'

describe('validateWikiDeprecation', () => {
  it('accepts a complete object', () => {
    const result = validateWikiDeprecation({
      at: '2026-09-01T10:00:00+08:00',
      reason: 'superseded by the fused path',
      superseded_by: 'W0012',
    })
    expect(result.diagnostics).toEqual([])
    expect(result.deprecation).toEqual({
      at: '2026-09-01T10:00:00+08:00',
      reason: 'superseded by the fused path',
      superseded_by: 'W0012',
    })
  })

  it('reports a missing reason, an offsetless `at`, and a malformed superseded_by', () => {
    const result = validateWikiDeprecation({ at: '2026-09-01T10:00:00', superseded_by: 'R0007' })
    expect(result.diagnostics.map((entry) => entry.code)).toEqual([
      'WIKI_DEPRECATION_INVALID',
      'WIKI_DEPRECATION_INVALID',
      'WIKI_DEPRECATION_INVALID',
    ])
    expect(result.diagnostics.every((entry) => entry.severity === 'error')).toBe(true)
  })

  it('reports a scalar `deprecated` value and keeps the page undeprecated', () => {
    const result = validateWikiDeprecation('yes')
    expect(result.deprecation).toBeNull()
    expect(result.diagnostics[0]?.code).toBe('WIKI_DEPRECATION_INVALID')
  })

  it('is silent when the key is absent', () => {
    expect(validateWikiDeprecation(undefined)).toEqual({ deprecation: null, diagnostics: [] })
  })
})

describe('findWikiDeprecatedSections', () => {
  it('attributes a dated marker under a heading to that heading', () => {
    const body = [
      '# Page',
      '',
      '## Old approach',
      '',
      '> [!DEPRECATED] since 2026-08-20: replaced by V0068',
      '',
      'text',
      '',
      '## Current approach',
      '',
      'text',
      '',
    ].join('\n')
    const result = findWikiDeprecatedSections(body)
    expect(result.diagnostics).toEqual([])
    expect(result.sections).toEqual([
      {
        heading: 'Old approach',
        level: 2,
        line: 3,
        reason: 'replaced by V0068',
        since: '2026-08-20',
      },
    ])
  })

  it('does not deprecate a section when prose separates heading and marker', () => {
    const body = ['## Notes', '', 'prose first', '', '> [!DEPRECATED] stale', ''].join('\n')
    const result = findWikiDeprecatedSections(body)
    expect(result.sections).toEqual([])
    expect(result.diagnostics).toEqual([])
  })

  it('errors on a marker without a reason', () => {
    const result = findWikiDeprecatedSections('## Old\n\n> [!DEPRECATED]\n\ntext\n')
    expect(result.diagnostics).toEqual([
      {
        code: 'WIKI_DEPRECATION_INVALID',
        severity: 'error',
        message: '`> [!DEPRECATED]` marker carries no reason',
        line: 3,
      },
    ])
    expect(result.sections.map((section) => section.heading)).toEqual(['Old'])
  })

  it('reads a reason continued on the next blockquote line', () => {
    const result = findWikiDeprecatedSections('## Old\n\n> [!DEPRECATED]\n> replaced by W0012\n')
    expect(result.diagnostics).toEqual([])
    expect(result.sections[0]?.reason).toBe('replaced by W0012')
  })

  it('ignores a marker inside a fenced block', () => {
    const result = findWikiDeprecatedSections('## Old\n\n```\n> [!DEPRECATED]\n```\n')
    expect(result.diagnostics).toEqual([])
    expect(result.sections).toEqual([])
  })
})

describe('validateWikiEntry', () => {
  const assets = ['README.md', 'views/dashboard/index.html']

  it('accepts a relative entry that exists in the bundle', () => {
    expect(validateWikiEntry('./views/dashboard/index.html', { format: 'bundle', assets })).toEqual(
      [],
    )
  })

  it('reports a missing target', () => {
    const diagnostics = validateWikiEntry('./views/gone/index.html', { format: 'bundle', assets })
    expect(diagnostics.map((entry) => [entry.code, entry.severity])).toEqual([
      ['WIKI_ENTRY_MISSING', 'error'],
    ])
  })

  it('rejects an entry on a single-file page and one escaping the bundle', () => {
    expect(validateWikiEntry('./views/x/index.html', { format: 'markdown', assets })[0]?.code).toBe(
      'WIKI_ENTRY_MISSING',
    )
    expect(validateWikiEntry('../other/index.html', { format: 'bundle', assets })[0]?.code).toBe(
      'WIKI_ENTRY_MISSING',
    )
  })

  it('is silent when the key is absent', () => {
    expect(validateWikiEntry(undefined, { format: 'bundle', assets })).toEqual([])
  })
})
