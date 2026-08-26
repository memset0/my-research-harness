import {
  BACKEND_API_MAJOR,
  HostIdSchema,
  ReleaseVersionSchema,
  RevisionSchema,
} from './backend-protocol.js'
import {
  evaluateReleaseCompatibility,
  type ReleaseCompatibilityState,
} from './release-compatibility.js'

export interface FleetBackendRelease {
  host: unknown
  release: unknown
  revision: unknown
}

export interface MinorRolloutInput {
  currentCentralRelease: unknown
  targetRelease: unknown
  targetRevision: unknown
  backends: readonly FleetBackendRelease[]
}

export interface RolloutStep {
  order: number
  target: 'central' | 'backend'
  host?: string
  release: string
  revision: string
}

export interface MinorRolloutPlan {
  release: string
  revision: string
  steps: RolloutStep[]
}

export interface CentralRollbackInput {
  targetCentralRelease: unknown
  targetCentralRevision: unknown
  backends: readonly FleetBackendRelease[]
}

export interface CentralRollbackPreflight {
  allowed: boolean
  targetCentralRelease: string
  targetCentralRevision: string
  backendRollbacksRequired: Array<{
    host: string
    backendRelease: string
    compatibility: ReleaseCompatibilityState
  }>
}

interface ParsedRelease {
  text: string
  major: number
  minor: number
  patch: number
}

function parseRelease(input: unknown, label: string): ParsedRelease {
  const parsed = ReleaseVersionSchema.safeParse(input)
  if (!parsed.success) throw new Error(`${label} is not a canonical release`)
  const [major, minor, patch] = parsed.data.split('.').map(Number)
  return { text: parsed.data, major: major!, minor: minor!, patch: patch! }
}

function parseBackend(input: FleetBackendRelease): {
  host: string
  release: string
  revision: string
} {
  return {
    host: HostIdSchema.parse(input.host),
    release: ReleaseVersionSchema.parse(input.release),
    revision: RevisionSchema.parse(input.revision),
  }
}

function parseUniqueBackends(inputs: readonly FleetBackendRelease[]) {
  const parsed = inputs.map(parseBackend)
  const seen = new Set<string>()
  for (const backend of parsed) {
    if (seen.has(backend.host)) throw new Error(`duplicate rollout Host ${backend.host}`)
    seen.add(backend.host)
  }
  return parsed
}

/** Build a central-first, exact-revision normal Minor rollout. */
export function planMinorRollout(input: MinorRolloutInput): MinorRolloutPlan {
  const current = parseRelease(input.currentCentralRelease, 'currentCentralRelease')
  const target = parseRelease(input.targetRelease, 'targetRelease')
  const revision = RevisionSchema.parse(input.targetRevision)
  const backends = parseUniqueBackends(input.backends)

  if (target.major !== current.major || target.minor !== current.minor + 1 || target.patch !== 0) {
    throw new Error('normal Backend rollout must advance exactly one Minor and reset Patch')
  }
  for (const backend of backends) {
    const release = parseRelease(backend.release, `Backend ${backend.host} release`)
    if (
      release.major !== current.major ||
      release.minor < current.minor - 1 ||
      release.minor > current.minor
    ) {
      throw new Error(`Backend ${backend.host} is outside the pre-rollout compatibility window`)
    }
  }

  const steps: RolloutStep[] = [
    { order: 1, target: 'central', release: target.text, revision },
    ...backends.map((backend, index) => ({
      order: index + 2,
      target: 'backend' as const,
      host: backend.host,
      release: target.text,
      revision,
    })),
  ]
  return { release: target.text, revision, steps }
}

/**
 * Refuse a central rollback that would strand an already-newer Backend. The
 * caller must roll listed Backends back and re-run this preflight first.
 */
export function preflightCentralRollback(input: CentralRollbackInput): CentralRollbackPreflight {
  const target = ReleaseVersionSchema.parse(input.targetCentralRelease)
  const revision = RevisionSchema.parse(input.targetCentralRevision)
  const backends = parseUniqueBackends(input.backends)
  const backendRollbacksRequired = backends.flatMap((backend) => {
    const compatibility = evaluateReleaseCompatibility({
      centralRelease: target,
      centralApiMajor: BACKEND_API_MAJOR,
      backendRelease: backend.release,
      backendApiMajor: BACKEND_API_MAJOR,
    })
    return compatibility === 'online' || compatibility === 'update_available'
      ? []
      : [{ host: backend.host, backendRelease: backend.release, compatibility }]
  })
  return {
    allowed: backendRollbacksRequired.length === 0,
    targetCentralRelease: target,
    targetCentralRevision: revision,
    backendRollbacksRequired,
  }
}
