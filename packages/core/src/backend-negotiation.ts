import { z } from 'zod'
import {
  type BackendCapabilities,
  BackendCapabilitiesSchema,
  type BackendError,
  BackendErrorSchema,
  type BackendMetadata,
  BackendMetadataSchema,
  HostIdSchema,
  InstanceEpochSchema,
  ReleaseVersionSchema,
  RevisionSchema,
} from './backend-protocol.js'
import {
  evaluateReleaseCompatibility,
  type ReleaseCompatibilityState,
} from './release-compatibility.js'

export const BACKEND_CAPABILITY_NAMES = [
  'projects',
  'mutations',
  'events',
  'logStreaming',
  'reportAssets',
  'wikiAssets',
  'git',
  'shares',
  'tmux',
  'terminal',
  'slurm',
  'herdr',
] as const satisfies readonly (keyof BackendCapabilities)[]

export const BackendCapabilityNameSchema = z.enum(BACKEND_CAPABILITY_NAMES)
export type BackendCapabilityName = z.infer<typeof BackendCapabilityNameSchema>

export const BACKEND_PROTOCOL_ADAPTERS = ['current-minor', 'previous-minor'] as const
export type BackendProtocolAdapter = (typeof BACKEND_PROTOCOL_ADAPTERS)[number]

const MetadataEnvelopeSchema = z
  .object({
    host: HostIdSchema,
    release: ReleaseVersionSchema,
    apiMajor: z.unknown(),
    revision: RevisionSchema,
    instanceEpoch: InstanceEpochSchema,
    ready: z.boolean(),
    capabilities: z.unknown(),
  })
  .strict()

const PreviousMinorCapabilitiesSchema = BackendCapabilitiesSchema.partial().strict()

const DISABLED_CAPABILITIES = Object.freeze({
  projects: false,
  mutations: false,
  events: false,
  logStreaming: false,
  reportAssets: false,
  wikiAssets: false,
  git: false,
  shares: false,
  tmux: false,
  terminal: false,
  slurm: false,
  herdr: false,
} satisfies BackendCapabilities)

export interface BackendNegotiationInput {
  centralRelease: unknown
  centralApiMajor: unknown
  metadata: unknown
}

export interface SuccessfulBackendNegotiation {
  ok: true
  state: 'online' | 'update_available'
  adapter: BackendProtocolAdapter
  metadata: BackendMetadata
}

export type BackendNegotiationFailureState =
  | Exclude<ReleaseCompatibilityState, 'online' | 'update_available'>
  | 'not_ready'

export interface FailedBackendNegotiation {
  ok: false
  state: BackendNegotiationFailureState
  error: BackendError
}

export type BackendNegotiation = SuccessfulBackendNegotiation | FailedBackendNegotiation

export interface AllowedBackendRoute {
  allowed: true
  capability: BackendCapabilityName
  adapter: BackendProtocolAdapter
  metadata: BackendMetadata
}

export interface DeniedBackendRoute {
  allowed: false
  error: BackendError
}

export type BackendRouteGuard = AllowedBackendRoute | DeniedBackendRoute

export type BackendRouteInvocation<T> = { ok: true; value: T } | { ok: false; error: BackendError }

function safeError(code: BackendError['code'], message: string, retryable = false): BackendError {
  return BackendErrorSchema.parse({ code, message, retryable })
}

function failed(state: BackendNegotiationFailureState, message: string): FailedBackendNegotiation {
  return {
    ok: false,
    state,
    error: safeError(
      state === 'misconfigured' ? 'BAD_REQUEST' : 'UNAVAILABLE',
      message,
      state === 'not_ready',
    ),
  }
}

function normalizePreviousMinorMetadata(
  envelope: z.infer<typeof MetadataEnvelopeSchema>,
): BackendMetadata | null {
  const parsedCapabilities = PreviousMinorCapabilitiesSchema.safeParse(envelope.capabilities)
  if (!parsedCapabilities.success) return null

  const capabilities = {
    ...DISABLED_CAPABILITIES,
    ...parsedCapabilities.data,
  }
  const metadata = BackendMetadataSchema.safeParse({ ...envelope, capabilities })
  return metadata.success ? metadata.data : null
}

/**
 * Negotiate exactly the current or immediately previous Backend Minor.
 *
 * Current-Minor metadata must satisfy the full current schema. The explicit
 * previous-Minor adapter accepts only known capability keys and normalizes a
 * capability absent from that older contract to `false`; it never guesses an
 * endpoint into existence.
 */
export function negotiateBackend(input: BackendNegotiationInput): BackendNegotiation {
  const envelope = MetadataEnvelopeSchema.safeParse(input.metadata)
  if (!envelope.success) {
    return failed('misconfigured', 'Backend metadata is malformed')
  }

  const compatibility = evaluateReleaseCompatibility({
    centralRelease: input.centralRelease,
    centralApiMajor: input.centralApiMajor,
    backendRelease: envelope.data.release,
    backendApiMajor: envelope.data.apiMajor,
  })
  if (compatibility !== 'online' && compatibility !== 'update_available') {
    return failed(compatibility, `Backend release is not negotiable: ${compatibility}`)
  }
  if (!envelope.data.ready) {
    return failed('not_ready', 'Backend is not ready')
  }

  if (compatibility === 'online') {
    const metadata = BackendMetadataSchema.safeParse(input.metadata)
    if (!metadata.success) {
      return failed('misconfigured', 'Current-Minor Backend metadata is malformed')
    }
    return { ok: true, state: 'online', adapter: 'current-minor', metadata: metadata.data }
  }

  const metadata = normalizePreviousMinorMetadata(envelope.data)
  if (!metadata) {
    return failed('misconfigured', 'Previous-Minor Backend metadata is malformed')
  }
  return {
    ok: true,
    state: 'update_available',
    adapter: 'previous-minor',
    metadata,
  }
}

/** Fail-closed route/capability gate shared by central route adapters. */
export function guardBackendRoute(
  negotiation: BackendNegotiation,
  capability: unknown,
): BackendRouteGuard {
  if (!negotiation.ok) return { allowed: false, error: negotiation.error }

  const parsedCapability = BackendCapabilityNameSchema.safeParse(capability)
  if (!parsedCapability.success) {
    return {
      allowed: false,
      error: safeError('UNSUPPORTED_CAPABILITY', 'Backend capability is not recognized'),
    }
  }
  if (!negotiation.metadata.capabilities[parsedCapability.data]) {
    return {
      allowed: false,
      error: safeError(
        'UNSUPPORTED_CAPABILITY',
        `Backend does not support capability ${parsedCapability.data}`,
      ),
    }
  }

  return {
    allowed: true,
    capability: parsedCapability.data,
    adapter: negotiation.adapter,
    metadata: negotiation.metadata,
  }
}

/**
 * Invoke a Backend route only after negotiation and capability gating. A
 * denied route never evaluates `invoke`, which prevents accidental calls to
 * endpoints absent from the previous Minor contract.
 */
export async function invokeNegotiatedBackendRoute<T>(
  negotiation: BackendNegotiation,
  capability: unknown,
  invoke: (route: AllowedBackendRoute) => T | Promise<T>,
): Promise<BackendRouteInvocation<T>> {
  const guard = guardBackendRoute(negotiation, capability)
  if (!guard.allowed) return { ok: false, error: guard.error }
  return { ok: true, value: await invoke(guard) }
}
