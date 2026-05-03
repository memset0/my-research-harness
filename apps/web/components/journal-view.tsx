'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { fetchJournal } from '../lib/api'
import { Badge, Card, CardContent, CardHeader, CardTitle } from './ui'
import { TimestampLocal } from './timestamp'

const TAG_COLORS: Record<string, 'default' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  CREATE: 'success',
  STATUS: 'default',
  NOTE: 'outline',
  REQUEST: 'warning',
  ARCHIVE: 'outline',
  ERROR: 'destructive',
}

export function JournalView({ project }: { project: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['journal', project],
    queryFn: () => fetchJournal(project, { limit: 200 }),
  })

  const [tagFilter, setTagFilter] = useState<string>('all')
  const [expFilter, setExpFilter] = useState<string>('')

  const events = data?.events ?? []
  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (tagFilter !== 'all' && e.tag !== tagFilter) return false
      if (expFilter && (!e.experimentId || !e.experimentId.includes(expFilter))) return false
      return true
    })
  }, [events, tagFilter, expFilter])

  const allTags = useMemo(() => Array.from(new Set(events.map((e) => e.tag))).sort(), [events])

  if (isLoading) return <div className="p-4 text-sm text-slate-500">loading…</div>
  if (error) return <div className="p-4 text-sm text-red-600">error: {(error as Error).message}</div>
  if (!data) return null

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>Journal</CardTitle>
            {data.lastDigestAt ? (
              <span className="text-xs text-slate-500">
                last digested at <TimestampLocal value={data.lastDigestAt} variant="long" />
              </span>
            ) : (
              <Badge variant="warning">no last_digest_at</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} className="h-8 rounded border border-slate-300 bg-white px-2">
              <option value="all">all tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              type="search"
              placeholder="filter by experiment id…"
              value={expFilter}
              onChange={(e) => setExpFilter(e.target.value)}
              className="h-8 flex-1 min-w-[12rem] rounded border border-slate-300 bg-white px-2"
            />
            <span className="text-slate-500">
              {filtered.length} / {events.length}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <ul className="flex flex-col divide-y divide-slate-100">
            {filtered.length === 0 && <li className="py-4 text-sm text-slate-500">no events</li>}
            {filtered.map((e, i) => (
              <li key={i} className="grid grid-cols-1 gap-2 py-2 md:grid-cols-[10rem_5rem_1fr]">
                <TimestampLocal value={e.timestamp} variant="long" />
                <Badge variant={TAG_COLORS[e.tag] ?? 'outline'}>{e.tag}</Badge>
                <div className="text-sm">
                  {e.experimentId ? (
                    <Link
                      href={`/p/${encodeURIComponent(project)}/experiments/${encodeURIComponent(e.experimentId)}`}
                      className="font-mono text-blue-700 underline hover:no-underline"
                    >
                      {e.experimentId}
                    </Link>
                  ) : null}
                  {e.experimentId ? ' · ' : ''}
                  <span className="text-slate-700">{e.body}</span>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
