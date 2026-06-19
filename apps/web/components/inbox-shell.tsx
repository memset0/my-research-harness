'use client'

// Shared inbox shell for the per-project Reports and Digests views.
// Desktop: 2-column read mode (rail + rendered) → 3-column when editing
// (rail + rendered + Monaco). Mobile: rendered only with a FAB that opens
// a right-side Sheet showing the rail; tapping Edit opens a full-viewport
// bottom Sheet with Monaco.

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { List, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  fetchDigest,
  fetchDigests,
  fetchReport,
  fetchReports,
  putDigest,
  putReport,
  type FullDigest,
  type FullReport,
} from '../lib/api'
import type { DigestSummary, ReportSummary } from '@memon/core'
import { Button } from './ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet'
import { Markdown } from './markdown'
import { FrontmatterPanel } from './frontmatter-panel'
import { splitFrontmatter } from '../lib/frontmatter'
import { ReadmeMonaco } from './readme-monaco'
import { ListSkeleton } from './skeletons'
import { TimestampLocal } from './timestamp'
import { cn } from '../lib/utils'

export type InboxKind = 'reports' | 'digests'

interface CommonItem {
  id: string
  path: string
  mtime: number
  title: string | null
  /** For reports it's the slug; for digests it's the ISO date. Sub-label. */
  subLabel: string
}

interface FullItem {
  id: string
  path: string
  mtime: number
  hash: string
  content: string
  subLabel: string
}

const EMPTY_COPY = {
  reports: {
    rail: 'no reports yet',
    body:
      'No reports yet. Reports are written by `memon-write-report`; pick a hypothesis or set of experiments and ask the skill to summarize.',
  },
  digests: {
    rail: 'no digests yet',
    body:
      'No digests yet. Digests are written by `memon-digest-journal` and snapshot a date range from docs/journal.md.',
  },
} as const

export function InboxShell({
  kind,
  project,
  selectedId,
}: {
  kind: InboxKind
  project: string
  selectedId: string | null
}) {
  const items = useItemsList(kind, project)
  const selected = useSelectedItem(kind, project, selectedId)

  const empty = EMPTY_COPY[kind]

  return (
    <div className="flex h-[calc(100svh-3rem)] overflow-hidden">
      {/* Left rail — desktop only */}
      <aside className="hidden w-72 shrink-0 border-r md:flex md:flex-col">
        <RailHeader kind={kind} count={items.length} />
        <div className="flex-1 overflow-y-auto">
          <RailList kind={kind} project={project} items={items} selectedId={selectedId} loading={!items} />
        </div>
      </aside>

      {/* Right pane — rendered markdown + edit toggle.
          overflow-x-hidden alongside overflow-y-auto is needed to defeat
          the CSS Overflow Module 3 "auto-x trap" (overflow-y: auto with
          overflow-x: visible computes overflow-x to auto, producing a
          stray horizontal scrollbar when content has any unbreakable
          wide element). */}
      <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        {selectedId === null ? (
          <EmptyState bodyMarkdown={empty.body} />
        ) : (
          <SelectedItemPane
            kind={kind}
            project={project}
            selectedId={selectedId}
            data={selected.data}
            isLoading={selected.isLoading}
            error={selected.error}
          />
        )}
      </main>

      {/* Mobile FAB → drawer with the rail */}
      <MobileRailDrawer kind={kind} project={project} items={items} selectedId={selectedId} />
    </div>
  )
}

function useItemsList(kind: InboxKind, project: string): CommonItem[] {
  const reportsQ = useQuery({
    queryKey: ['reports', project],
    queryFn: () => fetchReports(project),
    enabled: kind === 'reports',
    staleTime: 5_000,
  })
  const digestsQ = useQuery({
    queryKey: ['digests', project],
    queryFn: () => fetchDigests(project),
    enabled: kind === 'digests',
    staleTime: 5_000,
  })
  return useMemo(() => {
    if (kind === 'reports') {
      const reports: ReportSummary[] = reportsQ.data?.reports ?? []
      return reports.map((r) => ({ id: r.id, path: r.path, mtime: r.mtime, title: r.title, subLabel: r.slug }))
    }
    const digests: DigestSummary[] = digestsQ.data?.digests ?? []
    return digests.map((d) => ({ id: d.id, path: d.path, mtime: d.mtime, title: d.title, subLabel: d.date }))
  }, [kind, reportsQ.data, digestsQ.data])
}

