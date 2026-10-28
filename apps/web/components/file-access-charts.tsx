'use client'

import { CartesianGrid, Line, LineChart, Scatter, ScatterChart, XAxis, YAxis } from 'recharts'
import type { FileOperationMetrics } from '../lib/file-access-api'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from './ui/chart'

// Distinct hues for up to six storage groups; more groups cycle.
const GROUP_COLORS = [
  'oklch(0.62 0.17 255)',
  'oklch(0.66 0.17 150)',
  'oklch(0.72 0.16 65)',
  'oklch(0.62 0.21 25)',
  'oklch(0.6 0.17 305)',
  'oklch(0.66 0.12 200)',
]

const clock = (atMs: number) =>
  new Date(atMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

const latency = (ms: number) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`

/** Storage groups named by the projects that read through them. */
function groupLabel(group: string, projects?: Record<string, string[]>): string {
  const names = projects?.[group]
  return names && names.length > 0 ? names.join(', ') : group
}

function useGroups(
  metrics: FileOperationMetrics,
  projects?: Record<string, string[]>,
): { keys: Map<string, string>; config: ChartConfig } {
  const groups = new Set<string>()
  for (const timeline of metrics.timeline ?? []) groups.add(timeline.storageGroup)
  for (const sample of metrics.recent ?? []) groups.add(sample.storageGroup)
  const keys = new Map<string, string>()
  const config: ChartConfig = {}
  ;[...groups].sort().forEach((group, index) => {
    const key = `g${index}`
    keys.set(group, key)
    config[key] = {
      label: groupLabel(group, projects),
      color: GROUP_COLORS[index % GROUP_COLORS.length],
    }
  })
  return { keys, config }
}

/** Source operations per project over the selected window, one line each. */
export function FileAccessRequestChart({
  metrics,
  projects,
}: {
  metrics: FileOperationMetrics
  projects?: Record<string, string[]>
}) {
  const { keys, config } = useGroups(metrics, projects)
  const timelines = metrics.timeline ?? []
  if (timelines.length === 0) return <ChartEmpty text="No source operations in this window." />
  const rows = timelines[0]!.points.map((point, index) => {
    const row: Record<string, number> = { atMs: point.atMs }
    for (const timeline of timelines)
      row[keys.get(timeline.storageGroup)!] = timeline.points[index]?.samples ?? 0
    return row
  })
  const seconds = Math.round((metrics.bucketMs ?? 5000) / 1000)
  return (
    <figure className="flex flex-col gap-1" data-file-access-chart="requests">
      <figcaption className="text-xs font-medium">
        Source operations per project{' '}
        <span className="text-muted-foreground">(per {seconds} s)</span>
      </figcaption>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <LineChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="atMs"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={clock}
            tickLine={false}
            axisLine={false}
            minTickGap={48}
          />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => clock(Number(payload?.[0]?.payload?.atMs))}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          {[...keys.values()].map((key) => (
            <Line
              key={key}
              dataKey={key}
              type="linear"
              stroke={`var(--color-${key})`}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </figure>
  )
}

/** Execution time of the most recent source operations, one dot each. */
export function FileAccessLatencyChart({
  metrics,
  projects,
}: {
  metrics: FileOperationMetrics
  projects?: Record<string, string[]>
}) {
  const { keys, config } = useGroups(metrics, projects)
  const recent = metrics.recent ?? []
  if (recent.length === 0) return <ChartEmpty text="No source operations recorded yet." />
  const byKey = new Map<string, Array<{ atMs: number; ms: number; label: string }>>()
  for (const sample of recent) {
    const key = keys.get(sample.storageGroup)!
    const points = byKey.get(key) ?? []
    points.push({
      atMs: sample.atMs,
      // Log scale: keep sub-millisecond operations on the chart.
      ms: Math.max(sample.executionMs, 0.1),
      label: `${sample.operation}${sample.error ? ' · error' : ''}`,
    })
    byKey.set(key, points)
  }
  return (
    <figure className="flex flex-col gap-1" data-file-access-chart="latency">
      <figcaption className="text-xs font-medium">
        Latency of the last {recent.length} source operations{' '}
        <span className="text-muted-foreground">(execution time, log scale)</span>
      </figcaption>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <ScatterChart margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="atMs"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={clock}
            tickLine={false}
            axisLine={false}
            minTickGap={48}
          />
          <YAxis
            dataKey="ms"
            type="number"
            scale="log"
            domain={['auto', 'auto']}
            tickFormatter={latency}
            tickLine={false}
            axisLine={false}
            width={60}
          />
          <ChartTooltip
            cursor={false}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as
                | { atMs: number; ms: number; label: string }
                | undefined
              if (!active || !point) return null
              return (
                <div className="rounded-md border bg-background px-2 py-1 text-xs shadow-sm">
                  <div className="font-medium">{latency(point.ms)}</div>
                  <div className="text-muted-foreground">
                    {point.label} · {clock(point.atMs)}
                  </div>
                </div>
              )
            }}
          />
          <ChartLegend content={<ChartLegendContent />} />
          {[...byKey.entries()].map(([key, points]) => (
            <Scatter
              key={key}
              name={key}
              dataKey={key}
              data={points}
              fill={`var(--color-${key})`}
              isAnimationActive={false}
            />
          ))}
        </ScatterChart>
      </ChartContainer>
    </figure>
  )
}

function ChartEmpty({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground">{text}</p>
}
