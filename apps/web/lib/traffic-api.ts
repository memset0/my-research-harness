// Client for the owner-only Traffic control network surface (`/api/traffic/**`)
// and the browser→central check, measured here in the browser.

import type { ProbeRequestDto, ProbeResultDto, TrafficSnapshotDto } from './dto/traffic'

async function errorText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    return body.error?.message ?? `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

export async function fetchTrafficSnapshot(windowMs: number): Promise<TrafficSnapshotDto> {
  const response = await fetch(`/api/traffic?windowMs=${windowMs}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(await errorText(response))
  return (await response.json()) as TrafficSnapshotDto
}

export async function runTrafficProbe(input: ProbeRequestDto): Promise<ProbeResultDto> {
  const response = await fetch('/api/traffic/probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(await errorText(response))
  return (await response.json()) as ProbeResultDto
}

export interface BrowserCheckResult {
  at: string
  latencyMedianMs: number
  latencyMinMs: number
  latencyMaxMs: number
  samples: number
  downloadBytes: number
  /** Request sent → first body byte of the download. */
  downloadTtfbMs: number
  downloadMs: number
  throughputBps: number | null
}

export const BROWSER_CHECK_PINGS = 5
export const BROWSER_CHECK_BYTES = 4 * 1024 * 1024

function payloadUrl(bytes: number): string {
  // A unique query defeats any cache between the browser and central.
  return `/api/traffic/payload?bytes=${bytes}&n=${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Browser→central latency (empty requests) and throughput (one bounded download). */
export async function runBrowserCheck(
  bytes: number = BROWSER_CHECK_BYTES,
): Promise<BrowserCheckResult> {
  const pings: number[] = []
  for (let i = 0; i < BROWSER_CHECK_PINGS; i++) {
    const t0 = performance.now()
    const response = await fetch(payloadUrl(0), { cache: 'no-store' })
    await response.arrayBuffer()
    if (!response.ok) throw new Error(await errorText(response))
    pings.push(performance.now() - t0)
  }
  const t0 = performance.now()
  const response = await fetch(payloadUrl(bytes), { cache: 'no-store' })
  if (!response.ok || !response.body) throw new Error(await errorText(response))
  const reader = response.body.getReader()
  let received = 0
  let first: number | null = null
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (first === null) first = performance.now()
    received += value.byteLength
  }
  const end = performance.now()
  const sorted = [...pings].sort((a, b) => a - b)
  const transfer = first === null ? null : Math.max(end - first, 1)
  return {
    at: new Date().toLocaleTimeString(),
    latencyMedianMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
    latencyMinMs: sorted[0] ?? 0,
    latencyMaxMs: sorted.at(-1) ?? 0,
    samples: pings.length,
    downloadBytes: received,
    downloadTtfbMs: (first ?? end) - t0,
    downloadMs: end - t0,
    throughputBps: transfer && received > 0 ? Math.round((received * 1000) / transfer) : null,
  }
}
