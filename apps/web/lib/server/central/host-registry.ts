import {
  BACKEND_API_MAJOR,
  type BackendMetadata,
  BackendMetadataSchema,
  type BackendProjectSummary,
  BackendProjectsResponseSchema,
  type CentralConfig,
  evaluateReleaseCompatibility,
  type HostAvailability,
  HostAvailabilitySchema,
  type HostAvailabilityState,
  HostIdSchema,
  isUsableHostAvailabilityState,
  MEMON_RELEASE,
  ProjectRefSchema,
} from '@memon/core'
import { redactOperationalText } from './public-safety'

export type HostFailureState = Exclude<
  HostAvailabilityState,
  | 'online'
  | 'update_available'
  | 'upgrade_required'
  | 'central_update_required'
  | 'filesystem_migration_required'
>

export class HostRoutingError extends Error {
  constructor(
    public readonly host: string,
    public readonly state: HostAvailabilityState | 'unknown_host',
  ) {
    super(
      state === 'unknown_host'
        ? `Host ${JSON.stringify(host)} is not configured`
        : `Host ${JSON.stringify(host)} is not usable (${state})`,
    )
    this.name = 'HostRoutingError'
  }
}

interface HostRecord {
  config: CentralConfig['hosts'][number]
  availability: HostAvailability
  liveProjects: BackendProjectSummary[]
}

export interface HostRegistryOptions {
  centralRelease?: string
  now?: () => Date
}

/**
 * In-memory source of truth for configured Host identity and live routing
 * state. It deliberately stores no last-known Project payload: any transition
 * out of a usable state clears the Host's discovered Project references.
 */
export class CentralHostRegistry {
  private readonly records = new Map<string, HostRecord>()
  private readonly centralRelease: string
  private readonly now: () => Date

  constructor(config: CentralConfig, options: HostRegistryOptions = {}) {
    this.centralRelease = options.centralRelease ?? MEMON_RELEASE
    this.now = options.now ?? (() => new Date())
    for (const host of config.hosts) {
      const id = HostIdSchema.parse(host.id)
      this.records.set(id, {
        config: host,
        availability: HostAvailabilitySchema.parse({
          host: id,
          state: 'connecting',
          diagnostic: null,
          lastSuccessfulCheckAt: null,
          centralRelease: this.centralRelease,
          backendRelease: null,
          backendRevision: null,
          capabilities: null,
        }),
        liveProjects: [],
      })
    }
  }

  listAvailability(): HostAvailability[] {
    return [...this.records.values()].map((record) => structuredClone(record.availability))
  }

  getAvailability(hostInput: unknown): HostAvailability | null {
    const parsed = HostIdSchema.safeParse(hostInput)
    if (!parsed.success) return null
    const record = this.records.get(parsed.data)
    return record ? structuredClone(record.availability) : null
  }

  /** Internal route lookup; the returned config includes the protected token. */
  requireUsableHost(hostInput: unknown): CentralConfig['hosts'][number] {
    const parsed = HostIdSchema.safeParse(hostInput)
    if (!parsed.success) throw new HostRoutingError(String(hostInput), 'unknown_host')
    const record = this.records.get(parsed.data)
    if (!record) throw new HostRoutingError(parsed.data, 'unknown_host')
    if (!isUsableHostAvailabilityState(record.availability.state)) {
      throw new HostRoutingError(parsed.data, record.availability.state)
    }
    return record.config
  }

  acceptMetadata(hostInput: unknown, metadataInput: unknown): HostAvailability {
    const record = this.requireConfiguredRecord(hostInput)
    const parsed = BackendMetadataSchema.safeParse(metadataInput)
    if (!parsed.success) {
      return this.setFailure(record, 'misconfigured', 'Backend metadata is invalid')
    }
    const metadata = parsed.data
    if (metadata.host !== record.config.id) {
      return this.setFailure(record, 'identity_mismatch', 'Backend Host identity does not match')
    }
    if (!metadata.ready) {
      return this.setFailure(record, 'offline', 'Backend is not ready', metadata)
    }

    const compatibility = evaluateReleaseCompatibility({
      centralRelease: this.centralRelease,
      centralApiMajor: BACKEND_API_MAJOR,
      backendRelease: metadata.release,
      backendApiMajor: metadata.apiMajor,
    })
    const state: HostAvailabilityState = compatibility
    const availability = HostAvailabilitySchema.parse({
      host: record.config.id,
      state,
      diagnostic: diagnosticForCompatibility(state),
      lastSuccessfulCheckAt: isUsableHostAvailabilityState(state)
        ? this.now().toISOString()
        : record.availability.lastSuccessfulCheckAt,
      centralRelease: this.centralRelease,
      backendRelease: metadata.release,
      backendRevision: metadata.revision,
      capabilities: metadata.capabilities,
    })
    record.availability = availability
    if (!isUsableHostAvailabilityState(state)) record.liveProjects = []
    return structuredClone(availability)
  }

