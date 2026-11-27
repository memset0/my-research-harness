// Builds the owner-only Traffic control snapshot from the in-memory tracker.

import 'server-only'
import { type Config, formatIsoLocal } from '@memon/core'
import type {
  ProbeResultDto,
  TrafficProjectDto,
  TrafficRecordDto,
  TrafficSnapshotDto,
} from '@/lib/dto/traffic'
import { probeSupportOf } from './probe'
import {
  type ProbeResult,
  SLOW_REQUEST_MS,
  type TrafficRecord,
  type TrafficTracker,
} from './tracker'

export const RECENT_LIMIT = 50
export const SLOWEST_LIMIT = 20

const iso = (ms: number) => formatIsoLocal(new Date(ms))

export function recordDto(record: TrafficRecord): TrafficRecordDto {
  const { startedAt, ...rest } = record
  return { at: iso(startedAt), ...rest }
}

export function probeDto(result: ProbeResult): ProbeResultDto {
  const { startedAt, ...rest } = result
  return { at: iso(startedAt), ...rest }
}

export function trafficProjects(config: Config): TrafficProjectDto[] {
  return config.projects.map((project) => {
    const support = probeSupportOf(project, config)
    return {
      host: project.host ?? '-',
      project: project.name,
      transport: support.transport,
      probe: support.probe,
      ...(support.probe === 'none' ? { reason: support.reason } : {}),
    }
  })
}

export function trafficSnapshot(
  tracker: TrafficTracker,
  config: Config,
  windowMs: number,
  now = Date.now(),
): TrafficSnapshotDto {
  return {
    windowMs,
    generatedAt: iso(now),
    slowMs: SLOW_REQUEST_MS,
    aggregates: tracker.aggregates(windowMs).map(({ lastSeenAt, ...rest }) => ({
      ...rest,
      lastSeen: iso(lastSeenAt),
    })),
    recent: tracker.records().slice(0, RECENT_LIMIT).map(recordDto),
    slowest: tracker.slowest(windowMs, SLOWEST_LIMIT).map(recordDto),
    projects: trafficProjects(config),
    probes: tracker.probeResults().map(probeDto),
  }
}
