'use client'

import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, ChevronDown, PanelRight, PanelRightClose, Rows3, X } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import {
  fetchReport,
  fetchReports,
  type ProjectTarget,
  projectQueryKey,
  projectWebPath,
  type ReportListItem,
} from '../lib/api'
import { cn } from '../lib/utils'
import { RenderedItem, reportResourceBaseUrl } from './inbox-shell'
import { ListSkeleton } from './skeletons'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

export type ReportPaneSurface = 'drawer' | 'split'

export function ReportPane({
  project,
  reportId,
  surface,
  onSwitch,
  onSurfaceChange,
  onClose,
}: {
  project: ProjectTarget
  reportId: string
  surface: ReportPaneSurface
  onSwitch: (reportId: string) => void
  onSurfaceChange: (surface: ReportPaneSurface) => void
  onClose: () => void
}) {
  const list = useQuery({
    queryKey: ['reports', ...projectQueryKey(project)],
    queryFn: () => fetchReports(project),
    staleTime: 5_000,
  })
  const detail = useQuery({
    queryKey: ['report', ...projectQueryKey(project), reportId],
    queryFn: () => fetchReport(project, reportId),
  })
  const reports = list.data?.reports ?? []
  const listError = list.isError
    ? ((list.error as Error | null) ?? new Error('request failed'))
    : null
  const selectedSummary = reports.find((report) => report.id === reportId)
  const identity = detail.data
    ? `${detail.data.id} ${detail.data.slug}`
    : selectedSummary
      ? `${selectedSummary.id} ${selectedSummary.slug}`
      : reportId

  return (
    <section
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-card text-card-foreground"
      data-report-pane=""
      data-surface={surface}
      aria-label={`Report ${reportId}`}
    >
      <header className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b bg-card px-2.5 py-1.5">
        <ReportPaneSwitcher
          reportId={reportId}
          identity={identity}
          reports={reports}
          loading={list.isLoading}
          error={listError}
          onRetry={list.refetch}
          onSwitch={onSwitch}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          {surface === 'split' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Move report to drawer"
              title="Move to drawer"
              onClick={() => onSurfaceChange('drawer')}
            >
              <PanelRight className="size-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="hidden md:inline-flex"
              aria-label="Split report right"
              title="Split right"
              onClick={() => onSurfaceChange('split')}
            >
              <Rows3 className="size-3.5 -rotate-90" />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" asChild title="Open full report">
            <Link
              href={projectWebPath(project, `/reports/${encodeURIComponent(reportId)}`)}
              aria-label="Open full report"
            >
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close report"
            title="Close report"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-card">
        {detail.isLoading && !detail.data ? (
          <div className="p-4">
            <ListSkeleton count={4} />
          </div>
        ) : detail.error ? (
          <ReportPaneError reportId={reportId} message={(detail.error as Error).message} />
        ) : !detail.data ? (
          <ReportPaneError reportId={reportId} message="Report not found" />
        ) : (
          <div className="p-4 md:p-5">
            <RenderedItem
              kind="reports"
              content={detail.data.content}
              project={project}
              sourceDocumentPath={detail.data.path ?? detail.data.resource}
              sourceSurface="side-report"
              sourceReportId={reportId}
              resourceBaseUrl={
                detail.data.format === 'bundle'
                  ? reportResourceBaseUrl(project, reportId)
                  : undefined
              }
            />
          </div>
        )}
      </div>
    </section>
  )
}

function ReportPaneSwitcher({
  reportId,
  identity,
  reports,
  loading,
  error,
  onRetry,
  onSwitch,
}: {
  reportId: string
  identity: string
  reports: ReportListItem[]
  loading: boolean
  error?: Error | null
  onRetry?: () => void
  onSwitch: (reportId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const active = reports.find((report) => report.id === reportId)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 min-w-0 max-w-full justify-start gap-1.5 px-1.5"
          aria-label={`Switch report, current ${identity}`}
          title={identity}
        >
          <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-primary">
            {reportId}
          </span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {active?.slug ?? identity.replace(`${reportId} `, '')}
          </span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] p-0"
        aria-label="Switch report"
      >
        <div className="flex items-center justify-between border-b px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
          <span>Reports</span>
          <span className="tabular-nums">{reports.length}</span>
        </div>
        <div className="max-h-[min(28rem,65vh)] overflow-y-auto p-2" data-report-pane-switch-list>
          {loading && reports.length === 0 ? (
            <ListSkeleton count={4} />
          ) : error && reports.length === 0 ? (
            // Distinguish "the list failed to load" from "this project has no
            // reports" — otherwise a transient upstream error renders as a
            // silent empty switcher with no way to retry.
            <div
              className={cn('flex flex-col items-center gap-2 px-3 py-5 text-center')}
              data-report-switch-error=""
            >
              <p className={cn('text-xs font-medium text-destructive')}>failed to load reports</p>
              <p className={cn('break-words text-[10px] text-muted-foreground')}>{error.message}</p>
              {onRetry && (
                <Button type="button" size="sm" variant="outline" onClick={() => onRetry()}>
                  Retry
                </Button>
              )}
            </div>
          ) : reports.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">no reports yet</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {reports.map((report) => {
                const selected = report.id === reportId
                return (
                  <li key={`${report.id}:${report.path ?? ''}`}>
                    <button
                      type="button"
                      aria-current={selected ? 'page' : undefined}
                      className={cn(
                        'block w-full rounded-md border border-border bg-card p-2.5 text-left text-xs transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        selected && 'border-primary bg-primary/5',
                      )}
                      onClick={() => {
                        setOpen(false)
                        if (!selected) onSwitch(report.id)
                      }}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] font-semibold tabular-nums text-primary">
                          {report.id}
                        </span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {report.slug}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px]">
                        {report.title ?? (
                          <span className="italic text-muted-foreground/60">(no title)</span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ReportPaneError({ reportId, message }: { reportId: string; message: string }) {
  return (
    <div className="flex h-full min-h-48 items-center justify-center p-6 text-center">
      <div className="space-y-2">
        <PanelRightClose className="mx-auto size-8 text-muted-foreground/60" />
        <p className="font-mono text-sm font-medium">{reportId}</p>
        <p className="max-w-xs text-xs text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}
