import { describe, expect, it } from 'vitest'
import {
  ActorContextSchema,
  BACKEND_API_MAJOR,
  BACKEND_DOCUMENT_KINDS,
  BackendCapabilitiesSchema,
  BackendCodeReviewPatchRequestSchema,
  BackendDocumentConflictResponseSchema,
  BackendDocumentSchema,
  BackendDocumentWriteRequestSchema,
  BackendErrorResponseSchema,
  BackendEventFrameSchema,
  BackendGitDiffResponseSchema,
  BackendGitRefSchema,
  BackendGitSubmodulesResponseSchema,
  BackendMetadataSchema,
  BackendProjectDiscoverySchema,
  BackendProjectsResponseSchema,
  BackendResourceInventoryResponseSchema,
  BackendReadmeResponseSchema,
  BackendReportResponseSchema,
  BackendResultsDocumentSchema,
  BackendShareCreateRequestSchema,
  BackendShareCreateResponseSchema,
  BackendShareListResponseSchema,
  BackendShareRevokeResponseSchema,
  BackendShareValidationRequestSchema,
  BackendShareValidationResponseSchema,
  BackendWikiBacklinksResponseSchema,
  BackendWikiDocumentSchema,
  BackendWikiPagesResponseSchema,
  BackendWikiReviewResponseSchema,
  CentralEventSchema,
  HostAvailabilitySchema,
  HostAvailabilityStateSchema,
  HostIdSchema,
  HostQualifiedResourceRefSchema,
  isUsableHostAvailabilityState,
  ProjectRefSchema,
  ResourceIdSchema,
} from './backend-protocol.js'
import {
  BackendResourceInventoryResponseSchema as PublicBackendResourceInventoryResponseSchema,
  HostIdSchema as PublicHostIdSchema,
} from './index.js'

const capabilities = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  wikiAssets: true,
  git: true,
  shares: true,
  slurm: false,
}

const epoch = '9c64885c-6671-4eb5-9648-d03e04987464'
const emittedAt = '2026-08-26T15:00:00Z'

describe('shared Backend protocol identity schemas', () => {
  it('is exported through the @memon/core public surface', () => {
    expect(PublicHostIdSchema).toBe(HostIdSchema)
  })

  it.each(['host-a', 'a', 'host-01'])('accepts a stable Host ID: %s', (host) => {
    expect(HostIdSchema.parse(host)).toBe(host)
  })

  it.each([
    '',
    'Host-A',
    '-host-a',
    'host_a',
    'host.a',
    'a'.repeat(64),
  ])('rejects a malformed Host ID: %s', (host) => {
    expect(HostIdSchema.safeParse(host).success).toBe(false)
  })

  it('requires the Host in every central Project reference', () => {
    expect(ProjectRefSchema.parse({ host: 'host-a', project: 'project-x' })).toEqual({
      host: 'host-a',
      project: 'project-x',
    })
    expect(ProjectRefSchema.safeParse({ project: 'project-x' }).success).toBe(false)
    expect(ProjectRefSchema.safeParse({ name: 'project-x', node: 'host-a' }).success).toBe(false)
    expect(
      ProjectRefSchema.safeParse({ host: 'host-a', project: 'project-x', root: '/srv/private' })
        .success,
    ).toBe(false)
  })

  it('requires Host and Project in resource references', () => {
    expect(
      HostQualifiedResourceRefSchema.parse({
        host: 'host-a',
        project: 'project-x',
        kind: 'run',
        id: 'train-260826-150000',
      }),
    ).toMatchObject({ host: 'host-a', project: 'project-x', kind: 'run' })

    expect(
      HostQualifiedResourceRefSchema.safeParse({
        project: 'project-x',
        kind: 'run',
        id: 'train-260826-150000',
      }).success,
    ).toBe(false)
  })

  it('accepts portable nested opaque IDs but rejects path spellings', () => {
    expect(ResourceIdSchema.safeParse('experiments/E0001-demo/code-review/review-a').success).toBe(
      true,
    )
    for (const id of [
      '/etc/passwd',
      'C:\\Windows\\system.ini',
      '../secret',
      'logs/../secret',
      'logs//output.txt',
      'logs\\output.txt',
      'logs%2foutput.txt',
      'logs%252foutput.txt',
      '%2e%2e/secret',
      'bad%00id',
      'bad%zz',
      `bad\0id`,
    ]) {
      expect(ResourceIdSchema.safeParse(id).success, id).toBe(false)
    }
  })

  it('validates portable name/path inventories on the public Core surface', () => {
    expect(PublicBackendResourceInventoryResponseSchema).toBe(
      BackendResourceInventoryResponseSchema,
    )
    expect(
      BackendResourceInventoryResponseSchema.parse({
        items: [
          {
            id: 'E0001-demo',
            slug: 'demo',
            resource: 'docs/experiments/E0001-demo/README.md',
          },
        ],
      }).items[0]?.slug,
    ).toBe('demo')
    expect(
      BackendResourceInventoryResponseSchema.safeParse({
        items: [{ id: 'E0001-demo', slug: 'demo', resource: '../outside.md' }],
      }).success,
    ).toBe(false)
  })

})

