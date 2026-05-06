'use client'

// Yellow card pinned at the top of the project list page when at least one
// anomaly exists. `Copy all` writes a plain-text report to the clipboard so
// the user can paste it into a Claude Code session for resolution.

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAnomalies, type AnomalyRecord } from '../lib/api'
import { cn } from '../lib/utils'

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
    <div className={cn('rounded-md border-2 border-yellow-400 bg-yellow-50 p-3')}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-sm">⚠ {anomalies.length} issue{anomalies.length === 1 ? '' : 's'} need resolution</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              const text = formatForCopy(project, anomalies)
              navigator.clipboard
                .writeText(text)
                .catch(() => {
                  /* clipboard blocked — silently no-op for now */
                })
            }}
            className="rounded border border-yellow-600 bg-yellow-100 px-2 py-0.5 text-xs hover:bg-yellow-200"
          >
            Copy all
          </button>
          <button
            type="button"
            onClick={() => {
              sessionStorage.setItem(hideKey, '1')
              setHidden(true)
            }}
            className="rounded border border-yellow-600 bg-yellow-100 px-2 py-0.5 text-xs hover:bg-yellow-200"
          >
            Hide
          </button>
        </div>
      </div>
      <ul className="mt-2 max-h-[40vh] space-y-1 overflow-y-auto text-xs">
        {anomalies.map((a, i) => (
          <li key={i} className="font-mono">
            <span className="font-semibold">{a.code}</span>: {a.message}
          </li>
        ))}
      </ul>
    </div>
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
