'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchExperiment, type FullExperiment } from '../lib/api'
import { Badge, Card, CardContent, CardHeader, CardTitle } from './ui'
import { WarningBadge } from './colored-badge'
import { StatusEdit } from './status-edit'
import { EditReadmeButton } from './edit-readme-button'
import { AddNoteButton } from './add-note-button'
import { AskClaudeCodeButton } from './ask-claude-code-button'
import { DetailSkeleton } from './skeletons'
import { TimestampLocal } from './timestamp'
import { Markdown } from './markdown'
import { LogViewer } from './log-viewer'
import Link from 'next/link'

export function ExperimentDetail({ project, id }: { project: string; id: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['experiment', id],
    queryFn: () => fetchExperiment(id),
  })

  if (isLoading && !data) return <DetailSkeleton />
  if (error) return <div className="p-4 text-sm text-destructive">error: {(error as Error).message}</div>
  if (!data) return null

  const exp: FullExperiment = data
  const fm = exp.frontMatter

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            {exp.hasReadme ? (
              <StatusEdit id={exp.id} status={fm.status} stale={exp.stale} expectedMtime={exp.mtime} />
            ) : (
              <WarningBadge>no README — status edit unavailable</WarningBadge>
            )}
            <CardTitle className="font-mono">{exp.id}</CardTitle>
            {exp.parseErrors.length > 0 && (
              <Badge variant="destructive">{exp.parseErrors.length} parse errors</Badge>
            )}
            {exp.parseWarnings.length > 0 && (
              <WarningBadge>{exp.parseWarnings.length} warnings</WarningBadge>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <AskClaudeCodeButton experiment={exp} />
              <AddNoteButton project={fm.project} experimentId={exp.id} />
              {exp.hasReadme && <EditReadmeButton path={exp.path} experimentId={exp.id} />}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <Field label="name" value={fm.name} />
          <Field label="project" value={fm.project} />
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
                className="text-sm text-primary underline-offset-4 hover:underline"
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

      <SectionCard title="Motivation" body={exp.sections.motivation} />
      <SectionCard title="Setup" body={exp.sections.setup} />
      <SectionCard title="Method" body={exp.sections.method} />
      <SectionCard title="Result" body={exp.sections.result} />
      <SectionCard title="Conclusion" body={exp.sections.conclusion} />
      <SectionCard title="Caveats" body={exp.sections.caveats} />
      <ArtifactsCard artifacts={exp.sections.artifacts} expPath={exp.path} />
      {exp.sections.newHypotheses && (
        <SectionCard title="New Hypotheses" body={exp.sections.newHypotheses} highlight />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Resources</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground italic">
            not yet available — GPU/disk monitoring is a P1 feature
          </div>
        </CardContent>
      </Card>

      {exp.hasReadme && <LogViewer expPath={exp.path} />}
    </div>
  )
}

function SectionCard({ title, body, highlight }: { title: string; body: string | null; highlight?: boolean }) {
  return (
    <Card className={highlight ? 'border-amber-400/60' : undefined}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {body ? (
          <Markdown>{body}</Markdown>
        ) : (
          <div className="text-sm italic text-muted-foreground/70">to fill</div>
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
    <Card>
      <CardHeader>
        <CardTitle>Artifacts</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1.5 text-sm">
          {artifacts.map((a) => (
            <li key={a.path} className="grid grid-cols-1 gap-x-3 md:grid-cols-2">
              <code className="font-mono text-xs text-foreground/80" title={`${expPath}/${a.path}`}>
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
      {children ?? <div className="font-mono text-sm text-foreground truncate">{value}</div>}
    </div>
  )
}