function useSelectedItem(
  kind: InboxKind,
  project: string,
  selectedId: string | null,
): { data: FullItem | undefined; isLoading: boolean; error: Error | null } {
  const reportQ = useQuery({
    queryKey: ['report', project, selectedId],
    queryFn: () => fetchReport(project, selectedId!),
    enabled: kind === 'reports' && !!selectedId,
  })
  const digestQ = useQuery({
    queryKey: ['digest', project, selectedId],
    queryFn: () => fetchDigest(project, selectedId!),
    enabled: kind === 'digests' && !!selectedId,
  })
  if (kind === 'reports') {
    const r = reportQ.data as FullReport | undefined
    return {
      data: r ? { ...r, subLabel: r.slug } : undefined,
      isLoading: reportQ.isLoading,
      error: (reportQ.error as Error | null) ?? null,
    }
  }
  const d = digestQ.data as FullDigest | undefined
  return {
    data: d ? { ...d, subLabel: d.date } : undefined,
    isLoading: digestQ.isLoading,
    error: (digestQ.error as Error | null) ?? null,
  }
}

function RailHeader({ kind, count }: { kind: InboxKind; count: number }) {
  return (
    <div className="flex items-center justify-between border-b px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
      <span>{kind === 'reports' ? 'Reports' : 'Digests'}</span>
      <span className="tabular-nums">{count}</span>
    </div>
  )
}