describe('Backend Results annotations', () => {
  it('transports optional sparse Markdown column/value descriptions', () => {
    const document = {
      schemaVersion: 1,
      columnAnnotations: {
        precision: {
          description: 'Controls **precision**.',
          valueDescriptions: { bf16: 'Uses **bfloat16**.' },
        },
      },
      columns: [
        {
          key: 'precision',
          label: 'Precision',
          group: 'parameter' as const,
          type: 'enum' as const,
          options: ['fp32', 'bf16'],
        },
      ],
      variants: [],
    }
    expect(BackendResultsDocumentSchema.parse(document)).toEqual(document)
  })
})

describe('shared Backend protocol metadata and availability schemas', () => {
  it('allows only bounded, path-free Project discovery metadata', () => {
    expect(
      BackendProjectDiscoverySchema.parse([
        { name: 'project-x', label: 'Project X', description: 'Synthetic Project' },
      ]),
    ).toEqual([{ name: 'project-x', label: 'Project X', description: 'Synthetic Project' }])
    expect(
      BackendProjectDiscoverySchema.safeParse([
        { name: 'project-x', root: '/srv/private', path: '/srv/private/docs' },
      ]).success,
    ).toBe(false)
    expect(
      BackendProjectDiscoverySchema.safeParse([{ name: 'project-x' }, { name: 'project-x' }])
        .success,
    ).toBe(false)
  })

  it('requires Host-qualified, unique Project response DTOs', () => {
    expect(
      BackendProjectsResponseSchema.parse({
        projects: [
          { host: 'host-a', project: 'project-x' },
          { host: 'host-b', project: 'project-x' },
        ],
      }).projects,
    ).toHaveLength(2)
    expect(
      BackendProjectsResponseSchema.safeParse({ projects: [{ project: 'project-x' }] }).success,
    ).toBe(false)
    expect(
      BackendProjectsResponseSchema.safeParse({
        projects: [
          { host: 'host-a', project: 'project-x' },
          { host: 'host-a', project: 'project-x' },
        ],
      }).success,
    ).toBe(false)
  })

  it('strictly validates bounded share-validation control DTOs', () => {
    expect(BackendShareValidationRequestSchema.parse({ token: 'share_token-01' })).toEqual({
      token: 'share_token-01',
    })
    expect(BackendShareValidationResponseSchema.parse({ valid: false })).toEqual({ valid: false })
    for (const request of [
      {},
      { token: '' },
      { token: 'contains spaces' },
      { token: 'a'.repeat(513) },
      { token: 'share-token', root: '/srv/private' },
    ]) {
      expect(BackendShareValidationRequestSchema.safeParse(request).success).toBe(false)
    }
    expect(
      BackendShareValidationResponseSchema.safeParse({ valid: true, token: 'secret' }).success,
    ).toBe(false)
  })

  it('strictly validates Backend share CRUD DTOs without URLs or path fields', () => {
    const record = {
      id: 'shr_abcdefgh',
      token: 'share_token',
      label: 'Reviewer',
      created_at: '2026-08-26T12:00:00Z',
      expires_at: null,
    }
    expect(BackendShareCreateRequestSchema.parse({ label: 'Reviewer', expires: '30d' })).toEqual({
      label: 'Reviewer',
      expires: '30d',
    })
    expect(BackendShareListResponseSchema.parse({ shares: [record] })).toEqual({ shares: [record] })
    expect(BackendShareCreateResponseSchema.parse({ share: record })).toEqual({ share: record })
    expect(BackendShareRevokeResponseSchema.parse({ revoked: [record] })).toEqual({
      revoked: [record],
    })
    for (const invalid of [
      { label: '', expires: 'never' },
      { expires: '0d' },
      { expires: 'latest' },
      { label: 'Reviewer', root: '/srv/private' },
    ]) {
      expect(BackendShareCreateRequestSchema.safeParse(invalid).success).toBe(false)
    }
    expect(
      BackendShareCreateResponseSchema.safeParse({
        share: { ...record, share_url: 'https://backend.internal/private' },
      }).success,
    ).toBe(false)
  })

  it('validates a complete, closed capability set', () => {
    expect(BackendCapabilitiesSchema.parse(capabilities)).toEqual(capabilities)
    expect(BackendCapabilitiesSchema.safeParse({ projects: true }).success).toBe(false)
    expect(
      BackendCapabilitiesSchema.safeParse({ ...capabilities, arbitraryShell: true }).success,
    ).toBe(false)
  })

  it('validates authenticated Backend metadata', () => {
    const metadata = {
      host: 'host-a',
      release: '6.0.0',
      apiMajor: BACKEND_API_MAJOR,
      revision: '0123456789abcdef',
      instanceEpoch: epoch,
      ready: true,
      capabilities,
    }
    expect(BackendMetadataSchema.parse(metadata)).toEqual(metadata)
    expect(BackendMetadataSchema.safeParse({ ...metadata, host: 'Host-A' }).success).toBe(false)
    expect(BackendMetadataSchema.safeParse({ ...metadata, release: '6.0' }).success).toBe(false)
    expect(BackendMetadataSchema.safeParse({ ...metadata, apiMajor: 2 }).success).toBe(false)
    expect(BackendMetadataSchema.safeParse({ ...metadata, authToken: 'secret' }).success).toBe(
      false,
    )
  })

  it('enumerates all distinct Host states and only two usable states', () => {
    for (const state of [
      'connecting',
      'offline',
      'authentication_failed',
      'identity_mismatch',
      'misconfigured',
      'filesystem_migration_required',
      'upgrade_required',
      'central_update_required',
      'update_available',
      'online',
    ]) {
      expect(HostAvailabilityStateSchema.safeParse(state).success, state).toBe(true)
    }
    expect(HostAvailabilityStateSchema.safeParse('network_error').success).toBe(false)
    expect(isUsableHostAvailabilityState('online')).toBe(true)
    expect(isUsableHostAvailabilityState('update_available')).toBe(true)
    expect(isUsableHostAvailabilityState('offline')).toBe(false)
  })

  it('rejects malformed or secret-bearing availability DTOs', () => {
    const status = {
      host: 'host-a',
      state: 'online',
      diagnostic: null,
      lastSuccessfulCheckAt: emittedAt,
      centralRelease: '6.0.1',
      backendRelease: '6.0.0',
      backendRevision: '0123456789abcdef',
      capabilities,
    }
    expect(HostAvailabilitySchema.parse(status)).toEqual(status)
    expect(HostAvailabilitySchema.safeParse({ ...status, host: undefined }).success).toBe(false)
    expect(HostAvailabilitySchema.safeParse({ ...status, token: 'secret' }).success).toBe(false)
    expect(HostAvailabilitySchema.safeParse({ ...status, backendRelease: null }).success).toBe(
      false,
    )
    expect(
      HostAvailabilitySchema.safeParse({
        ...status,
        state: 'connecting',
        lastSuccessfulCheckAt: null,
        backendRelease: null,
        backendRevision: null,
        capabilities: null,
      }).success,
    ).toBe(true)
  })
})

