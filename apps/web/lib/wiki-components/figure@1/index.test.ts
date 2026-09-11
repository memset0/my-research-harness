// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { figureV1 } from './index'
import { listComponentBlocks, lintComponents } from '../registry'

const valid = {
  slug: 'pipeline-overview',
  src: 'assets/pipeline-overview.svg',
  caption: 'Figure 1. Processing pipeline.',
  description: 'Input and output boxes connected by an arrow.',
}

describe('figure@1', () => {
  it.each([
    'svg',
    'png',
    'jpg',
    'jpeg',
    'webp',
    'gif',
    'avif',
  ])('accepts a local %s image', (extension) => {
    const data = { ...valid, src: `assets/pipeline-overview.${extension}` }
    expect(figureV1.parsePayload(JSON.stringify(data), {})).toEqual(data)
  })

  it.each([
    'https://example.com/image.svg',
    '//example.com/image.svg',
    '/assets/pipeline-overview.svg',
    'data:image/svg+xml,<svg/>',
    'assets/../pipeline-overview.svg',
    'assets/%2e%2e/pipeline-overview.svg',
    'assets/nested/pipeline-overview.svg',
    'assets/pipeline-overview.html',
    'assets/another-image.svg',
  ])('rejects unsafe or mismatched src %s', (src) => {
    expect(() => figureV1.parsePayload(JSON.stringify({ ...valid, src }), {})).toThrow()
  })

  it.each(['slug', 'src', 'caption', 'description'])('requires %s', (field) => {
    const data: Record<string, unknown> = { ...valid }
    delete data[field]
    expect(() => figureV1.parsePayload(JSON.stringify(data), {})).toThrow()
  })

  it('rejects malformed YAML, blank descriptions, unknown fields and attributes', () => {
    expect(() => figureV1.parsePayload('src: [', {})).toThrow()
    expect(() =>
      figureV1.parsePayload(JSON.stringify({ ...valid, description: '  ' }), {}),
    ).toThrow()
    expect(() => figureV1.parsePayload(JSON.stringify({ ...valid, execute: true }), {})).toThrow()
    expect(() => figureV1.parsePayload(JSON.stringify(valid), { script: 'run' })).toThrow()
  })

  it('preserves all fields in Markdown projection and reports invalid payloads', () => {
    expect(listComponentBlocks(figureV1.toMarkdown(valid))[0]?.data).toEqual(valid)
    expect(lintComponents('```figure@1\ncaption: missing fields\n```')[0]?.code).toBe(
      'WIKI_COMPONENT_INVALID',
    )
    expect(lintComponents(figureV1.example)).toEqual([])
  })
})
