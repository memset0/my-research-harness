'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { fetchJournal } from '../lib/api'
import { Badge } from './ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { SuccessBadge, WarningBadge } from './colored-badge'
import { AddJournalEntryButton } from './add-journal-entry-button'
import { TimestampLocal } from './timestamp'
import { ListSkeleton } from './skeletons'
import { Input } from './ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'

function TagBadge({ tag }: { tag: string }) {
  switch (tag) {
    case 'CREATE':
      return <SuccessBadge>{tag}</SuccessBadge>
    case 'REQUEST':
      return <WarningBadge>{tag}</WarningBadge>
    case 'ERROR':
      return <Badge variant="destructive">{tag}</Badge>
    case 'STATUS':
      return <Badge>{tag}</Badge>
    default:
      // NOTE / ARCHIVE / unknown
      return <Badge variant="outline">{tag}</Badge>
  }
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

  if (isLoading && !data)
    return (
      <div className="p-4 md:p-6">
        <ListSkeleton count={6} />
      </div>
    )
  if (error)
    return (
      <div className="p-4 text-sm text-destructive">error: {(error as Error).message}</div>
    )
  if (!data) return null

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>Journal</CardTitle>
            {data.lastDigestAt ? (
              <span className="text-xs text-muted-foreground">
                last digested at <TimestampLocal value={data.lastDigestAt} variant="long" />
              </span>
            ) : (
              <WarningBadge>no last_digest_at</WarningBadge>
            )}
            <div className="ml-auto">
              <AddJournalEntryButton project={project} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <Select value={tagFilter} onValueChange={setTagFilter}>
              <SelectTrigger className="h-8 w-[10rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all tags</SelectItem>
                {allTags.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="search"
              placeholder="filter by experiment id…"
              value={expFilter}
              onChange={(e) => setExpFilter(e.target.value)}
              className="h-8 flex-1 min-w-[12rem]"
            />
            <span className="text-muted-foreground">
              {filtered.length} / {events.length}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <ul className="flex flex-col divide-y">
            {filtered.length === 0 && (
              <li className="py-4 text-xs text-muted-foreground">no events</li>
            )}
            {filtered.map((e, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: stable order
                key={i}
                className="grid grid-cols-1 gap-2 py-2 md:grid-cols-[10rem_5rem_1fr]"
              >
                <TimestampLocal value={e.timestamp} variant="long" />
                <TagBadge tag={e.tag} />
                <div className="text-xs">
                  {e.experimentId ? (
                    <Link
                      href={`/p/${encodeURIComponent(project)}/experiments/${encodeURIComponent(e.experimentId)}`}
                      className="font-mono text-primary underline-offset-4 hover:underline"
                    >
                      {e.experimentId}
                    </Link>
                  ) : null}
                  {e.experimentId ? ' · ' : ''}
                  <span className="text-foreground/80">{e.body}</span>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
