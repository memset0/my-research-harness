'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { fetchHypotheses, type ProjectTarget, projectQueryKey, projectWebPath } from '../lib/api'
import { ListSkeleton } from './skeletons'
import { HypothesisStatusPill } from './status-pill'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{children}</div>
}

export function HypothesisView({ project }: { project: ProjectTarget }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['hypotheses', ...projectQueryKey(project)],
    queryFn: () => fetchHypotheses(project),
  })

  if (isLoading && !data)
    return (
      <div className="p-4 md:p-6">
        <ListSkeleton count={4} />
      </div>
    )
  if (error)
    return <div className="p-4 text-sm text-destructive">error: {(error as Error).message}</div>
  if (!data) return null

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      {data.entries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="hidden gap-3 border-b pb-2 text-[10px] uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-[3.5rem_8rem_1fr_minmax(10rem,1.4fr)]">
              <div>id</div>
              <div>status</div>
              <div>statement</div>
              <div>experiments</div>
            </div>
            <ul className="flex flex-col divide-y">
              {data.entries.map((h) => (
                <li
                  key={h.id}
                  className="grid grid-cols-1 gap-2 py-2 text-xs md:grid-cols-[3.5rem_8rem_1fr_minmax(10rem,1.4fr)] md:items-center md:gap-3"
                >
                  <Link
                    href={`#${h.id}`}
                    className="font-mono text-primary underline-offset-4 hover:underline"
                  >
                    {h.id}
                  </Link>
                  <HypothesisStatusPill status={h.status} />
                  <span className="truncate text-foreground/80" title={h.statement}>
                    {h.statement}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {h.experiments.length === 0 ? (
                      <span className="text-muted-foreground/60">—</span>
                    ) : (
                      h.experiments.map((id) => (
                        <Link
                          key={id}
                          href={projectWebPath(project, `/experiments/${encodeURIComponent(id)}`)}
                          className="truncate font-mono text-primary underline-offset-4 hover:underline"
                        >
                          {id}
                        </Link>
                      ))
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {data.entries.length === 0 && (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          no hypotheses (docs/hypotheses.md missing or empty)
        </div>
      )}

      {data.entries.map((h) => (
        <Card key={h.id} id={h.id}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-semibold">{h.id}</span>
              <CardTitle className="text-base font-medium text-foreground/80">{h.slug}</CardTitle>
              <HypothesisStatusPill status={h.status} />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-xs">
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
                      href={projectWebPath(project, `/experiments/${encodeURIComponent(id)}`)}
                      className="font-mono text-primary underline-offset-4 hover:underline"
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
              <div className="text-xs text-muted-foreground">last verified: {h.lastVerified}</div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
