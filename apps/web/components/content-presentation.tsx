'use client'

import type { ContentFields } from '@memon/core'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { type ProjectTarget, projectHost, projectName } from '../lib/api'
import { queryKeys } from '../lib/query-keys'
import { ReportHtmlEmbed, ReportHtmlZoomProvider } from './report-html-embed'
import { useIsOwner } from './session-provider'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

export function contentUrl(
  project: ProjectTarget,
  kind: 'wiki' | 'report',
  id: string,
  endpoint: 'content-services' | 'content-health' | 'content-assets',
) {
  return `/api/${endpoint}/${encodeURIComponent(projectHost(project) ?? '-')}/${encodeURIComponent(projectName(project))}/${kind}/${encodeURIComponent(id)}/`
}

export interface ContentFilter {
  category: string
  freshness: string
  presentation: string
}
export const emptyContentFilter: ContentFilter = {
  category: 'all',
  freshness: 'all',
  presentation: 'all',
}
export function matchesContentFilter(item: ContentFields, filter: ContentFilter) {
  return (
    (filter.category === 'all' || item.category === filter.category) &&
    (filter.freshness === 'all' || (item.freshness ?? 'UNDECLARED') === filter.freshness) &&
    (filter.presentation === 'all' || (item.presentation ?? 'markdown') === filter.presentation)
  )
}
export function ContentFilters({
  items,
  value,
  onChange,
}: {
  items: readonly ContentFields[]
  value: ContentFilter
  onChange: (value: ContentFilter) => void
}) {
  const categories = [
    ...new Set(items.map((item) => item.category).filter((v): v is string => Boolean(v))),
  ].sort()
  const select = (key: keyof ContentFilter, label: string, options: string[]) => (
    <Select value={value[key]} onValueChange={(next) => onChange({ ...value, [key]: next })}>
      <SelectTrigger className="w-full" size="sm" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All {label.toLowerCase()}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
  return (
    <div className="grid gap-2" data-content-filters>
      {select('category', 'Categories', categories)}
      {select('freshness', 'Freshness', ['CURRENT', 'STALE', 'UNDECLARED'])}
      {select('presentation', 'Presentations', ['markdown', 'html', 'service'])}
    </div>
  )
}
export function ContentBadges({ content }: { content: ContentFields }) {
  return (
    <span className="flex flex-wrap gap-1" data-content-badges>
      {content.category && (
        <Badge variant="secondary" className="text-[10px]">
          {content.category}
        </Badge>
      )}
      <Badge variant="outline" className="text-[10px]">
        {content.presentation ?? 'markdown'}
      </Badge>
      {content.freshness && (
        <Badge variant="outline" className="text-[10px]" title={content.staleReason}>
          {content.freshness}
        </Badge>
      )}
    </span>
  )
}
export function ContentMetadata({ content }: { content: ContentFields }) {
  return (
    <div className="mb-3 space-y-2 text-xs text-muted-foreground" data-content-metadata>
      <ContentBadges content={content} />
      {content.freshness === 'STALE' && content.staleReason && <p>{content.staleReason}</p>}
      {content.asOf && (
        <p>
          Evidence as of <time dateTime={content.asOf}>{content.asOf}</time>
        </p>
      )}
      {content.sourceCommits && (
        <details>
          <summary className="cursor-pointer">Source revisions</summary>
          <ul className="mt-2 space-y-1">
            {Object.entries(content.sourceCommits).map(([repo, sha]) => (
              <li key={repo} className="break-all">
                <span>{repo}</span> · <code>{sha}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function useAvailability(
  project: ProjectTarget,
  kind: 'wiki' | 'report',
  id: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.contentHealth(project, kind, id),
    enabled,
    queryFn: async () => {
      const response = await fetch(contentUrl(project, kind, id, 'content-health'), {
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok)
        throw new Error(
          response.status === 401 || response.status === 403
            ? 'Owner access required'
            : 'Service unavailable',
        )
      return response.json() as Promise<{ available: boolean; status: number }>
    },
    retry: false,
    refetchInterval: (query) =>
      Math.min(
        300_000,
        1000 * 2 ** Math.min(9, query.state.dataUpdateCount + query.state.errorUpdateCount),
      ),
    refetchIntervalInBackground: false,
  })
}

export function ServiceAvailability({
  project,
  kind,
  id,
}: {
  project: ProjectTarget
  kind: 'wiki' | 'report'
  id: string
}) {
  const owner = useIsOwner()
  const [checked, setChecked] = useState(false)
  const health = useAvailability(project, kind, id, owner && checked)
  if (!owner) return <span className="text-[10px] text-muted-foreground">owner access</span>
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-6 px-1 text-[10px]"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setChecked(true)
        if (checked) void health.refetch()
      }}
    >
      {!checked
        ? 'Check service'
        : health.isFetching
          ? 'Checking…'
          : health.isError
            ? 'Offline · retry'
            : 'Reachable'}
    </Button>
  )
}

export function ContentPresentation({
  content,
  project,
  kind,
  id,
}: {
  content: ContentFields
  project: ProjectTarget
  kind: 'wiki' | 'report'
  id: string
}) {
  if (content.contentError)
    return (
      <p className="rounded-md border border-destructive p-3 text-sm text-destructive">
        {content.contentError}
      </p>
    )
  if (content.presentation === 'service')
    return (
      <LiveContent project={project} kind={kind} id={id} entry={content.contentEntry ?? './'} />
    )
  if (content.presentation !== 'html') return null
  const url =
    contentUrl(project, kind, id, 'content-assets') +
    (content.contentEntry ?? 'index.html').replace(/^\.\//, '')
  return (
    <ReportHtmlZoomProvider>
      <ReportHtmlEmbed src={url} title={`${id} HTML`} />
    </ReportHtmlZoomProvider>
  )
}
function LiveContent({
  project,
  kind,
  id,
  entry,
}: {
  project: ProjectTarget
  kind: 'wiki' | 'report'
  id: string
  entry: string
}) {
  const owner = useIsOwner()
  const health = useAvailability(project, kind, id, owner)
  const prefix = contentUrl(project, kind, id, 'content-services')
  const url = prefix + entry.replace(/^\.\//, '')
  if (!owner)
    return (
      <p className="text-sm text-muted-foreground">Sign in as the owner to open this service.</p>
    )
  return (
    <div className="space-y-3" data-live-content>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline">
          {health.isFetching ? 'Checking' : health.isError ? 'Unavailable' : 'Reachable'}
        </Badge>
        <Button size="sm" variant="outline" onClick={() => health.refetch()}>
          Check again
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <a href={url} target="_blank" rel="noreferrer">
            Open application ↗
          </a>
        </Button>
      </div>
      {health.isError ? (
        <p className="text-sm text-muted-foreground">
          Start the application on the declared port of the experiment machine, then retry. memon
          forwards traffic and does not start the service.
        </p>
      ) : health.data ? (
        <iframe
          src={url}
          title={`${id} live application`}
          className="h-[70svh] min-h-80 w-full rounded-md border"
        />
      ) : (
        <p className="text-sm text-muted-foreground">Checking service…</p>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Application base URL</summary>
        <code className="mt-2 block break-all">{prefix}</code>
      </details>
    </div>
  )
}