function RailList({
  kind,
  project,
  items,
  selectedId,
  loading,
  onSelect,
}: {
  kind: InboxKind
  project: string
  items: CommonItem[]
  selectedId: string | null
  loading: boolean
  onSelect?: () => void
}) {
  const base = `/p/${encodeURIComponent(project)}/${kind}`
  if (loading && items.length === 0) {
    return (
      <div className="p-3">
        <ListSkeleton count={4} />
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground/70">
        {EMPTY_COPY[kind].rail}
      </div>
    )
  }
  return (
    <ul className="flex flex-col">
      {items.map((it) => {
        const active = it.id === selectedId
        return (
          <li key={it.id}>
            <Link
              href={`${base}/${encodeURIComponent(it.id)}`}
              onClick={onSelect}
              className={cn(
                'block border-b px-3 py-2 text-xs transition hover:bg-accent/40',
                active && 'bg-accent text-accent-foreground',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] tabular-nums">{it.id}</span>
                <span className="truncate text-[10px] text-muted-foreground">{it.subLabel}</span>
              </div>
              <div className="mt-0.5 truncate text-[11px]">
                {it.title ?? <span className="italic text-muted-foreground/60">(no title)</span>}
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function EmptyState({ bodyMarkdown }: { bodyMarkdown: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-sm text-muted-foreground">
        <Markdown>{bodyMarkdown}</Markdown>
      </div>
    </div>
  )
}

function SelectedItemPane({
  kind,
  project,
  selectedId,
  data,
  isLoading,
  error,
}: {
  kind: InboxKind
  project: string
  selectedId: string
  data: FullItem | undefined
  isLoading: boolean
  error: Error | null
}) {
  const [editing, setEditing] = useState(false)

  if (isLoading && !data) {
    return (
      <div className="p-4 md:p-6">
        <ListSkeleton count={3} />
      </div>
    )
  }
  if (error) {
    return <div className="p-4 text-sm text-destructive">error: {error.message}</div>
  }
  if (!data) {
    return <div className="p-4 text-sm text-muted-foreground">not found: {selectedId}</div>
  }

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <div className="flex items-baseline gap-2 text-xs">
          <span className="font-mono tabular-nums">{data.id}</span>
          <span className="text-muted-foreground">{data.subLabel}</span>
          <span className="text-muted-foreground/60">·</span>
          <TimestampLocal value={new Date(data.mtime).toISOString()} />
        </div>
        <Button size="sm" variant={editing ? 'secondary' : 'outline'} onClick={() => setEditing((v) => !v)}>
          {editing ? <X className="size-3.5" /> : <Pencil className="size-3.5" />}
          {editing ? 'Cancel' : 'Edit'}
        </Button>
      </div>
      <div className={cn('flex flex-1 overflow-hidden', editing ? 'md:divide-x' : '')}>
        <div className={cn('overflow-y-auto overflow-x-hidden', editing ? 'min-w-0 flex-1' : 'min-w-0 flex-1')}>
          <div className="p-4 md:p-6">
            <RenderedItem content={data.content} project={project} />
          </div>
        </div>
        {editing && (
          <div className="hidden md:flex md:w-[28rem] md:flex-col">
            <InboxEditor
              kind={kind}
              project={project}
              data={data}
              onClose={() => setEditing(false)}
            />
          </div>
        )}
      </div>

      {/* Mobile: Edit takes over a full-viewport Sheet */}
      {editing && (
        <Sheet open={editing} onOpenChange={setEditing}>
          <SheetContent side="bottom" className="h-[100svh] p-0 md:hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>Edit {data.id}</SheetTitle>
            </SheetHeader>
            <InboxEditor
              kind={kind}
              project={project}
              data={data}
              onClose={() => setEditing(false)}
            />
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}

function RenderedItem({ content, project }: { content: string; project: string }) {
  const { frontmatter, body } = useMemo(() => splitFrontmatter(content), [content])
  return (
    <>
      {frontmatter && <FrontmatterPanel data={frontmatter} />}
      <Markdown project={project}>{body}</Markdown>
    </>
  )
}

function InboxEditor({
  kind,
  project,
  data,
  onClose,
}: {
  kind: InboxKind
  project: string
  data: FullItem
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [buffer, setBuffer] = useState(data.content)
  const [saving, setSaving] = useState(false)
  const [knownMtime, setKnownMtime] = useState(data.mtime)
  const [knownHash, setKnownHash] = useState(data.hash)

  // If the underlying data updates externally (SSE invalidation), pick up
  // the new on-disk state so subsequent saves pass the optimistic-lock check.
  useEffect(() => {
    setKnownMtime(data.mtime)
    setKnownHash(data.hash)
  }, [data.mtime, data.hash])

  async function save() {
    setSaving(true)
    try {
      const put = kind === 'reports' ? putReport : putDigest
      const res = await put(project, data.id, {
        content: buffer,
        expectedMtime: knownMtime,
        expectedHash: knownHash,
      })
      // Update local editor state to the post-write mtime/hash so the next
      // save doesn't immediately conflict.
      setKnownMtime(res.mtime)
      setKnownHash(res.hash)
      // Invalidate the detail query so the rendered pane reflects the save.
      const detailKey = kind === 'reports' ? ['report', project, data.id] : ['digest', project, data.id]
      const listKey = [kind, project]
      queryClient.invalidateQueries({ queryKey: detailKey })
      queryClient.invalidateQueries({ queryKey: listKey })
      toast.success('saved')
      onClose()
    } catch (err) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 409) {
        toast.error('External edit detected. Refresh to load the latest content.', {
          action: {
            label: 'Refresh',
            onClick: () => {
              const detailKey = kind === 'reports' ? ['report', project, data.id] : ['digest', project, data.id]
              queryClient.invalidateQueries({ queryKey: detailKey })
              onClose()
            },
          },
        })
      } else {
        toast.error(`save failed: ${e?.message ?? 'unknown'}`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs">
        <span className="font-mono text-muted-foreground">edit · {data.id}</span>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving || buffer === data.content}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
      <div className="flex-1">
        <ReadmeMonaco value={buffer} onChange={setBuffer} />
      </div>
    </div>
  )
}

function MobileRailDrawer({
  kind,
  project,
  items,
  selectedId,
}: {
  kind: InboxKind
  project: string
  items: CommonItem[]
  selectedId: string | null
}) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="icon"
          className="fixed right-6 bottom-6 z-30 size-12 rounded-full shadow-lg md:hidden"
          aria-label="Open list"
        >
          <List className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-80 p-0">
        <SheetHeader className="border-b px-3 py-3">
          <SheetTitle className="text-sm">
            {kind === 'reports' ? 'Reports' : 'Digests'} · {project}
          </SheetTitle>
        </SheetHeader>
        <RailList
          kind={kind}
          project={project}
          items={items}
          selectedId={selectedId}
          loading={false}
          onSelect={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