  markFailure(hostInput: unknown, state: HostFailureState, diagnostic: string): HostAvailability {
    const record = this.requireConfiguredRecord(hostInput)
    return this.setFailure(record, state, diagnostic)
  }

  setLiveProjectSummaries(
    hostInput: unknown,
    projectSummaries: readonly unknown[],
  ): BackendProjectSummary[] {
    const record = this.requireConfiguredRecord(hostInput)
    if (!isUsableHostAvailabilityState(record.availability.state)) {
      throw new HostRoutingError(record.config.id, record.availability.state)
    }
    const parsed = BackendProjectsResponseSchema.parse({ projects: projectSummaries })
    for (const project of parsed.projects) {
      if (project.host !== record.config.id) {
        throw new Error('Backend Project Host identity does not match configured Host')
      }
    }
    record.liveProjects = parsed.projects.map((project) => ({ ...project }))
    return record.liveProjects.map((project) => ({ ...project }))
  }

  /** Compatibility adapter for callers that have only local Project names. */
  setLiveProjects(hostInput: unknown, projectNames: readonly unknown[]): BackendProjectSummary[] {
    const record = this.requireConfiguredRecord(hostInput)
    const seen = new Set<string>()
    const projects = projectNames.map((project) => {
      const ref = ProjectRefSchema.parse({ host: record.config.id, project })
      if (seen.has(ref.project)) {
        throw new Error(`Backend returned duplicate Project ${JSON.stringify(ref.project)}`)
      }
      seen.add(ref.project)
      return ref
    })
    return this.setLiveProjectSummaries(record.config.id, projects)
  }

  clearLiveProjects(hostInput: unknown): void {
    this.requireConfiguredRecord(hostInput).liveProjects = []
  }

  listLiveProjects(): BackendProjectSummary[] {
    return [...this.records.values()].flatMap((record) =>
      record.liveProjects.map((project) => ({ ...project })),
    )
  }

  private requireConfiguredRecord(hostInput: unknown): HostRecord {
    const parsed = HostIdSchema.safeParse(hostInput)
    if (!parsed.success) throw new HostRoutingError(String(hostInput), 'unknown_host')
    const record = this.records.get(parsed.data)
    if (!record) throw new HostRoutingError(parsed.data, 'unknown_host')
    return record
  }

  private setFailure(
    record: HostRecord,
    state: HostFailureState,
    diagnostic: string,
    metadata?: BackendMetadata,
  ): HostAvailability {
    const availability = HostAvailabilitySchema.parse({
      host: record.config.id,
      state,
      diagnostic: safeDiagnostic(diagnostic, [
        record.config.tokens.current,
        ...(record.config.tokens.next ? [record.config.tokens.next] : []),
        ...(record.config.transport.kind === 'ssh'
          ? [
              record.config.transport.target,
              record.config.transport.knownHostsFile,
              ...(record.config.transport.identityFile
                ? [record.config.transport.identityFile]
                : []),
            ]
          : [record.config.transport.baseUrl]),
      ]),
      lastSuccessfulCheckAt: record.availability.lastSuccessfulCheckAt,
      centralRelease: this.centralRelease,
      backendRelease: metadata?.release ?? record.availability.backendRelease,
      backendRevision: metadata?.revision ?? record.availability.backendRevision,
      capabilities: metadata?.capabilities ?? record.availability.capabilities,
    })
    record.availability = availability
    record.liveProjects = []
    return structuredClone(availability)
  }
}

function safeDiagnostic(value: string, secrets: readonly string[] = []): string {
  return redactOperationalText(value, secrets, 512)
}

function diagnosticForCompatibility(state: HostAvailabilityState): string | null {
  switch (state) {
    case 'online':
      return null
    case 'update_available':
      return 'Backend update is available'
    case 'upgrade_required':
      return 'Backend upgrade is required'
    case 'central_update_required':
      return 'Central update is required'
    case 'filesystem_migration_required':
      return 'Filesystem migration is required'
    default:
      return 'Backend release metadata is incompatible'
  }
}
