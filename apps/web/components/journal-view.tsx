'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  fetchJournal,
  fetchJournalHistory,
  type JournalInvocationRecordView,
  type ProjectTarget,
  projectQueryKey,
  projectWebPath,
} from '../lib/api'
import { SuccessBadge, WarningBadge } from './colored-badge'
import { useIsOwner } from './session-provider'
import { ListSkeleton } from './skeletons'
import { TimestampLocal } from './timestamp'
import { Badge } from './ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

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

function OutcomeBadge({ outcome }: { outcome: JournalInvocationRecordView['outcome'] }) {
  switch (outcome) {
    case 'success':
      return <SuccessBadge>{outcome}</SuccessBadge>
    case 'failure':
    case 'partial':
      return <Badge variant="destructive">{outcome}</Badge>
    case 'conflict':
    case 'running':
      return <WarningBadge>{outcome}</WarningBadge>
    default:
      // noop
      return <Badge variant="outline">{outcome}</Badge>
  }
}

/** Bounded one-line rendering of sanitized receipt parameters. */
function parameterSummary(parameters: Record<string, unknown>): string {
  return Object.entries(parameters)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ')
}

function changedPaths(record: JournalInvocationRecordView): string[] {
  return (record.details ?? [])
    .filter((detail) => detail.kind === 'file-change' && typeof detail.path === 'string')
    .map((detail) => detail.path as string)
}

/**
 * Owner-only invocation receipts. This is operational history — which mutating
 * command ran, against what, and how it ended — never scientific truth and
 * never an authoring surface.
 */
function InvocationLedger({ project }: { project: ProjectTarget }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['journal-history', ...projectQueryKey(project)],
    queryFn: () => fetchJournalHistory(project, { limit: 200 }),
  })

  if (isLoading && !data) return <ListSkeleton count={3} />
  if (error && !data)
    return (
      <p className="py-4 text-xs text-muted-foreground">
        operation history unavailable: {(error as Error).message}
      </p>
    )
  const records = data?.invocations ?? []
  if (records.length === 0 && (data?.unreadableReceipts.length ?? 0) === 0) {
    return <p className="py-4 text-xs text-muted-foreground">no recorded operations</p>
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[11rem]">started</TableHead>
            <TableHead className="w-[6rem]">outcome</TableHead>
            <TableHead className="w-[12rem]">command</TableHead>
            <TableHead>parameters</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow key={record.id}>
              <TableCell>
                <TimestampLocal value={record.startedAt} variant="long" />
              </TableCell>
              <TableCell>
                <OutcomeBadge outcome={record.outcome} />
              </TableCell>
              <TableCell className="font-mono text-xs">{record.command}</TableCell>
              <TableCell className="text-xs">
                <span className="text-foreground/80">{parameterSummary(record.parameters)}</span>
                {record.errorCode ? (
                  <span className="ml-2 font-mono text-destructive">{record.errorCode}</span>
                ) : null}
                {changedPaths(record).length > 0 ? (
                  <div className="mt-1 flex flex-col gap-0.5 font-mono text-[0.7rem] text-muted-foreground">
                    {changedPaths(record).map((path) => (
                      <span key={path}>{path}</span>
                    ))}
                  </div>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {data && data.unreadableReceipts.length > 0 ? (
        <p className="pt-3 text-xs text-destructive">
          {data.unreadableReceipts.length} receipt file(s) could not be decoded and are omitted from
          this list.
        </p>
      ) : null}
    </>
  )
}

export function JournalView({ project }: { project: ProjectTarget }) {
  const isOwner = useIsOwner()
  const { data, isLoading, error } = useQuery({
    queryKey: ['journal', ...projectQueryKey(project)],
    queryFn: () => fetchJournal(project, { limit: 200 }),
  })

  const [tagFilter, setTagFilter] = useState<string>('all')
  const [expFilter, setExpFilter] = useState<string>('')

  const events = data?.events ?? []
  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (tagFilter !== 'all' && e.tag !== tagFilter) return false
      if (expFilter && (!e.runId || !e.runId.includes(expFilter))) return false
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
  if (error && !data)
    return <div className="p-4 text-sm text-destructive">error: {(error as Error).message}</div>
  if (!data) return null

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>Journal</CardTitle>
            <Badge variant="outline">read-only diagnostics</Badge>
            <span className="text-xs text-muted-foreground">
              Operation history, not research knowledge. Questions, decisions and findings belong in
              Wiki and Experiment documents.
            </span>
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
              placeholder="filter by run id…"
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

      {isOwner ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle>Recorded operations</CardTitle>
              <span className="text-xs text-muted-foreground">
                Automatic receipts for every non-read-only memon invocation, including failures.
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <InvocationLedger project={project} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>Legacy history</CardTitle>
            <span className="text-xs text-muted-foreground">
              Preserved docs/journal.md entries. memon no longer writes to this file.
            </span>
          </div>
        </CardHeader>
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
                  {e.runId ? (
                    <Link
                      href={projectWebPath(project, `/experiments/${encodeURIComponent(e.runId)}`)}
                      className="font-mono text-primary underline-offset-4 hover:underline"
                    >
                      {e.runId}
                    </Link>
                  ) : null}
                  {e.runId ? ' · ' : ''}
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
