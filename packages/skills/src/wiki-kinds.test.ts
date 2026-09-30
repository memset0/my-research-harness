import { readFileSync } from 'node:fs'
import { parseWikiKindRegistry, renderWikiKindGuidance } from '@memon/core'
import { describe, expect, it } from 'vitest'

describe('generated Wiki kind guidance', () => {
  it('matches the source registry byte-for-byte', () => {
    const registry = parseWikiKindRegistry(
      JSON.parse(readFileSync(new URL('../../core/src/wiki/kinds.json', import.meta.url), 'utf8')),
    )
    const actual = readFileSync(
      new URL('../memon-wiki/references/page-kinds.md', import.meta.url),
      'utf8',
    )
    expect(actual).toBe(renderWikiKindGuidance(registry))
    registry.kinds[0]!.en.purpose = 'Changed purpose.'
    expect(actual).not.toBe(renderWikiKindGuidance(registry))
  })
})
