'use client'

// Published discussion questions that cite this Report. Hidden for document-only viewers,
// whose grant covers just this Report, and when nothing cites it.

import { useQuery } from '@tanstack/react-query'
import { MessagesSquare } from 'lucide-react'
import Link from 'next/link'
import { fetchDiscussionCitations } from '@/lib/api'
import { projectPagePath } from '@/lib/project-routes'
import { type ProjectTarget, projectRouteTarget } from '@/lib/project-target'
import { queryKeys } from '@/lib/query-keys'
import { useIsDocumentOnlyViewer } from './session-provider'
import { Badge } from './ui/badge'
import { Item, ItemContent, ItemGroup, ItemSeparator, ItemTitle } from './ui/item'

export function ReportDiscussionCitations({
  project,
  reportId,
}: {
  project: ProjectTarget
  reportId: string
}) {
  const documentOnly = useIsDocumentOnlyViewer()
  const { data } = useQuery({
    queryKey: queryKeys.discussionCitations(project, reportId),
    queryFn: () => fetchDiscussionCitations(project, reportId),
    enabled: !documentOnly,
  })
  const citations = data?.citations ?? []
  if (documentOnly || citations.length === 0) return null
  return (
    <section
      aria-label="Referenced in discussions"
      className="mt-8 space-y-2"
      data-report-discussion-citations
    >
      <h2 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <MessagesSquare className="size-3.5" aria-hidden="true" />
        Referenced in discussions
        <Badge variant="secondary" className="h-4 px-1 tabular-nums">
          {citations.length}
        </Badge>
      </h2>
      <ItemGroup className="rounded-lg border">
        {citations.map((c, index) => (
          <div key={`${c.discussion}/${c.question}`}>
            {index > 0 && <ItemSeparator className="my-0" />}
            <Item size="xs" className="rounded-none">
              <ItemContent className="min-w-0">
                <ItemTitle className="w-full text-xs">
                  <Link
                    href={`${projectPagePath(projectRouteTarget(project), {
                      kind: 'discussion',
                      number: Number(c.discussion.slice(1)),
                    })}#${c.question}`}
                    className="truncate hover:underline"
                  >
                    {c.title}
                  </Link>
                </ItemTitle>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {c.discussion} · {c.discussionTitle}
                  {c.anchors.length > 0 && ` · #${c.anchors.join(', #')}`}
                </p>
              </ItemContent>
              {c.discussionStatus === 'CLOSED' && <Badge variant="outline">CLOSED</Badge>}
            </Item>
          </div>
        ))}
      </ItemGroup>
    </section>
  )
}
