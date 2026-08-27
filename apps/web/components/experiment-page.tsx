'use client'

// v3 experiment-doc detail page (`/p/<project>/e/<E-id>`). Renders the
// exp doc's body sections + a Runs section with one collapsible panel per
// member run. The `?run=<dir>` query param auto-expands that panel.
//
// Page layout (top to bottom): header, Results, document sections,
// supporting evidence, then Runs. Results is the decision surface; Runs is
// deliberately last because it is the verbose execution detail.

import type { ResultsDocument } from '@memon/core'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, File, Folder, FolderOpen, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  type ExperimentDisplaySection,
  type ExperimentManagedDocumentsPayload,
  type FullExperiment,
  fetchExperiment,
  fetchExperimentDoc,
  fetchExperimentResults,
  fetchRunFiles,
  type MemberRunSummary,
  type ProjectTarget,
  projectQueryKey,
  projectWebPath,
} from '../lib/api'
import { cn } from '../lib/utils'
import { AddNoteButton } from './add-note-button'
import { ArchiveToggle } from './archive-toggle'
import { DocumentArtifactLinkProvider } from './document-artifact-link-provider'
import { EditMarkdownButton } from './edit-markdown-button'
import { ExperimentCodeReviews } from './experiment-code-reviews'
import { ExperimentManagedSection } from './experiment-managed-section'
import { ExperimentResultsTable } from './experiment-results-table'
import { ExperimentStatusEdit } from './experiment-status-edit'
import { LogViewer } from './log-viewer'
import { Markdown } from './markdown'
import { OpenWithButton } from './open-with-button'
import { StatusEdit } from './status-edit'
import { StatusPill } from './status-pill'
import { TimestampLocal } from './timestamp'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'

interface Props {
  project: ProjectTarget
  experimentId: string
  initialOpenRun: string | null
}

