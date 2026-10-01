// Backend handler options and their validated, resolved form.

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  type BackendCapabilities,
  BackendCapabilitiesSchema,
  type BackendServiceTokens,
  HostIdSchema,
  InstanceEpochSchema,
  MEMON_RELEASE,
  MEMON_REVISION,
  ReleaseVersionSchema,
  RevisionSchema,
} from '@memon/core'
import type { BackendDocumentService } from '../document-service.js'
import { BackendEventStream } from '../event-stream.js'
import type { BackendFilesystemMonitorControl } from '../filesystem-monitor.js'
import type { BackendGitService } from '../git-service.js'
import type { BackendMutationService } from '../mutation-service.js'
import type { BackendProjectReadService } from '../project-service.js'
import type { BackendSlurmService } from '../slurm-service.js'
import type { BackendStreamService } from '../stream-service.js'

const MIN_SERVICE_TOKEN_CHARS = 32
const SERVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/

const DEFAULT_BACKEND_STREAM_CONTROL_DEADLINE_MS = 10_000

export type BackendServiceTokenSet = BackendServiceTokens

export type ReadinessProvider = () => boolean | Promise<boolean>
export interface ProjectDiscoveryItem {
  name: string
  label?: string
  description?: string
}
export type ProjectDiscoveryProvider = () =>
  | readonly ProjectDiscoveryItem[]
  | Promise<readonly ProjectDiscoveryItem[]>
export type BackendShareValidator = (project: string, token: string) => boolean | Promise<boolean>
export interface BackendShareProviders {
  list: (project: string, includeTokens: boolean) => unknown | Promise<unknown>
  add: (project: string, input: { label?: string; expires?: string }) => unknown | Promise<unknown>
  revoke: (project: string, id: string) => unknown | Promise<unknown>
}

export interface BackendServerOptions {
  hostId: string
  serviceTokens: BackendServiceTokenSet
  capabilities: BackendCapabilities
  readOnly?: boolean
  release?: string
  revision?: string
  instanceEpoch?: string
  readiness?: boolean | ReadinessProvider
  eventStream?: BackendEventStream
  projectDiscovery?: ProjectDiscoveryProvider
  shareValidator?: BackendShareValidator
  shareProviders?: Partial<BackendShareProviders>
  projectService?: BackendProjectReadService
  documentService?: BackendDocumentService
  gitService?: BackendGitService
  slurmService?: BackendSlurmService | null
  mutationService?: BackendMutationService
  streamService?: BackendStreamService
  streamControlDeadlineMs?: number
  filesystemMonitor?: BackendFilesystemMonitorControl
}

export type BackendHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>

export interface ResolvedBackendOptions {
  host: ReturnType<typeof HostIdSchema.parse>
  serviceTokens: Readonly<BackendServiceTokenSet>
  capabilities: BackendCapabilities
  readOnly: boolean
  release: ReturnType<typeof ReleaseVersionSchema.parse>
  revision: ReturnType<typeof RevisionSchema.parse>
  instanceEpoch: ReturnType<typeof InstanceEpochSchema.parse>
  readiness: ReadinessProvider
  eventStream: BackendEventStream
  projectDiscovery: ProjectDiscoveryProvider
  shareValidator: BackendShareValidator
  shareProviders: BackendShareProviders
  projectService?: BackendProjectReadService
  documentService?: BackendDocumentService
  gitService?: BackendGitService
  slurmService: BackendSlurmService | null
  mutationService?: BackendMutationService
  streamService?: BackendStreamService
  streamControlDeadlineMs: number
  filesystemMonitor?: BackendFilesystemMonitorControl
}

function validateServiceToken(token: string, label: string): string {
  if (token.length < MIN_SERVICE_TOKEN_CHARS || !SERVICE_TOKEN_PATTERN.test(token)) {
    throw new Error(`${label} must contain at least 32 base64url characters`)
  }
  return token
}

export function resolveOptions(options: BackendServerOptions): ResolvedBackendOptions {
  const current = validateServiceToken(options.serviceTokens.current, 'serviceTokens.current')
  const next = options.serviceTokens.next
    ? validateServiceToken(options.serviceTokens.next, 'serviceTokens.next')
    : undefined
  if (next === current) {
    throw new Error('serviceTokens.next must differ from serviceTokens.current')
  }

  const readinessOption = options.readiness
  const readiness =
    typeof readinessOption === 'function' ? readinessOption : async () => readinessOption ?? true
  const instanceEpoch = InstanceEpochSchema.parse(options.instanceEpoch ?? randomUUID())
  const eventStream = options.eventStream ?? new BackendEventStream({ instanceEpoch })
  if (eventStream.instanceEpoch !== instanceEpoch) {
    throw new Error('eventStream instance epoch must match Backend metadata instance epoch')
  }
  const streamControlDeadlineMs =
    options.streamControlDeadlineMs ?? DEFAULT_BACKEND_STREAM_CONTROL_DEADLINE_MS
  if (
    !Number.isSafeInteger(streamControlDeadlineMs) ||
    streamControlDeadlineMs < 10 ||
    streamControlDeadlineMs > 60_000
  ) {
    throw new Error('streamControlDeadlineMs must be an integer between 10 and 60000')
  }

  return {
    host: HostIdSchema.parse(options.hostId),
    serviceTokens: Object.freeze({ current, ...(next ? { next } : {}) }),
    capabilities: BackendCapabilitiesSchema.parse(
      options.readOnly
        ? {
            ...options.capabilities,
            mutations: false,
            slurm: false,
          }
        : options.capabilities,
    ),
    readOnly: options.readOnly ?? false,
    release: ReleaseVersionSchema.parse(options.release ?? MEMON_RELEASE),
    revision: RevisionSchema.parse(options.revision ?? MEMON_REVISION),
    instanceEpoch,
    readiness,
    eventStream,
    projectDiscovery: options.projectDiscovery ?? (() => []),
    shareValidator: options.shareValidator ?? (() => false),
    shareProviders: {
      list: options.shareProviders?.list ?? (() => []),
      add:
        options.shareProviders?.add ??
        (() => {
          throw new Error('share add provider is unavailable')
        }),
      revoke:
        options.shareProviders?.revoke ??
        (() => {
          throw new Error('share revoke provider is unavailable')
        }),
    },
    projectService: options.projectService,
    documentService: options.documentService,
    gitService: options.gitService,
    slurmService: options.slurmService ?? null,
    mutationService: options.mutationService,
    streamService: options.streamService,
    streamControlDeadlineMs,
    filesystemMonitor: options.filesystemMonitor,
  }
}