describe('shared Backend actor, event, and error schemas', () => {
  it('allows only owner or Host-qualified viewer context', () => {
    expect(ActorContextSchema.parse({ role: 'owner' })).toEqual({ role: 'owner' })
    expect(
      ActorContextSchema.parse({
        role: 'viewer',
        scopes: [{ host: 'host-a', project: 'project-x' }],
      }),
    ).toMatchObject({ role: 'viewer' })

    expect(
      ActorContextSchema.safeParse({ role: 'viewer', scopes: [{ project: 'project-x' }] }).success,
    ).toBe(false)
    expect(ActorContextSchema.safeParse({ role: 'viewer', scopes: [] }).success).toBe(false)
    expect(
      ActorContextSchema.safeParse({
        role: 'viewer',
        scopes: [
          { host: 'host-a', project: 'project-x' },
          { host: 'host-a', project: 'project-x' },
        ],
      }).success,
    ).toBe(false)
    expect(ActorContextSchema.safeParse({ role: 'anon' }).success).toBe(false)
    expect(ActorContextSchema.safeParse({ role: 'owner', scopes: [] }).success).toBe(false)
  })

  it('validates bounded Backend event frames', () => {
    expect(
      BackendEventFrameSchema.parse({
        kind: 'event',
        instanceEpoch: epoch,
        sequence: 3,
        emittedAt,
        project: 'project-x',
        topic: 'run-change',
        data: { id: 'run-a', type: 'set' },
      }),
    ).toMatchObject({ sequence: 3, project: 'project-x' })

    expect(
      BackendEventFrameSchema.safeParse({
        kind: 'event',
        instanceEpoch: epoch,
        sequence: -1,
        emittedAt,
        project: 'project-x',
        topic: 'run-change',
        data: {},
      }).success,
    ).toBe(false)
  })

  it('rejects name-only events after central attaches Host authority', () => {
    const event = {
      kind: 'event',
      host: 'host-a',
      project: 'project-x',
      instanceEpoch: epoch,
      sequence: 3,
      emittedAt,
      topic: 'experiment-change',
      data: { id: 'E0001-demo', type: 'set' },
    }
    expect(CentralEventSchema.parse(event)).toEqual(event)
    const { host: _host, ...nameOnly } = event
    expect(CentralEventSchema.safeParse(nameOnly).success).toBe(false)
    expect(
      CentralEventSchema.safeParse({
        kind: 'host-resync',
        host: 'host-a',
        reason: 'sequence_gap',
        emittedAt,
      }).success,
    ).toBe(true)
  })

  it('accepts only bounded, redacted Backend errors', () => {
    const response = {
      error: {
        code: 'INVALID_RESOURCE',
        message: 'resource identifier is invalid',
        requestId: 'request-01',
        retryable: false,
      },
    }
    expect(BackendErrorResponseSchema.parse(response)).toEqual(response)
    expect(
      BackendErrorResponseSchema.safeParse({
        error: { ...response.error, code: 'SHELL_FAILED' },
      }).success,
    ).toBe(false)
    expect(
      BackendErrorResponseSchema.safeParse({
        error: { ...response.error, token: 'secret' },
      }).success,
    ).toBe(false)
    expect(
      BackendErrorResponseSchema.safeParse({
        error: { ...response.error, message: 'x'.repeat(513) },
      }).success,
    ).toBe(false)
  })

  it('keeps document DTOs strict, bounded, relative, and conflict-safe', () => {
    const document = {
      id: 'code-review/2026-08-26-review',
      project: 'project-x',
      kind: 'code-review',
      title: 'Review',
      mtime: 1,
      hash: 'a'.repeat(40),
      content: '# Review',
    }
    expect(BackendDocumentSchema.parse(document)).toEqual(document)
    expect(
      BackendDocumentSchema.safeParse({ ...document, path: '/srv/private/review.md' }).success,
    ).toBe(false)
    expect(
      BackendDocumentSchema.safeParse({ ...document, id: '/srv/private/review' }).success,
    ).toBe(false)
    const report = {
      id: 'R0001',
      project: 'project-x',
      resource: 'docs/reports/R0001-report.md',
      slug: 'report',
      title: 'Report',
      mtime: 1,
      format: 'markdown',
      hash: 'a'.repeat(40),
      content: '# Report',
    }
    expect(BackendReportResponseSchema.parse(report)).toEqual(report)
    expect(BackendReportResponseSchema.safeParse({ report }).success).toBe(false)
    expect(
      BackendReportResponseSchema.safeParse({
        ...report,
        path: '/srv/private/report.md',
      }).success,
    ).toBe(false)
    expect(
      BackendReadmeResponseSchema.safeParse({
        resource: '/srv/private/README.md',
        project: 'project-x',
        mtime: 1,
        hash: 'a'.repeat(40),
        content: '# README',
      }).success,
    ).toBe(false)
    const readme = {
      resource: 'logs/run-a/README.md',
      project: 'project-x',
      mtime: 1,
      hash: 'a'.repeat(40),
      content: '# README',
    }
    expect(BackendReadmeResponseSchema.parse(readme)).toEqual(readme)
    expect(BackendReadmeResponseSchema.safeParse({ readme }).success).toBe(false)
    expect(
      BackendDocumentWriteRequestSchema.safeParse({
        content: '# Updated',
        expectedMtime: 1,
        expectedHash: 'a'.repeat(40),
        root: '/srv/private',
      }).success,
    ).toBe(false)
    expect(
      BackendCodeReviewPatchRequestSchema.safeParse({
        op: 'commit',
        sha: 'abc123',
        reviewed: true,
        expectedMtime: 1,
        expectedHash: 'not-a-hash',
      }).success,
    ).toBe(false)
    expect(
      BackendDocumentConflictResponseSchema.safeParse({
        error: { code: 'CONFLICT', message: 'changed' },
        currentMtime: 2,
        currentHash: 'b'.repeat(40),
        currentContent: 'must not cross the trust boundary',
      }).success,
    ).toBe(false)
  })

  it('carries wiki pages as its own document kind without bodies or cluster paths', () => {
    const summary = {
      id: 'W0004',
      project: 'project-x',
      resource: 'docs/wiki/finding/attention-tail-latency.md',
      slug: 'attention-tail-latency',
      kind: 'finding',
      title: 'Attention tail latency',
      description: 'Where the tail comes from',
      status: 'VERIFIED',
      date: null,
      language: 'zh',
      tags: ['attention'],
      sources: ['E0017', 'E0017/V3'],
      legacyId: 'R0004',
      entry: 'scripts/bench/tail.sh',
      deprecated: null,
      deprecatedSections: [],
      stale: true,
      staleSources: ['E0017/V3'],
      review: {
        state: 'CHANGED_SINCE_VERIFY',
        verifiedThrough: 'a'.repeat(40),
        verifiedAt: '2026-08-26T15:00:00+08:00',
        unverifiedCommits: ['b'.repeat(40)],
        unverifiedRanges: [[12, 18]],
        dirty: true,
      },
      format: 'markdown',
      mtime: 1,
      createdAt: '2026-08-20T09:00:00+08:00',
      updatedAt: '2026-08-26T15:00:00+08:00',
      diagnostics: [
        { code: 'WIKI_SOURCE_UNRESOLVED', severity: 'warn', message: 'E0017/V3', line: 6 },
      ],
    }
    expect(BackendWikiPagesResponseSchema.parse({ pages: [summary] })).toEqual({ pages: [summary] })
    // A list entry never carries the body; only the single-page envelope does.
    expect(
      BackendWikiPagesResponseSchema.safeParse({ pages: [{ ...summary, content: '# x' }] }).success,
    ).toBe(false)
    // An older Backend omits the field; the page then reads as English.
    const { language: _language, ...withoutLanguage } = summary
    expect(BackendWikiPagesResponseSchema.parse({ pages: [withoutLanguage] }).pages[0]).toEqual({
      ...withoutLanguage,
      language: 'en',
    })
    expect(
      BackendWikiPagesResponseSchema.safeParse({ pages: [{ ...summary, language: 'fr' }] }).success,
    ).toBe(false)
    const page = { ...summary, hash: 'c'.repeat(40), content: '---\nid: W0004\n---\n' }
    expect(BackendWikiDocumentSchema.parse(page)).toEqual(page)
    expect(
      BackendWikiDocumentSchema.safeParse({ ...page, path: '/srv/private/docs/wiki/f.md' }).success,
    ).toBe(false)
    expect(
      BackendWikiDocumentSchema.safeParse({ ...page, resource: '/srv/private/docs/wiki/f.md' })
        .success,
    ).toBe(false)
    expect(BackendWikiDocumentSchema.safeParse({ ...page, id: 'R0004' }).success).toBe(false)

    // Unknown kind directories stay readable; the mismatch is a diagnostic.
    expect(
      BackendWikiPagesResponseSchema.safeParse({
        pages: [{ ...summary, kind: 'retro', review: null }],
      }).success,
    ).toBe(true)

    expect(
      BackendWikiBacklinksResponseSchema.parse({
        artifact: 'E0017',
        pages: [
          {
            id: 'W0004',
            slug: summary.slug,
            kind: summary.kind,
            title: summary.title,
            status: summary.status,
            stale: summary.stale,
            deprecated: false,
            reviewState: summary.review.state,
            updatedAt: summary.updatedAt,
          },
        ],
      }).pages,
    ).toHaveLength(1)
    expect(BACKEND_DOCUMENT_KINDS).toContain('wiki')
    expect(
      BackendDocumentSchema.safeParse({
        id: 'W0004',
        project: 'project-x',
        kind: 'wiki',
        title: 'Attention tail latency',
        mtime: 1,
        hash: 'a'.repeat(40),
        content: '# Finding',
      }).success,
    ).toBe(true)
  })

  it('reports wiki review as an ordered commit log with a verified prefix', () => {
    const log = {
      verifiedThrough: 'a'.repeat(40),
      commits: [
        {
          sha: 'a'.repeat(40),
          authoredAt: '2026-08-20T09:00:00+08:00',
          subject: 'wiki: record attention finding',
          pages: ['W0004'],
          verified: true,
          verifiedAt: '2026-08-26T15:00:00+08:00',
          note: 'checked against E0017',
        },
        {
          sha: 'b'.repeat(40),
          authoredAt: '2026-08-26T18:00:00+08:00',
          subject: 'wiki: revise tail analysis',
          pages: ['W0004', 'W0009'],
          verified: false,
        },
      ],
    }
    expect(BackendWikiReviewResponseSchema.parse(log)).toEqual(log)
    expect(BackendWikiReviewResponseSchema.parse({ ...log, verifiedThrough: null })).toMatchObject({
      verifiedThrough: null,
    })
    expect(
      BackendWikiReviewResponseSchema.safeParse({
        verifiedThrough: 'abc1234',
        commits: [],
      }).success,
    ).toBe(false)
    expect(
      BackendWikiReviewResponseSchema.safeParse({
        verifiedThrough: null,
        commits: [{ ...log.commits[1], pages: ['R0004'] }],
      }).success,
    ).toBe(false)
  })

  it('accepts wiki event topics on Backend frames', () => {
    for (const topic of ['wiki-change', 'wiki-review-change']) {
      expect(
        BackendEventFrameSchema.parse({
          kind: 'event',
          instanceEpoch: epoch,
          sequence: 4,
          emittedAt,
          project: 'project-x',
          topic,
          data: topic === 'wiki-change' ? { id: 'W0004', type: 'set' } : {},
        }),
      ).toMatchObject({ topic })
    }
  })

  it('rejects Git option injection, absolute file IDs, and unsafe submodule metadata', () => {
    expect(BackendGitRefSchema.safeParse('HEAD~2').success).toBe(true)
    expect(BackendGitRefSchema.safeParse('--all').success).toBe(false)
    expect(BackendGitRefSchema.safeParse('main..other').success).toBe(false)
    expect(
      BackendGitDiffResponseSchema.safeParse({
        ok: true,
        filename: '/etc/passwd',
        status: 'modified',
        oldContent: '',
        newContent: '',
      }).success,
    ).toBe(false)
    expect(
      BackendGitSubmodulesResponseSchema.safeParse({
        enabled: true,
        submodules: [{ name: 'escape', path: '../../private' }],
      }).success,
    ).toBe(false)
  })
})
