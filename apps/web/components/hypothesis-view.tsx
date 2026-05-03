'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { fetchHypotheses } from '../lib/api'
import { Card, CardContent, CardHeader, CardTitle } from './ui'
import { Markdown } from './markdown'

// Inlined to avoid pulling Node-only @memon/core barrel into the client bundle.
const HYPOTHESIS_STATUS_EMOJI: Readonly<Record<string, string>> = {
  CONFIRMED: '✅',
  REFUTED: '❌',
  PARTIAL: '🟡',
  OPEN: '🔵',
  DEFERRED: '⚪',
}

export function HypothesisView({ project }: { project: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['hypotheses', project],
    queryFn: () => fetchHypotheses(project),
  })

  if (isLoading) return <div className="p-4 text-sm text-slate-500">loading…</div>
  if (error) return <div className="p-4 text-sm text-red-600">error: {(error as Error).message}</div>
  if (!data) return null

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      {data.summaryTableBlock && (
        <Card>
          <CardHeader>
            <CardTitle>Summary table</CardTitle>
          </CardHeader>
          <CardContent>
            <Markdown>{data.summaryTableBlock}</Markdown>
          </CardContent>
        </Card>
      )}

      {data.entries.length === 0 && (
        <div className="rounded-md border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
          no hypotheses (HYPOTHESES.md missing or empty)
        </div>
      )}

      {data.entries.map((h) => (
        <Card key={h.id} id={h.id}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-semibold">{h.id}</span>
              <span className="text-base" aria-hidden>
                {HYPOTHESIS_STATUS_EMOJI[h.status]}
              </span>
              <span className="text-sm font-semibold tracking-tight">{h.status}</span>
              <CardTitle className="text-base font-medium text-slate-700">{h.slug}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Statement</div>
              <div>{h.statement}</div>
            </div>
            {h.origin && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Origin</div>
                <div className="text-slate-700">{h.origin}</div>
              </div>
            )}
            {h.experiments.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Experiments</div>
                <div className="flex flex-wrap gap-2">
                  {h.experiments.map((id) => (
                    <Link
                      key={id}
                      href={`/p/${encodeURIComponent(project)}/experiments/${encodeURIComponent(id)}`}
                      className="font-mono text-xs text-blue-700 underline hover:no-underline"
                    >
                      {id}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {h.evidence.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Evidence</div>
                <ul className="ml-4 list-disc">
                  {h.evidence.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            {h.caveats.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Caveats</div>
                <ul className="ml-4 list-disc">
                  {h.caveats.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {h.lastVerified && (
              <div className="text-xs text-slate-500">last verified: {h.lastVerified}</div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
