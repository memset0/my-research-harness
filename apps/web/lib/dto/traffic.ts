// Response DTOs: Traffic control network measurements (`/api/traffic/**`).
// Shared by the route handlers that build these bodies and the client
// fetchers. Types and pure helpers only — no server imports.

export type TrafficTransportDto = 'native' | 'ssh-tunnel' | 'file-agent' | 'sshfs'
export type TrafficKindDto = 'service' | 'websocket' | 'asset'

export const TRAFFIC_WINDOWS_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000] as const
export const DEFAULT_TRAFFIC_WINDOW_MS = 15 * 60_000
/** Largest browser-check payload `/api/traffic/payload` serves. */
export const TRAFFIC_PAYLOAD_MAX_BYTES = 16 * 1024 * 1024

export interface TrafficRecordDto {
  seq: number
  at: string
  host: string
  project: string
  transport: TrafficTransportDto
  kind: TrafficKindDto
  document: string
  method: string
  path: string
  status: number | null
  bytes: number
  bytesUp: number
  resolveMs: number | null
  ttfbMs: number | null
  upstreamTtfbMs: number | null
  totalMs: number
  sessionMs: number | null
  reused: boolean | null
  outcome: 'ok' | 'error' | 'aborted'
  throughputBps: number | null
}

export interface TrafficAggregateDto {
  host: string
  project: string
  transport: TrafficTransportDto
  kind: TrafficKindDto
  count: number
  errors: number
  slow: number
  bytes: number
  ttfbMeanMs: number | null
  ttfbP95Ms: number | null
  totalMeanMs: number | null
  totalP95Ms: number | null
  throughputBps: number | null
  lastDocument: string
  lastSeen: string
}

export interface ProbeStepDto {
  label: string
  ok: boolean
  setupMs?: number | null
  medianMs?: number | null
  minMs?: number | null
  maxMs?: number | null
  samples?: number
  ttfbMs?: number | null
  bytes?: number
  throughputBps?: number | null
  status?: number | null
  note?: string
}

export interface ProbeResultDto {
  id: string
  at: string
  host: string
  project: string
  transport: TrafficTransportDto | 'unsupported'
  durationMs: number
  target?: string
  steps: ProbeStepDto[]
}

export interface TrafficProjectDto {
  host: string
  project: string
  transport: TrafficTransportDto
  probe: 'agent' | 'ssh' | 'native' | 'none'
  reason?: string
}

export interface TrafficSnapshotDto {
  windowMs: number
  generatedAt: string
  slowMs: number
  aggregates: TrafficAggregateDto[]
  recent: TrafficRecordDto[]
  slowest: TrafficRecordDto[]
  projects: TrafficProjectDto[]
  probes: ProbeResultDto[]
}

export interface ProbeRequestDto {
  host: string
  project: string
  document?: { kind: 'wiki' | 'report'; id: string }
  path?: string
}

export function formatBytesPerSecond(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '—'
  if (bps < 1024) return `${bps} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KiB/s`
  return `${(bps / (1024 * 1024)).toFixed(1)} MiB/s`
}

export function formatTrafficMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1) return '<1 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

export function formatTrafficBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}
