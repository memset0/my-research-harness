'use client'

// Pinned card at the top of the project list page when at least one
// anomaly exists. Uses shadcn `Card` + `Button` primitives so it visually
// fits the rest of the dashboard. `Copy all` writes a plain-text report
// to the clipboard so the user can paste it into a Claude Code session
// for resolution.

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Copy, EyeOff } from 'lucide-react'
import { fetchAnomalies, type AnomalyRecord } from '../lib/api'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

const HIDE_KEY_PREFIX = 'memon:anomaly-banner-hidden:'

export function AnomalyBanner({ project }: { project: string }) {
  const { data } = useQuery({
    queryKey: ['anomalies', project],
    queryFn: () => fetchAnomalies(project),
  })
  const anomalies = data?.anomalies ?? []
  const hideKey = `${HIDE_KEY_PREFIX}${project}`

  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    setHidden(sessionStorage.getItem(hideKey) === '1')
  }, [hideKey])

  if (anomalies.length === 0 || hidden) return null

  return (
    <Card className="border-amber-400/70">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <AlertTriangle className="size-4 text-amber-600" aria-hidden />
          <span>
            {anomalies.length} issue{anomalies.length === 1 ? '' : 's'} need resolution
          </span>
        </CardTitle>
        <div className="flex gap-2">
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              sessionStorage.setItem(hideKey, '1')
              setHidden(true)
            }}
          >
            <EyeOff className="size-3" aria-hidden />
            Hide
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="max-h-[40vh] space-y-1 overflow-y-auto text-xs">
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
