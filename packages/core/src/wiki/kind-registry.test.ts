import { describe, expect, it, vi } from 'vitest'
import configuration from './kinds.json'
import {
  getWikiKind,
  parseWikiKindRegistry,
  WIKI_KINDS,
  WIKI_RECOMMENDED_SECTIONS,
} from './kind-registry.js'
import { renderWikiKindGuidance } from './kind-guidance.js'

describe('Wiki kind registry', () => {
  it('preserves existing order and status vocabularies', () => {
    expect(WIKI_KINDS).toEqual([
      'meeting',
      'roadmap',
      'finding',
      'bottleneck',
      'showcase',
      'question',
      'decision',
      'note',
      'harness-feedback',
      'initiative',
      'catalog',
      'digest',
    ])
    expect(
      Object.fromEntries(
        parseWikiKindRegistry(configuration).kinds.map((kind) => [kind.id, kind.policy.statuses]),
      ),
    ).toEqual({
      meeting: [],
      roadmap: [],
      finding: ['TENTATIVE', 'VERIFIED', 'RETRACTED'],
      bottleneck: ['OPEN', 'MITIGATED', 'RESOLVED'],
      showcase: ['DRAFT', 'READY', 'OUTDATED'],
      question: ['OPEN', 'ANSWERED', 'DROPPED'],
      decision: ['PROPOSED', 'ACCEPTED', 'SUPERSEDED'],
      note: [],
      'harness-feedback': ['PROPOSED', 'ACCEPTED', 'SHIPPED', 'REJECTED'],
      initiative: [],
      catalog: [],
      digest: [],
    })
  })

  it.each([
    'roadmap',
    'initiative',
    'catalog',
    'digest',
    'note',
  ])('%s stays free-form and status-free', (id) => {
    expect(getWikiKind(id)?.policy).toMatchObject({
      statuses: [],
      recommendedHeadings: [],
      requiredHeadings: [],
    })
  })

  it('preserves all existing date, source and advisory heading policies', () => {
    const kinds = parseWikiKindRegistry(configuration).kinds
    expect(kinds.filter((kind) => kind.policy.dateRequired).map((kind) => kind.id)).toEqual([
      'meeting',
    ])
    expect(kinds.filter((kind) => kind.policy.sourcesRequired).map((kind) => kind.id)).toEqual([
      'finding',
    ])
    expect(
      Object.fromEntries(
        kinds
          .filter((kind) => kind.policy.recommendedHeadings.length > 0)
          .map((kind) => [kind.id, kind.policy.recommendedHeadings]),
      ),
    ).toEqual({
      meeting: ['Attendees', 'Notes', 'Decisions', 'Action items'],
      finding: ['Claim', 'Evidence', 'Limits'],
      bottleneck: ['Problem', 'Impact', 'Status', 'Candidates'],
      showcase: ['What to show', 'How to reproduce', 'Assets'],
      question: ['Question', 'Context', 'Answer'],
      decision: ['Decision', 'Rationale', 'Consequences'],
      'harness-feedback': ['Motivation', 'Proposal', 'Status'],
    })
    expect(WIKI_RECOMMENDED_SECTIONS.finding).toEqual(['Claim', 'Evidence', 'Limits'])
    expect(WIKI_RECOMMENDED_SECTIONS.note).toEqual([])
  })

  it.each([
    [
      'duplicate ID',
      (value: typeof configuration) => {
        value.kinds[1]!.id = 'meeting'
      },
      'id',
    ],
    [
      'duplicate order',
      (value: typeof configuration) => {
        value.kinds[1]!.order = 10
      },
      'order',
    ],
    [
      'negative order',
      (value: typeof configuration) => {
        value.kinds[0]!.order = -1
      },
      'order',
    ],
    [
      'missing label',
      (value: typeof configuration) => {
        value.kinds[0]!.label = ''
      },
      'label',
    ],
    [
      'missing help',
      (value: typeof configuration) => {
        value.kinds[0]!.zh.purpose = ' '
      },
      'zh.purpose',
    ],
    [
      'missing examples',
      (value: typeof configuration) => {
        value.kinds[0]!.en.examples = []
      },
      'en.examples',
    ],
    [
      'bad reference',
      (value: typeof configuration) => {
        value.kinds[0]!.relatedKinds = ['missing']
      },
      'relatedKinds',
    ],
    [
      'reserved ID',
      (value: typeof configuration) => {
        value.kinds[0]!.id = 'assets'
      },
      'id',
    ],
    [
      'bad status',
      (value: typeof configuration) => {
        value.kinds[0]!.policy.statuses = ['lowercase']
      },
      'statuses',
    ],
    [
      'a Chinese headings list',
      (value: typeof configuration) => {
        const finding = value.kinds.find((kind) => kind.id === 'finding')!
        ;(finding.zh as Record<string, unknown>).headings = ['结论', '证据', '局限']
      },
      'zh.headings',
    ],
    [
      'bad review policy',
      (value: typeof configuration) => {
        value.kinds[0]!.policy.reviewWarningStatus = 'VERIFIED'
      },
      'reviewWarningStatus',
    ],
  ])('rejects %s with a field path', (_name, edit, field) => {
    const value = structuredClone(configuration)
    edit(value)
    expect(() => parseWikiKindRegistry(value)).toThrow(field)
  })

  it('rejects executable/unknown policies and required scaffolds', () => {
    const value = structuredClone(configuration)
    Object.assign(value.kinds[0]!.policy, { execute: 'code', requiredHeadings: ['Mandatory'] })
    expect(() => parseWikiKindRegistry(value)).toThrow('policy')
  })

  it('generates deterministic guidance and propagates edited semantics', () => {
    const value = structuredClone(configuration)
    value.kinds[0]!.en.purpose = 'Updated purpose.'
    value.kinds[0]!.en.examples = ['Updated example.']
    const registry = parseWikiKindRegistry(value)
    const rendered = renderWikiKindGuidance(registry)
    expect(rendered).toContain('Updated purpose.')
    expect(rendered).toContain('Updated example.')
    expect(renderWikiKindGuidance({ ...registry, kinds: [...registry.kinds].reverse() })).toBe(
      rendered,
    )
  })

  it('recognizes and lints a config-only ordinary kind without another list', async () => {
    const value = structuredClone(configuration)
    value.kinds.push({
      ...structuredClone(value.kinds.find((kind) => kind.id === 'note')!),
      id: 'test-guide',
      order: 1000,
      relatedKinds: [],
    })
    vi.resetModules()
    vi.doMock('./kinds.json', () => ({ default: value }))
    try {
      const registry = await import('./kind-registry.js')
      const { lintWikiPage } = await import('./lint.js')
      expect(registry.isWikiKind('test-guide')).toBe(true)
      expect(renderWikiKindGuidance(registry.WIKI_KIND_REGISTRY)).toContain('## test-guide')
      expect(
        lintWikiPage({
          id: 'W0001',
          slug: 'sample',
          kind: 'test-guide',
          format: 'markdown',
          path: 'docs/wiki/test-guide/W0001-sample.md',
          body: '# Sample',
          frontmatter: {
            id: 'W0001',
            kind: 'test-guide',
            title: 'Sample',
            created_at: '2026-09-01T00:00:00+00:00',
            updated_at: '2026-09-01T00:00:00+00:00',
          },
        }),
      ).toEqual([])
    } finally {
      vi.doUnmock('./kinds.json')
      vi.resetModules()
    }
  })
})
