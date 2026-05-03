'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { fetchHypotheses } from '../lib/api'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Markdown } from './markdown'
import { ListSkeleton } from './skeletons'

// Inlined to avoid pulling Node-only @memon/core barrel into the client bundle.
const HYPOTHESIS_STATUS_EMOJI: Readonly<Record<string, string>> = {
  CONFIRMED: '✅',
  REFUTED: '❌',
  PARTIAL: '🟡',
  OPEN: '🔵',
  DEFERRED: '⚪',
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{children}</div>
  )
}

export function HypothesisView({ project }: { project: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['hypotheses', project],
    queryFn: () => fetchHypotheses(project),
  })

  if (isLoading && !data)
    return (
      <div className="p-4 md:p-6">
        <ListSkeleton count={4} />
      </div>
    )
  if (error)
    return (
      <div className="p-4 text-sm text-destructive">error: {(error as Error).message}</div>
    )
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
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
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
              <CardTitle className="text-base font-medium text-foreground/80">{h.slug}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div>
              <FieldLabel>Statement</FieldLabel>
              <div>{h.statement}</div>
            </div>
            {h.origin && (
              <div>
                <FieldLabel>Origin</FieldLabel>
                <div className="text-foreground/80">{h.origin}</div>
              </div>
            )}
            {h.experiments.length > 0 && (
              <div>
                <FieldLabel>Experiments</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {h.experiments.map((id) => (
                    <Link
                      key={id}
                      href={`/p/${encodeURIComponent(project)}/experiments/${encodeURIComponent(id)}`}
                      className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                    >
                      {id}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {h.evidence.length > 0 && (
              <div>
                <FieldLabel>Evidence</FieldLabel>
                <ul className="ml-4 list-disc">
                  {h.evidence.map((e, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable order
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            {h.caveats.length > 0 && (
              <div>
                <FieldLabel>Caveats</FieldLabel>
                <ul className="ml-4 list-disc">
                  {h.caveats.map((c, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable order
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {h.lastVerified && (
              <div className="text-xs text-muted-foreground">
                last verified: {h.lastVerified}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
