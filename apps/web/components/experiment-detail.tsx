'use client'

import { useQuery } from '@tanstack/react-query'
import { useIsDesktop } from '@/hooks/use-is-desktop'
import { fetchExperiment, type FullExperiment } from '../lib/api'
import { Badge } from './ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { WarningBadge } from './colored-badge'
import { StatusEdit } from './status-edit'
import { EditReadmeButton } from './edit-readme-button'
import { AddNoteButton } from './add-note-button'
import { AskClaudeCodeButton } from './ask-claude-code-button'
import { TerminalButton } from './terminal-button'
import { DetailSkeleton } from './skeletons'
import { TimestampLocal } from './timestamp'
import { Markdown } from './markdown'
import { LogViewer } from './log-viewer'
import { ReadmeEditorProvider } from './readme-editor-context'
import { ReadmeSidePanel } from './readme-side-panel'
import { WarningsCard } from './warnings-card'
import Link from 'next/link'

export function ExperimentDetail({ project, id }: { project: string; id: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['run', id],
    queryFn: () => fetchExperiment(id),
  })

  if (isLoading && !data) return <DetailSkeleton />
  if (error) return <div className="p-4 text-sm text-destructive">error: {(error as Error).message}</div>
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
              <StatusEdit id={exp.id} status={fm.status} stale={exp.stale} expectedMtime={exp.readmeMtime} />
            ) : (
              <WarningBadge>no README — status edit unavailable</WarningBadge>
            )}
            {exp.parseErrors.length > 0 && (
              <Badge variant="destructive">{exp.parseErrors.length} parse errors</Badge>
            )}
            {exp.parseWarnings.length > 0 && (
              <WarningBadge>{exp.parseWarnings.length} warnings</WarningBadge>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <TerminalButton runId={exp.id} projectName={exp.project} />
              <AskClaudeCodeButton experiment={exp} />
              <AddNoteButton project={exp.project} runId={exp.id} />
              {exp.hasReadme && <EditReadmeButton path={exp.path} runId={exp.id} />}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <Field label="name" value={fm.name} />
          <Field label="project" value={exp.project} />
          {fm.project !== '' && fm.project !== exp.project && (
            <Field label="sub-project" value={fm.project} />
          )}
          <Field label="created"><TimestampLocal value={fm.createdAt} variant="long" /></Field>
          <Field label="finished"><TimestampLocal value={fm.finishedAt} variant="long" /></Field>
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
                {fm.tags.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}
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

      {/* v5: 4-section canonical for runs. Motivation is optional (rendered
          only when populated); Method / Conclusion / Caveats are forbidden
          and surface in the warnings banner below if present. */}
      <DetailParseWarningsBanner warnings={exp.parseWarnings ?? []} />
      {exp.sections.motivation && (
        <SectionCard
          id="motivation"
          title="Motivation"
          body={exp.sections.motivation}
          project={project}
        />
      )}
      <SectionCard id="setup" title="Setup" body={exp.sections.setup} project={project} />
      <SectionCard id="result" title="Result" body={exp.sections.result} project={project} />
      {exp.hasReadme && (
        <WarningsCard
          runId={exp.id}
          readmePath={`${exp.path}/README.md`}
          initialWarnings={exp.warnings}
          initialMtime={exp.readmeMtime}
        />
      )}
      <ArtifactsCard artifacts={exp.sections.artifacts} expPath={exp.path} />
      {exp.sections.newHypotheses && (
        <SectionCard
          id="new-hypotheses"
          title="New Hypotheses"
          body={exp.sections.newHypotheses}
          highlight
          project={project}
        />
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

      {exp.hasReadme && <LogViewer expPath={exp.path} />}
        </div>
      </div>
      {isDesktop && exp.hasReadme && (
        <ReadmeSidePanel
          path={`${exp.path}/README.md`}
          runId={exp.id}
        />
      )}
    </div>
  )
}

/**
 * v5: surface run-side parse warnings flagging forbidden sections (Method /
 * Conclusion / Caveats) and any unknown H2 in the README body. Severity-info
 * warnings (empty dangling headings) render with reduced emphasis.
 */
function DetailParseWarningsBanner({
  warnings,
}: {
  warnings: Array<{ message: string; severity?: 'error' | 'warning' | 'info' }>
}) {
  const relevant = warnings.filter((w) =>
    /^(RUN_HAS_METHOD|RUN_HAS_CONCLUSION|RUN_HAS_CAVEATS|UNKNOWN_H2_SECTION|LEGACY_SECTION_IN_RUN)/.test(
      w.message,
    ),
  )
  if (relevant.length === 0) return null
  return (
    <Card className="border-amber-400/60 bg-amber-50/40">
      <CardHeader>
        <CardTitle className="text-sm">Section warnings ({relevant.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="list-disc space-y-1 pl-5 text-xs text-amber-950">
          {relevant.map((w, i) => (
            <li key={i} className={w.severity === 'info' ? 'opacity-70' : ''}>
              {w.message}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function SectionCard({
  id,
  title,
  body,
  highlight,
  project,
}: {
  id: string
  title: string
  body: string | null
  highlight?: boolean
  project: string
}) {
  return (
    <Card id={id} className={highlight ? 'border-amber-400/60' : undefined}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {body ? (
          <Markdown className="text-xs" project={project}>
            {body}
          </Markdown>
        ) : (
          <div className="text-xs italic text-muted-foreground/70">to fill</div>
        )}
      </CardContent>
    </Card>
  )
}

function ArtifactsCard({
  artifacts,
  expPath,
}: {
  artifacts: { path: string; description: string }[]
  expPath: string
}) {
  if (artifacts.length === 0) return null
  return (
    <Card id="artifacts">
      <CardHeader>
        <CardTitle>Artifacts</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1.5 text-xs">
          {artifacts.map((a) => (
            <li key={a.path} className="grid grid-cols-1 gap-x-3 md:grid-cols-2">
              <code className="font-mono text-foreground/80" title={`${expPath}/${a.path}`}>
                {a.path}
              </code>
              <span className="text-muted-foreground">{a.description}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{children}</div>
  )
}

function Field({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>{label}</FieldLabel>
      {children ?? <div className="font-mono text-xs text-foreground truncate">{value}</div>}
    </div>
  )
}
