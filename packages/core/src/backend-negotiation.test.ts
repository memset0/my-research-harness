import { describe, expect, it, vi } from 'vitest'
import {
  guardBackendRoute,
  invokeNegotiatedBackendRoute,
  negotiateBackend,
} from './backend-negotiation.js'
import {
  BACKEND_API_MAJOR,
  type BackendCapabilities,
  BackendMetadataSchema,
} from './backend-protocol.js'
import { negotiateBackend as publicNegotiateBackend } from './index.js'

const EPOCH = '9c64885c-6671-4eb5-9648-d03e04987464'

const CURRENT_CAPABILITIES = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  wikiAssets: true,
  git: true,
  shares: true,
  slurm: true,
} satisfies BackendCapabilities

function metadata(
  release: string,
  capabilities: unknown = CURRENT_CAPABILITIES,
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    host: 'host-a',
    release,
    apiMajor: BACKEND_API_MAJOR,
    revision: '0123456789abcdef',
    instanceEpoch: EPOCH,
    ready: true,
    capabilities,
    ...overrides,
  }
}

function negotiate(candidate: unknown, centralRelease = '6.2.0') {
  return negotiateBackend({
    centralRelease,
    centralApiMajor: BACKEND_API_MAJOR,
    metadata: candidate,
  })
}

describe('Backend protocol adapter negotiation', () => {
  it('is exported through the @memon/core public surface', () => {
    expect(publicNegotiateBackend).toBe(negotiateBackend)
  })

  it('selects the current-Minor adapter only for complete current metadata', () => {
    const result = negotiate(metadata('6.2.99'))
    expect(result).toMatchObject({ ok: true, state: 'online', adapter: 'current-minor' })
    if (!result.ok) return
    expect(BackendMetadataSchema.parse(result.metadata).capabilities).toEqual(CURRENT_CAPABILITIES)
  })

  it('selects the previous-Minor adapter and normalizes absent known capabilities to false', () => {
    const { slurm: _newCapability, ...previousCapabilities } = CURRENT_CAPABILITIES
    const result = negotiate(metadata('6.1.7', previousCapabilities))
    expect(result).toMatchObject({
      ok: true,
      state: 'update_available',
      adapter: 'previous-minor',
    })
    if (!result.ok) return
    expect(result.metadata.capabilities.projects).toBe(true)
    expect(result.metadata.capabilities.slurm).toBe(false)
    expect(BackendMetadataSchema.safeParse(result.metadata).success).toBe(true)
  })

  it.each([
    [metadata('6.0.9'), 'upgrade_required'],
    [metadata('6.3.0'), 'central_update_required'],
    [metadata('7.2.0'), 'filesystem_migration_required'],
    [metadata('not-a-release'), 'misconfigured'],
    [metadata('6.2.0', CURRENT_CAPABILITIES, { apiMajor: BACKEND_API_MAJOR + 1 }), 'misconfigured'],
    [metadata('6.2.0', CURRENT_CAPABILITIES, { ready: false }), 'not_ready'],
  ])('fails closed for an unusable Backend state: %s', (candidate, state) => {
    expect(negotiate(candidate)).toMatchObject({ ok: false, state })
  })

  it('does not apply previous-Minor defaults to malformed current-Minor metadata', () => {
    const { slurm: _missing, ...incompleteCapabilities } = CURRENT_CAPABILITIES
    expect(negotiate(metadata('6.2.0', incompleteCapabilities))).toMatchObject({
      ok: false,
      state: 'misconfigured',
    })
  })

  it('rejects malformed and unknown previous-Minor capability entries', () => {
    expect(negotiate(metadata('6.1.0', { ...CURRENT_CAPABILITIES, slurm: 'yes' }))).toMatchObject({
      ok: false,
      state: 'misconfigured',
    })
    expect(
      negotiate(metadata('6.1.0', { ...CURRENT_CAPABILITIES, futureShell: true })),
    ).toMatchObject({ ok: false, state: 'misconfigured' })
  })
})

describe('Backend capability and route guard', () => {
  it('never invokes a route whose capability is absent from the previous Minor fixture', async () => {
    const { slurm: _newCapability, ...previousCapabilities } = CURRENT_CAPABILITIES
    const negotiated = negotiate(metadata('6.1.0', previousCapabilities))
    const invoke = vi.fn(() => 'must-not-run')

    const result = await invokeNegotiatedBackendRoute(negotiated, 'slurm', invoke)

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_CAPABILITY' },
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('invokes a supported previous-Minor route with the explicit adapter', async () => {
    const { slurm: _newCapability, ...previousCapabilities } = CURRENT_CAPABILITIES
    const negotiated = negotiate(metadata('6.1.0', previousCapabilities))
    const invoke = vi.fn((route: { adapter: string }) => route.adapter)

    const result = await invokeNegotiatedBackendRoute(negotiated, 'projects', invoke)

    expect(result).toEqual({ ok: true, value: 'previous-minor' })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('gates wiki asset proxying on the capability while report assets stay allowed', async () => {
    const { wikiAssets: _absent, ...previousCapabilities } = CURRENT_CAPABILITIES
    const negotiated = negotiate(metadata('6.1.0', previousCapabilities))
    const invoke = vi.fn(() => 'streamed')

    expect(await invokeNegotiatedBackendRoute(negotiated, 'wikiAssets', invoke)).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_CAPABILITY' },
    })
    expect(invoke).not.toHaveBeenCalled()
    expect(await invokeNegotiatedBackendRoute(negotiated, 'reportAssets', invoke)).toEqual({
      ok: true,
      value: 'streamed',
    })
  })

  it('fails closed for an unknown capability name', () => {
    const guard = guardBackendRoute(negotiate(metadata('6.2.0')), 'arbitraryShell')
    expect(guard).toMatchObject({
      allowed: false,
      error: { code: 'UNSUPPORTED_CAPABILITY' },
    })
  })

  it('never invokes a route when release negotiation failed', async () => {
    const invoke = vi.fn()
    const result = await invokeNegotiatedBackendRoute(
      negotiate(metadata('6.0.0')),
      'projects',
      invoke,
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } })
    expect(invoke).not.toHaveBeenCalled()
  })
})
