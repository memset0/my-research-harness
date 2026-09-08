'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useIsDesktop } from '@/hooks/use-is-desktop'
import { type FullExperiment, fetchExperiment, projectQueryKey } from '../lib/api'
import { WarningBadge } from './colored-badge'
import { DocumentArtifactLinkProvider } from './document-artifact-link-provider'
import { EditReadmeButton } from './edit-readme-button'
import { LogViewer } from './log-viewer'
import { ManualRefreshButton } from './manual-refresh-button'
import { Markdown } from './markdown'
import { ReadmeEditorProvider } from './readme-editor-context'
import { ReadmeSidePanel } from './readme-side-panel'
import { DetailSkeleton } from './skeletons'
import { StatusEdit } from './status-edit'
import { TimestampLocal } from './timestamp'
import { Badge } from './ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { WarningsCard } from './warnings-card'

export function ExperimentDetail({ project, id }: { project: string; id: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['run', ...projectQueryKey(project), id],
    queryFn: () => fetchExperiment(project, id),
  })

  if (isLoading && !data) return <DetailSkeleton />
  // Only report the failure when there is nothing cached to show; a failed
  // refresh leaves the last good README on screen.
  if (error && !data)
    return <div className="p-4 text-sm text-destructive">error: {(error as Error).message}</div>
  if (!data) return null

  const exp: FullExperiment = data

  return (
    <ReadmeEditorProvider>
      <ExperimentDetailLayout exp={exp} project={project} />
    </ReadmeEditorProvider>
  )
}

function ExperimentDetailLayout({ exp, project }: { exp: FullExperiment; project: string }) {
  const isDesktop = useIsDesktop()
  const fm = exp.frontMatter

  return (
    // Pin the row to the viewport-minus-AppBar (h-12 = 3rem) and let each
    // pane own its own scroll. Without this, scrolling the left content
    // bleeds into the panel because the document is the only scroll container.
    // Note: the scroll container is a plain block; the inner flex-column
    // holds the actual cards. Putting `overflow-y-auto` directly on a
    // `flex-col` container squashes flex children instead of overflowing.
    <div className="flex h-[calc(100svh-3rem)] overflow-hidden">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-4 md:p-6">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="font-mono">{exp.id}</CardTitle>
                {exp.hasReadme ? (
                  <StatusEdit
                    project={project}
                    id={exp.id}
                    status={fm.status}
                    stale={exp.stale}
                    expectedMtime={exp.readmeMtime}
                  />
                ) : (
                  <WarningBadge>no README — status edit unavailable</WarningBadge>
                )}
                {fm.deprecated && (
                  <Badge variant="outline">deprecated — excluded from research</Badge>
                )}
                {exp.parseErrors.length > 0 && (
                  <Badge variant="destructive">{exp.parseErrors.length} parse errors</Badge>
                )}
                {exp.parseWarnings.length > 0 && (
                  <WarningBadge>{exp.parseWarnings.length} warnings</WarningBadge>
                )}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {/* Run bodies never refresh on their own — this is the
                      only way to pull new content for this README. */}
                  <ManualRefreshButton
                    label="Reload this run from disk"
                    queryKeys={[['run', ...projectQueryKey(project), exp.id]]}
                  />
                  {exp.hasReadme && exp.path && <EditReadmeButton path={exp.path} runId={exp.id} />}
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <Field label="name" value={fm.name} />
              <Field label="project" value={exp.project} />
              {fm.project !== '' && fm.project !== exp.project && (
                <Field label="sub-project" value={fm.project} />
              )}
              <Field label="created">
                <TimestampLocal value={fm.createdAt} variant="long" />
              </Field>
              <Field label="finished">
                <TimestampLocal value={fm.finishedAt} variant="long" />
              </Field>
              <Field label="host" value={fm.host ?? '—'} />
              <Field label="pid" value={fm.pid !== null ? String(fm.pid) : '—'} />
              <Field label="gpus" value={fm.gpus.length > 0 ? fm.gpus.join(', ') : '—'} />
              <Field label="entry" value={fm.entry || '—'} />
              <div className="col-span-2 md:col-span-4 break-all">
                <FieldLabel>command</FieldLabel>
                <code className="block rounded bg-muted px-2 py-1 font-mono text-xs">
                  {fm.command || '—'}
                </code>
              </div>
              {fm.wandb && (
                <div className="col-span-2 md:col-span-4">
                  <FieldLabel>wandb</FieldLabel>
                  <a
                    className="text-xs text-primary underline-offset-4 hover:underline"
                    href={fm.wandb}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {fm.wandb}
                  </a>
                </div>
              )}
              {fm.tags.length > 0 && (
                <div className="col-span-2 md:col-span-4">
                  <FieldLabel>tags</FieldLabel>
                  <div className="flex flex-wrap gap-1">
                    {fm.tags.map((t) => (
                      <Badge key={t} variant="outline">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {fm.hypotheses.length > 0 && (
                <div className="col-span-2 md:col-span-4">
                  <FieldLabel>hypotheses</FieldLabel>
                  <div className="flex flex-wrap gap-1">
                    {fm.hypotheses.map((h) => (
                      <Link key={h} href={`/p/${encodeURIComponent(project)}/hypotheses#${h}`}>
                        <Badge>{h}</Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {exp.body.trim() && (
            <DocumentArtifactLinkProvider
              project={project}
              sourceDocumentPath={`${exp.path ?? exp.resource ?? exp.id}/README.md`}
              sourceSurface="left"
            >
              <Card>
                <CardContent className="pt-6">
                  <Markdown className="text-xs" project={project}>
                    {exp.body}
                  </Markdown>
                </CardContent>
              </Card>
            </DocumentArtifactLinkProvider>
          )}
          {exp.hasReadme && (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Legacy warning controls
              </summary>
              <WarningsCard
                project={project}
                runId={exp.id}
                readmePath={`${exp.path ?? exp.resource ?? exp.id}/README.md`}
                initialWarnings={exp.warnings}
                initialMtime={exp.readmeMtime}
              />
            </details>
          )}

          <Card id="resources">
            <CardHeader>
              <CardTitle>Resources</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground italic">
                not yet available — GPU/disk monitoring is a P1 feature
              </div>
            </CardContent>
          </Card>

          {exp.hasReadme && exp.path && <LogViewer project={project} expPath={exp.path} />}
        </div>
      </div>
      {isDesktop && exp.hasReadme && exp.path && (
        <ReadmeSidePanel path={`${exp.path}/README.md`} runId={exp.id} />
      )}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{children}</div>
}

function Field({
  label,
  value,
  children,
}: {
  label: string
  value?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>{label}</FieldLabel>
      {children ?? <div className="font-mono text-xs text-foreground truncate">{value}</div>}
    </div>
  )
}
