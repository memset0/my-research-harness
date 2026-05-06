'use client'

// Pinned card at the top of the project list page when at least one
// anomaly exists. Uses shadcn `Card` + `Button` primitives so it visually
// fits the rest of the dashboard. `Copy all` writes a plain-text report
// to the clipboard so the user can paste it into a Claude Code session
// for resolution.

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Copy } from 'lucide-react'
import { fetchAnomalies, type AnomalyRecord } from '../lib/api'
import { Button } from './ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from './ui/card'

export function AnomalyBanner({ project }: { project: string }) {
  const { data } = useQuery({
    queryKey: ['anomalies', project],
    queryFn: () => fetchAnomalies(project),
  })
  const anomalies = data?.anomalies ?? []

  if (anomalies.length === 0) return null

  return (
    <Card className="border-amber-400/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <AlertTriangle className="size-4 text-amber-600" aria-hidden />
          <span>
            {anomalies.length} issue{anomalies.length === 1 ? '' : 's'} need resolution
          </span>
        </CardTitle>
        <CardAction>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const text = formatForCopy(project, anomalies)
              navigator.clipboard.writeText(text).catch(() => {
                /* clipboard blocked — silently no-op for now */
              })
            }}
          >
            <Copy className="size-3" aria-hidden />
            Copy all
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="max-h-[20vh] space-y-1 overflow-y-auto text-xs">
          {anomalies.map((a, i) => (
            <li key={i} className="font-mono">
              <span className="font-semibold">{a.code}</span>
              {a.runId ? <span className="text-muted-foreground"> · run={a.runId}</span> : null}
              {a.experimentId ? <span className="text-muted-foreground"> · exp={a.experimentId}</span> : null}
              <span className="text-muted-foreground"> — {a.message}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function formatForCopy(project: string, anomalies: AnomalyRecord[]): string {
  const lines = [`Anomalies from project ${project} at ${new Date().toISOString()}:`]
  for (const a of anomalies) {
    const ids = [
      a.experimentId ? `exp=${a.experimentId}` : null,
      a.runId ? `run=${a.runId}` : null,
    ]
      .filter(Boolean)
      .join(' ')
    lines.push(`- ${a.code}: ${ids} — ${a.message}`)
  }
  return lines.join('\n')
}
