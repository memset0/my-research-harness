'use client'

import { useQuery } from '@tanstack/react-query'
import * as React from 'react'

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { type CodePreview, fetchCodePreview, type ProjectTarget, projectQueryKey } from '@/lib/api'
import { cn } from '@/lib/utils'
import { queryKeys } from '../lib/query-keys'

// Client-side mirror of the server's permalink shape check (see
// @memon/core parseGithubPermalink). This only decides whether a link is
// eligible for hover-preview routing; the authoritative parse + the actual
// local file read happen server-side in /api/code-preview. Kept permissive
// on the path segment so a trailing `?plain=1` still matches — core strips
// it before parsing.
const GITHUB_BLOB_PERMALINK =
  /^https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/blob\/[^/\s]+\/[^#\s]+#L\d+(?:-L\d+)?$/

export function isGithubBlobPermalink(href: string): boolean {
  return GITHUB_BLOB_PERMALINK.test(href)
}

const shortSha = (sha: string) => (/^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : sha)

/**
 * Wraps a GitHub blob line-permalink anchor so that hovering it fetches a
 * preview of the referenced code from the LOCAL git repo (via the project's
 * `github` mapping) and renders it just below the link. No GitHub network
 * access; the endpoint is logged-in-only (read class). The fetch is lazy —
 * it fires only on the first hover-open and is cached per (project, href).
 */
export function GithubPermalinkPreview({
  href,
  project,
  children,
}: {
  href: string
  project: ProjectTarget
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const query = useQuery<CodePreview>({
    queryKey: queryKeys.codePreview(project, href),
    queryFn: () => fetchCodePreview(project, href),
    enabled: open,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  })

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={250} closeDelay={120}>
      <HoverCardTrigger asChild>
        <a href={href} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="start"
        sideOffset={6}
        // Override the primitive's narrow w-64 + padding: this is a code
        // panel, so go wide, clip rounded corners, and let the body manage
        // its own padding / scroll regions.
        className="w-[min(46rem,90vw)] overflow-hidden p-0"
      >
        <PreviewBody query={query} />
      </HoverCardContent>
    </HoverCard>
  )
}

function PreviewBody({ query }: { query: ReturnType<typeof useQuery<CodePreview>> }) {
  const data = query.data

  return (
    <div className="text-xs">
      {data ? (
        <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-3 py-1.5 font-mono text-[0.7rem] text-muted-foreground">
          <span className="truncate" title={data.path}>
            {data.owner}/{data.repo} · {data.path}
          </span>
          <span className="shrink-0">
            #L{data.startLine}
            {data.endLine !== data.startLine ? `-L${data.endLine}` : ''} @ {shortSha(data.sha)}
          </span>
        </div>
      ) : null}

      {query.isLoading ? (
        <p className="px-3 py-6 text-center text-muted-foreground">Loading preview…</p>
      ) : query.isError ? (
        <p className="px-3 py-6 text-center text-destructive">
          Couldn&apos;t load preview
          {query.error instanceof Error && query.error.message ? ` — ${query.error.message}` : ''}
        </p>
      ) : data && data.reason === 'too-large' ? (
        <p className="px-3 py-6 text-center text-muted-foreground">File too large to preview.</p>
      ) : data && data.reason === 'binary' ? (
        <p className="px-3 py-6 text-center text-muted-foreground">Binary file — no preview.</p>
      ) : data && data.lines.length > 0 ? (
        <>
          {/* Native overflow-auto (not the shadcn ScrollArea) so BOTH axes
              scroll: vertical for many lines, horizontal for long ones.
              max-h caps the panel height; the table grows past the card
              width on long lines, engaging the horizontal scrollbar. */}
          <div className="max-h-80 overflow-auto">
            <table className="min-w-full border-collapse">
              <tbody>
                {data.lines.map((l) => (
                  <tr key={l.n} className={cn(l.target && 'bg-primary/10')}>
                    <td className="w-px select-none border-r px-2 text-right align-top font-mono tabular-nums text-muted-foreground">
                      {l.n}
                    </td>
                    <td className="whitespace-pre px-2 align-top font-mono">{l.text || ' '}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.truncated ? (
            <p className="border-t px-3 py-1 text-center text-[0.7rem] text-muted-foreground">
              Preview truncated.
            </p>
          ) : null}
        </>
      ) : data ? (
        <p className="px-3 py-6 text-center text-muted-foreground">No preview available.</p>
      ) : null}
    </div>
  )
}