export function ExperimentPage({ project, experimentId, initialOpenRun }: Props) {
  const {
    data: exp,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['experiment', ...projectQueryKey(project), experimentId],
    queryFn: () => fetchExperimentDoc(project, experimentId),
  })

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  if (error || !exp) {
    return (
      <div className="p-6 text-sm text-destructive">Failed to load experiment {experimentId}</div>
    )
  }
  if (
    typeof project !== 'string' &&
    (exp.documentSections === undefined ||
      exp.documentDiagnostics === undefined ||
      exp.documentReadOnly === undefined ||
      exp.documents === undefined)
  ) {
    return (
      <div className="p-6 text-sm text-destructive">
        Backend Experiment detail is missing the required v6 managed-document contract. Update the
        selected Host instead of rendering a legacy projection.
      </div>
    )
  }

  const aggregatedArtifacts = exp.memberRuns.flatMap((r) =>
    r.artifacts.map((a) => ({ runId: r.id, path: a.path, description: a.description })),
  )
  const documentSections: ExperimentDisplaySection[] =
    exp.documentSections ?? legacyDocumentSections(exp)
  const resultsSections = documentSections.filter((section) => section.heading === 'Results')
  const nonResultsSections = documentSections.filter((section) => section.heading !== 'Results')
  const inlineDiagnosticKeys = new Set(
    documentSections.flatMap((section) => section.diagnostics.map(diagnosticKey)),
  )
  const remainingDocumentDiagnostics = (exp.documentDiagnostics ?? []).filter(
    (diagnostic) => !inlineDiagnosticKeys.has(diagnosticKey(diagnostic)),
  )

  return (
    <DocumentArtifactLinkProvider
      project={project}
      sourceDocumentPath={exp.path ?? exp.resource}
      sourceSurface="left"
    >
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-baseline flex-wrap gap-2">
            <span className="font-mono text-sm text-muted-foreground">{exp.id}</span>
            {exp.frontMatter.tags.map((t) => (
              <Badge key={t} variant="outline" className="text-[10px]">
                #{t}
              </Badge>
            ))}
          </div>
          <h1 className="text-xl font-semibold">{exp.frontMatter.title}</h1>
          {exp.frontMatter.hypotheses.length > 0 && (
            <div className="flex flex-wrap gap-1 text-xs">
              <span className="text-muted-foreground">Hypotheses:</span>
              {exp.frontMatter.hypotheses.map((h) => (
                <Link key={h} href={projectWebPath(project, '/hypotheses')} className="underline">
                  {h}
                </Link>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <ExperimentStatusEdit
              project={project}
              expId={exp.id}
              status={exp.frontMatter.status}
              archived={exp.frontMatter.archived}
              expectedMtime={exp.readmeMtime}
            />
            <ArchiveToggle
              project={project}
              kind="exp"
              id={exp.id}
              archived={exp.frontMatter.archived}
              expectedMtime={exp.readmeMtime}
            />
            <EditMarkdownButton path={exp.path} target={{ kind: 'exp', id: exp.id, project }} />
            {exp.documentReadOnly && (
              <Badge
                variant="outline"
                className="border-amber-500/50 text-amber-700 dark:text-amber-300"
              >
                compatibility view
              </Badge>
            )}
            <OpenWithButton project={project} scope="exp" slug={exp.id} />
          </div>
        </header>

        {exp.documentReadOnly && (
          <div className="flex gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              This Experiment uses unsupported, incomplete, or conflicting document structure. All
              source sections remain visible below. Metadata and Markdown edits preserve the
              original section body; resolve diagnostics explicitly rather than relying on
              normalization.
            </div>
          </div>
        )}

        {resultsSections.map((section) => (
          <SectionCard
            key={`${section.index}:${section.heading}:${section.occurrence}`}
            section={section}
            project={project}
            experimentId={exp.id}
            documents={exp.documents}
            memberRuns={exp.memberRuns}
            resultsUpdatedAt={exp.resultsUpdatedAt}
          />
        ))}

        <RunParseWarningsBanner warnings={exp.parseWarnings ?? []} />
        <DocumentDiagnosticsBanner diagnostics={remainingDocumentDiagnostics} />
        {nonResultsSections.map((section) => (
          <SectionCard
            key={`${section.index}:${section.heading}:${section.occurrence}`}
            section={section}
            project={project}
            experimentId={exp.id}
            documents={exp.documents}
            memberRuns={exp.memberRuns}
          />
        ))}

        <ExperimentCodeReviews project={project} experimentId={exp.id} />

        <Card>
          <CardHeader>
            <CardTitle>Artifacts</CardTitle>
          </CardHeader>
          <CardContent>
            {aggregatedArtifacts.length === 0 ? (
              <div className="text-xs italic text-muted-foreground">
                none described — runs may still produce files; check the run panel's file listing
              </div>
            ) : (
              <ul className="flex flex-col gap-1 text-xs">
                {aggregatedArtifacts.map((a) => (
                  <li
                    key={`${a.runId}:${a.path}:${a.description}`}
                    className="flex flex-wrap items-baseline gap-1"
                  >
                    <span className="font-mono text-muted-foreground">{a.runId}</span>
                    <code className="font-mono">{a.path}</code>
                    <span className="text-muted-foreground">— {a.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <RunsCard
          project={project}
          experimentId={exp.id}
          initialOpenRun={initialOpenRun}
          memberRuns={exp.memberRuns}
        />
      </div>
    </DocumentArtifactLinkProvider>
  )
}

function SectionCard({
  section,
  project,
  experimentId,
  documents,
  memberRuns,
  resultsUpdatedAt,
}: {
  section: ExperimentDisplaySection
  project: ProjectTarget
  experimentId: string
  documents?: ExperimentManagedDocumentsPayload | null
  memberRuns: MemberRunSummary[]
  resultsUpdatedAt?: string | null
}) {
  const { heading, body } = section
  const managedConflict = section.managed && section.source === 'readme'
  const hasErrors = section.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  const managedKind =
    heading === 'Implementation'
      ? 'implementation'
      : heading === 'Investigation'
        ? 'investigation'
        : null
  const managedDocument = managedKind ? documents?.[managedKind].data : null
  const initialResultsDocument = heading === 'Results' ? documents?.results.data : null
  const [resultsSnapshot, setResultsSnapshot] = useState<{
    document: ResultsDocument
    updatedAt: string | null
  } | null>(() =>
    initialResultsDocument
      ? {
          document: initialResultsDocument,
          updatedAt: resultsUpdatedAt ?? null,
        }
      : null,
  )
  const [resultsRefreshing, setResultsRefreshing] = useState(false)
  const [resultsRefreshError, setResultsRefreshError] = useState<string | null>(null)
  const resultsRefreshInFlight = useRef(false)

  const refreshResults = async () => {
    if (!resultsSnapshot || resultsRefreshInFlight.current) return
    resultsRefreshInFlight.current = true
    setResultsRefreshing(true)
    setResultsRefreshError(null)
    try {
      const next = await fetchExperimentResults(project, experimentId)
      setResultsSnapshot({
        document: next.document,
        updatedAt: next.updatedAt,
      })
    } catch (error) {
      setResultsRefreshError(error instanceof Error ? error.message : 'Results refresh failed')
    } finally {
      resultsRefreshInFlight.current = false
      setResultsRefreshing(false)
    }
  }
  return (
    <Card
      className={cn(
        !section.supported && 'border-amber-500/60 bg-amber-500/[0.04]',
        managedConflict && 'border-destructive/60 bg-destructive/[0.04]',
      )}
      data-supported={section.supported ? 'true' : 'false'}
      data-managed-source={section.managed ? section.source : undefined}
      data-section-heading={heading}
    >
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>{heading}</CardTitle>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {!section.supported && (
            <Badge variant="outline" className="border-amber-500/60">
              Unsupported
            </Badge>
          )}
          {section.managed && section.source === 'yaml' && (
            <Badge variant="secondary">Managed YAML</Badge>
          )}
          {managedConflict && <Badge variant="destructive">Managed section conflict</Badge>}
          {section.occurrence > 1 && (
            <Badge variant="destructive">Duplicate #{section.occurrence}</Badge>
          )}
          {resultsSnapshot && (
            <>
              <ResultsSnapshotStatus
                key={resultsSnapshot.updatedAt ?? 'unknown'}
                updatedAt={resultsSnapshot.updatedAt}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={resultsRefreshing}
                onClick={refreshResults}
                aria-label="Refresh Results"
                data-results-refresh
              >
                <RefreshCw
                  className={cn('size-3.5', resultsRefreshing && 'animate-spin')}
                  aria-hidden
                />
                {resultsRefreshing ? 'Refreshing…' : 'Refresh'}
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {resultsRefreshError && (
          <SectionNotice tone="error">Results refresh failed: {resultsRefreshError}</SectionNotice>
        )}
        {!section.supported && (
          <SectionNotice tone="warning">
            This heading is not supported by the current Experiment schema. Its original content is
            preserved and rendered for compatibility.
          </SectionNotice>
        )}
        {managedConflict && (
          <SectionNotice tone="error">
            This managed section must appear exactly once and contain only its canonical one-line
            YAML pointer. The actual README content is shown below; move it into the managed YAML
            document during migration.
          </SectionNotice>
        )}
        {section.managed && section.source === 'diagnostic' && (
          <SectionNotice tone="error">
            The managed YAML document could not be rendered. Fix the document diagnostics below; the
            README pointer has not been treated as content.
          </SectionNotice>
        )}
        {section.diagnostics.length > 0 && (hasErrors || !section.supported) && (
          <ul className="mb-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {section.diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.code}:${diagnostic.message}`}>
                <code>{diagnostic.code}</code>: {diagnostic.message}
              </li>
            ))}
          </ul>
        )}
        {section.source === 'yaml' && resultsSnapshot ? (
          <ExperimentResultsTable
            document={resultsSnapshot.document}
            project={project}
            experimentId={experimentId}
            memberRuns={memberRuns}
          />
        ) : section.source === 'yaml' && managedKind && managedDocument ? (
          <ExperimentManagedSection
            kind={managedKind}
            document={managedDocument}
            project={project}
            experimentId={experimentId}
          />
        ) : body ? (
          <div className="prose prose-sm max-w-none text-xs/relaxed">
            <Markdown project={project}>{body}</Markdown>
          </div>
        ) : (
          <div className="text-xs italic text-muted-foreground">to fill</div>
        )}
      </CardContent>
    </Card>
  )
}

function ResultsSnapshotStatus({ updatedAt }: { updatedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [])

  return (
    <div
      className="flex h-7 items-center gap-1.5 rounded-md border bg-muted/30 px-2 text-[10px] text-muted-foreground"
      data-results-snapshot-status
      title={updatedAt ? `Results last changed at ${updatedAt}` : 'Results change time unavailable'}
    >
      <span className="whitespace-nowrap">
        Last updated <TimestampLocal value={updatedAt} />
      </span>
      <span aria-hidden>·</span>
      <span className="whitespace-nowrap" data-results-stale-for>
        Stale for {formatResultsAge(updatedAt, now)}
      </span>
    </div>
  )
}

function formatResultsAge(updatedAt: string | null, now: number): string {
  const updatedTime = updatedAt ? new Date(updatedAt).getTime() : Number.NaN
  if (!Number.isFinite(updatedTime)) return 'unknown'
  const elapsedSeconds = Math.max(0, Math.floor((now - updatedTime) / 1_000))
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`
  const minutes = Math.floor(elapsedSeconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function RunsCard({
  project,
  experimentId,
  initialOpenRun,
  memberRuns,
}: {
  project: ProjectTarget
  experimentId: string
  initialOpenRun: string | null
  memberRuns: MemberRunSummary[]
}) {
  return (
    <Card data-section-heading="Runs">
      <CardHeader>
        <CardTitle>
          Runs{' '}
          <span className="font-normal text-sm text-muted-foreground">({memberRuns.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {memberRuns.map((memberRun) => (
          <RunPanel
            key={memberRun.id}
            project={project}
            experimentId={experimentId}
            runId={memberRun.id}
            initialOpenRun={initialOpenRun}
            summary={memberRun}
          />
        ))}
        {memberRuns.length === 0 && (
          <div className="text-xs text-muted-foreground">(no runs bound yet)</div>
        )}
      </CardContent>
    </Card>
  )
}

function DocumentDiagnosticsBanner({
  diagnostics,
}: {
  diagnostics: ExperimentDisplaySection['diagnostics']
}) {
  if (diagnostics.length === 0) return null
  return (
    <Card className="border-destructive/50 bg-destructive/[0.04]">
      <CardHeader>
        <CardTitle>Document diagnostics</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="list-disc space-y-1 pl-5 text-xs">
          {diagnostics.map((diagnostic) => (
            <li key={`${diagnostic.code}:${diagnostic.message}`}>
              <code>{diagnostic.code}</code>: {diagnostic.message}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function diagnosticKey(diagnostic: ExperimentDisplaySection['diagnostics'][number]): string {
  return `${diagnostic.code}\0${diagnostic.file}\0${diagnostic.field ?? ''}\0${diagnostic.message}`
}

function SectionNotice({ tone, children }: { tone: 'warning' | 'error'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'mb-3 rounded-md border px-3 py-2 text-xs',
        tone === 'error'
          ? 'border-destructive/50 bg-destructive/10 text-destructive'
          : 'border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100',
      )}
    >
      {children}
    </div>
  )
}

function legacyDocumentSections(exp: {
  sections: {
    motivation: string | null
    method: string | null
    plan: string | null
    conclusion: string | null
    caveats: string | null
  }
  warningsRaw: string | null
}): ExperimentDisplaySection[] {
  const entries = [
    ['Motivation', exp.sections.motivation],
    ['Method', exp.sections.method],
    ['Plan', exp.sections.plan],
    ['Conclusion', exp.sections.conclusion],
    ['Caveats', exp.sections.caveats],
    ...(exp.warningsRaw ? ([['Warnings', exp.warningsRaw]] as Array<[string, string]>) : []),
  ] as Array<[string, string | null]>
  return entries.map(([heading, body], index) => ({
    heading,
    body: body ?? '',
    rawBody: body ?? '',
    index,
    occurrence: 1,
    // This fallback only exists for stale SSR/test payloads from the old API.
    // Actual v6 detail responses carry Core's supported flag and warnings.
    supported: true,
    managed: false,
    pointerValid: null,
    source: 'readme',
    diagnostics: [],
  }))
}

function RunPanel({
  project,
  experimentId,
  runId,
  initialOpenRun,
  summary,
}: {
  project: ProjectTarget
  experimentId: string
  runId: string
  initialOpenRun: string | null
  summary: MemberRunSummary
}) {
  // Default folded; localStorage remembers per-(exp, run) toggle state.
  // Exception: if URL ?run=<this-run> matches, force open on first paint.
  const storageKey = `memon:exp-page:${projectQueryKey(project).join(':')}:${experimentId}:${runId}:open`
  const [open, setOpen] = useState<boolean>(initialOpenRun === runId)

  useEffect(() => {
    if (initialOpenRun === runId) {
      setOpen(true)
      return
    }
    const stored = localStorage.getItem(storageKey)
    if (stored === '1') setOpen(true)
    if (stored === '0') setOpen(false)
  }, [storageKey, initialOpenRun, runId])

  function setOpenAndPersist(v: boolean) {
    setOpen(v)
    localStorage.setItem(storageKey, v ? '1' : '0')
  }

  return (
    <Collapsible open={open} onOpenChange={setOpenAndPersist} className="rounded-md border bg-card">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full cursor-pointer items-center gap-2 p-2">
          <StatusPill status={summary.status as never} />
          <span className="font-mono text-sm">{runId}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {summary.createdAt.slice(0, 16).replace('T', ' ')}
            {summary.host ? ` • ${summary.host}` : ''}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
        <RunBody project={project} experimentId={experimentId} runId={runId} />
      </CollapsibleContent>
    </Collapsible>
  )
}

function RunBody({
  project,
  experimentId,
  runId,
}: {
  project: ProjectTarget
  experimentId: string
  runId: string
}) {
  const { data: run, isLoading } = useQuery({
    queryKey: ['run', ...projectQueryKey(project), runId],
    queryFn: () => fetchExperiment(project, runId),
  })
  const { data: files } = useQuery({
    queryKey: ['run-files', ...projectQueryKey(project), runId],
    queryFn: () => fetchRunFiles(project, runId, 3),
  })

  if (isLoading || !run) {
    return <div className="border-t p-3 text-xs text-muted-foreground">Loading run details…</div>
  }

  const runSourceDocumentPath = run.path
    ? /\.md$/i.test(run.path)
      ? run.path
      : `${run.path.replace(/\/$/, '')}/README.md`
    : run.resource

  return (
    <DocumentArtifactLinkProvider
      project={project}
      sourceDocumentPath={runSourceDocumentPath}
      sourceSurface="left"
    >
      {/* Action stripe */}
      <div className="flex flex-wrap items-center gap-2 border-t p-3">
        <EditMarkdownButton path={run.path} target={{ kind: 'run', id: runId, project }} />
        <OpenWithButton project={project} scope="run" slug={runId} />
        <AddNoteButton project={project} runId={runId} />
        {run.hasReadme ? (
          <>
            <StatusEdit
              project={project}
              id={runId}
              status={run.frontMatter.status}
              stale={run.stale}
              expectedMtime={run.readmeMtime}
            />
            <ArchiveToggle
              project={project}
              kind="run"
              id={runId}
              archived={run.frontMatter.archived}
              runStatus={run.frontMatter.status}
              expectedMtime={run.readmeMtime}
            />
          </>
        ) : (
          <Badge variant="outline" className="text-[10px]">
            no README
          </Badge>
        )}
        {run.parseErrors.length > 0 && (
          <Badge variant="destructive" className="text-[10px]">
            {run.parseErrors.length} parse errors
          </Badge>
        )}
      </div>
      {/* Frontmatter stripe */}
      <div className="border-t p-3">
        <RunFrontmatterStripe run={run} project={project} />
      </div>
      {/* Body stripe — v5 canonical 4 sections (Motivation optional). */}
      <div className="flex flex-col gap-3 border-t p-3">
        <RunParseWarningsBanner warnings={run.parseWarnings} />
        {run.sections.motivation && (
          <RunSection heading="Motivation" body={run.sections.motivation} project={project} />
        )}
        <RunSection heading="Setup" body={run.sections.setup ?? null} project={project} />
        <RunSection heading="Result" body={run.sections.result ?? null} project={project} />
        <RunArtifactsBlock artifacts={run.sections.artifacts ?? []} />
        {run.hasReadme && (run.resource || run.path) && (
          <LogViewer project={project} runResource={run.resource} expPath={run.path} />
        )}
        {files?.tree.children && files.tree.children.length > 0 && (
          <section>
            <h3 className="mb-1 text-xs font-semibold">
              Files in run dir{' '}
              {files.truncated && <span className="text-muted-foreground">(truncated)</span>}
            </h3>
            <FileTree node={files.tree} />
          </section>
        )}
        <span className="hidden">{experimentId}</span>
      </div>
    </DocumentArtifactLinkProvider>
  )
}

function RunFrontmatterStripe({ run, project }: { run: FullExperiment; project: ProjectTarget }) {
  const fm = run.frontMatter
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs md:grid-cols-4">
      <FmField label="name" value={fm.name} />
      {fm.project && fm.project !== (typeof project === 'string' ? project : project.project) && (
        <FmField label="sub-project" value={fm.project} />
      )}
      <FmField label="created">
        <TimestampLocal value={fm.createdAt} variant="long" />
      </FmField>
      <FmField label="finished">
        <TimestampLocal value={fm.finishedAt} variant="long" />
      </FmField>
      <FmField label="host" value={fm.host ?? '—'} />
      <FmField label="pid" value={fm.pid !== null ? String(fm.pid) : '—'} />
      <FmField label="gpus" value={fm.gpus.length > 0 ? fm.gpus.join(', ') : '—'} />
      <FmField label="entry" value={fm.entry || '—'} />
      <div className="col-span-2 break-all md:col-span-4">
        <FmLabel>command</FmLabel>
        <code className="block rounded bg-muted px-2 py-1 font-mono text-[11px]">
          {fm.command || '—'}
        </code>
      </div>
      {fm.wandb && (
        <div className="col-span-2 md:col-span-4">
          <FmLabel>wandb</FmLabel>
          <a
            className="text-[11px] text-primary underline-offset-4 hover:underline"
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
          <FmLabel>tags</FmLabel>
          <div className="flex flex-wrap gap-1">
            {fm.tags.map((t) => (
              <Badge key={t} variant="outline" className="text-[10px]">
                #{t}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {fm.hypotheses.length > 0 && (
        <div className="col-span-2 md:col-span-4">
          <FmLabel>hypotheses</FmLabel>
          <div className="flex flex-wrap gap-1">
            {fm.hypotheses.map((h) => (
              <Link key={h} href={`${projectWebPath(project, '/hypotheses')}#${h}`}>
                <Badge className="text-[10px]">{h}</Badge>
              </Link>
            ))}
          </div>
        </div>
      )}
    </dl>
  )
}

function FmLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{children}</div>
}

function FmField({
  label,
  value,
  children,
}: {
  label: string
  value?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <FmLabel>{label}</FmLabel>
      {children ?? <div className="truncate font-mono text-[11px] text-foreground">{value}</div>}
    </div>
  )
}

function RunArtifactsBlock({ artifacts }: { artifacts: { path: string; description: string }[] }) {
  if (artifacts.length === 0) return null
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold">Artifacts</h3>
      <ul className="flex flex-col gap-0.5 text-xs">
        {artifacts.map((a) => (
          <li
            key={`${a.path}:${a.description}`}
            className="grid grid-cols-1 gap-x-3 md:grid-cols-2"
          >
            <code className="font-mono text-foreground/80">{a.path}</code>
            <span className="text-muted-foreground">{a.description}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RunSection({
  heading,
  body,
  project,
}: {
  heading: string
  body: string | null
  project: ProjectTarget
}) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold">{heading}</h3>
      {body ? (
        <div className="prose prose-sm max-w-none text-xs/relaxed">
          <Markdown project={project}>{body}</Markdown>
        </div>
      ) : (
        <div className="text-xs italic text-muted-foreground">to fill</div>
      )}
    </section>
  )
}

/**
 * v5: surface run-side parse warnings that flag forbidden sections (Method /
 * Conclusion / Caveats) and any unknown H2 in the README body. Severity-info
 * warnings (empty dangling headings) get a softer treatment; severity-warning
 * gets the destructive variant so they stand out.
 */
function RunParseWarningsBanner({
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
    <section className="rounded border border-amber-300 bg-amber-50 p-2 text-xs">
      <div className="mb-1 font-semibold text-amber-900">Section warnings ({relevant.length})</div>
      <ul className="list-disc space-y-0.5 pl-4 text-amber-950">
        {relevant.map((w) => (
          <li
            key={`${w.severity ?? 'warning'}:${w.message}`}
            className={w.severity === 'info' ? 'opacity-70' : ''}
          >
            {w.message}
          </li>
        ))}
      </ul>
    </section>
  )
}

interface TreeNodeShape {
  type: 'dir' | 'file'
  resource: string
  size?: number
  mtime?: number
  children?: TreeNodeShape[]
}

const COLLAPSE_THRESHOLD = 10
const INDENT_PX = 16

function basename(path: string): string {
  const seg = path.split('/').pop()
  return seg && seg.length > 0 ? seg : path
}

function countDescendants(node: TreeNodeShape): number {
  if (node.type === 'file' || !node.children) return 0
  let n = 0
  for (const c of node.children) {
    n += 1
    n += countDescendants(c)
  }
  return n
}

function FileTree({ node }: { node: TreeNodeShape }) {
  // Per-folder explicit override of the default expand state. Keys are
  // tree-node paths (relative to run dir root). Absent key = use default.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const toggle = (path: string, defaultExpanded: boolean) => {
    setOverrides((prev) => {
      const current = prev[path] ?? defaultExpanded
      return { ...prev, [path]: !current }
    })
  }
  return (
    <ul className="text-xs">
      <FileTreeRow node={node} depth={0} overrides={overrides} onToggle={toggle} />
    </ul>
  )
}

function FileTreeRow({
  node,
  depth,
  overrides,
  onToggle,
}: {
  node: TreeNodeShape
  depth: number
  overrides: Record<string, boolean>
  onToggle: (path: string, defaultExpanded: boolean) => void
}) {
  // Hooks must be called unconditionally at the top of the component;
  // putting useMemo after the file early-return would violate Rules of
  // Hooks if a position swapped between file and dir on a re-render.
  const childCount = useMemo(() => countDescendants(node), [node])
  const isRoot = node.resource === '.'
  const label = isRoot ? '(run dir)' : basename(node.resource)
  if (node.type === 'file') {
    return (
      <li
        className="flex items-center gap-1.5 font-mono"
        style={{ paddingLeft: depth * INDENT_PX }}
      >
        <File className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{label}</span>
      </li>
    )
  }
  const defaultExpanded = isRoot || childCount <= COLLAPSE_THRESHOLD
  const expanded = isRoot ? true : (overrides[node.resource] ?? defaultExpanded)
  const FolderIcon = expanded ? FolderOpen : Folder
  const content = (
    <>
      <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate font-semibold">{label}</span>
      {!isRoot && <span className="text-muted-foreground tabular-nums">({childCount})</span>}
    </>
  )
  return (
    <>
      <li style={{ paddingLeft: depth * INDENT_PX }}>
        {isRoot ? (
          <div className="flex items-center gap-1.5 font-mono">{content}</div>
        ) : (
          <button
            type="button"
            className={cn(
              'flex w-full cursor-pointer select-none items-center gap-1.5 rounded font-mono text-left hover:bg-muted/40',
            )}
            onClick={() => onToggle(node.resource, defaultExpanded)}
          >
            {content}
          </button>
        )}
      </li>
      {expanded &&
        (node.children ?? []).map((c) => (
          <FileTreeRow
            key={c.resource}
            node={c}
            depth={depth + 1}
            overrides={overrides}
            onToggle={onToggle}
          />
        ))}
    </>
  )
}
