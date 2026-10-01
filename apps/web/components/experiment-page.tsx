'use client'

// v3 experiment-doc detail page (`/p/<project>/e/<E-id>`). Renders the
// exp doc's body sections plus a Runs section listing the roster declared by
// the document's own `runs` frontmatter. Nothing about a Run is read until
// its panel is opened; `?run=<dir>` opens that one panel on arrival.
//
// Page layout (top to bottom): header, Results, document sections,
// supporting evidence, then Runs. Results is the decision surface; Runs is
// deliberately last because it is the verbose execution detail.

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, File, Folder, FolderOpen, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  type ExperimentDisplaySection,
  type ExperimentManagedDocumentsPayload,
  type FullExperiment,
  fetchExperiment,
  fetchExperimentDoc,
  fetchRunFiles,
  type ProjectTarget,
  projectHost,
  projectName,
  projectQueryKey,
  projectWebPath,
} from '../lib/api'
import { queryKeys } from '../lib/query-keys'
import { translationSources } from '../lib/translation/sources'
import { cn } from '../lib/utils'
import { ArchiveToggle } from './archive-toggle'
import { BodyTranslation, TranslatedLiteral } from './body-translation'
import { ClampedBlock } from './clamped-block'
import { DocumentArtifactLinkProvider } from './document-artifact-link-provider'
import { EditMarkdownButton } from './edit-markdown-button'
import { ExperimentCodeReviews } from './experiment-code-reviews'
import { ExperimentManagedSection } from './experiment-managed-section'
import { ExperimentResultsTable } from './experiment-results-table'
import { ExperimentStatusEdit } from './experiment-status-edit'
import { ExperimentWikiCitations } from './experiment-wiki-citations'
import { LogViewer } from './log-viewer'
import { ManualRefreshButton } from './manual-refresh-button'
import { Markdown } from './markdown'
import { useResourceHeartbeat } from './resource-heartbeat-provider'
import { StatusEdit } from './status-edit'
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
    queryKey: queryKeys.experiment(project, experimentId),
    queryFn: () => fetchExperimentDoc(project, experimentId),
  })

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  // A failed refresh must not blank a page that already has content: the
  // footer's status carries the error, the document stays readable.
  if (!exp) {
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to load experiment {experimentId}
        {error ? `: ${(error as Error).message}` : ''}
      </div>
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
          </div>
        </header>

        <ExperimentWikiCitations
          key={JSON.stringify([...projectQueryKey(project), exp.id])}
          project={project}
          experimentId={experimentId}
        />

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

        <BodyTranslation
          document={{
            host: projectHost(project) ?? undefined,
            project: projectName(project),
            kind: 'experiment',
            id: exp.id,
          }}
          sources={translationSources('experiment', exp)}
        >
          {resultsSections.map((section) => (
            <SectionCard
              key={`${section.index}:${section.heading}:${section.occurrence}`}
              section={section}
              project={project}
              experimentId={exp.id}
              documentPath={exp.path ?? exp.resource}
              documents={exp.documents}
              runIds={exp.frontMatter.runs}
              deprecatedRuns={exp.deprecatedRuns}
              resultsUpdatedAt={exp.resultsUpdatedAt}
            />
          ))}

          <ExperimentParseWarningsBanner warnings={exp.parseWarnings ?? []} />
          <DocumentDiagnosticsBanner diagnostics={remainingDocumentDiagnostics} />
          {nonResultsSections.map((section) => (
            <SectionCard
              key={`${section.index}:${section.heading}:${section.occurrence}`}
              section={section}
              project={project}
              experimentId={exp.id}
              documentPath={exp.path ?? exp.resource}
              documents={exp.documents}
              runIds={exp.frontMatter.runs}
            />
          ))}
        </BodyTranslation>
        <ExperimentCodeReviews project={project} experimentId={exp.id} />

        <RunsCard
          project={project}
          experimentId={exp.id}
          initialOpenRun={initialOpenRun}
          runIds={exp.frontMatter.runs}
          deprecatedRuns={exp.deprecatedRuns}
        />
      </div>
    </DocumentArtifactLinkProvider>
  )
}

// Collapsed height budgets for the top-level section cards, in lines of the
// content's own line-height (see ClampedBlock). Managed Implementation /
// Investigation cards get the larger budget because they are structured,
// denser documents — 10 lines cuts them off mid-first-field, whereas 10 lines
// of ordinary prose is already a readable paragraph.
const SECTION_PROSE_CLAMP_LINES = 10
const SECTION_MANAGED_CLAMP_LINES = 20

function SectionCard({
  section,
  project,
  experimentId,
  documentPath,
  documents,
  runIds,
  deprecatedRuns,
  resultsUpdatedAt,
}: {
  section: ExperimentDisplaySection
  project: ProjectTarget
  experimentId: string
  documentPath?: string
  documents?: ExperimentManagedDocumentsPayload | null
  runIds: string[]
  deprecatedRuns?: string[]
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
  const componentDocument = documentPath
    ? { project: projectName(project), host: projectHost(project) ?? undefined, path: documentPath }
    : undefined
  const resultsDocument = heading === 'Results' ? (documents?.results.data ?? null) : null
  // Results has no fetch, snapshot state or timer of its own: the
  // experiment-doc query owns the payload and the shared foreground heartbeat
  // keeps it current. The button below asks that coordinator to verify now.
  const { refresh, refreshing } = useResourceHeartbeat()
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
        <CardTitle>
          <TranslatedLiteral>{heading}</TranslatedLiteral>
        </CardTitle>
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
          {resultsDocument && (
            <>
              <ResultsSnapshotStatus
                key={resultsUpdatedAt ?? 'unknown'}
                updatedAt={resultsUpdatedAt ?? null}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={refreshing}
                onClick={() => refresh('manual')}
                aria-label="Refresh Results"
                data-results-refresh
              >
                <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} aria-hidden />
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
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
        {section.source === 'yaml' && resultsDocument ? (
          <ExperimentResultsTable
            document={resultsDocument}
            project={project}
            experimentId={experimentId}
            runIds={runIds}
            variantEligibility={documents?.results.variantEligibility}
            deprecatedRuns={deprecatedRuns}
          />
        ) : section.source === 'yaml' && managedKind && managedDocument ? (
          <ClampedBlock lines={SECTION_MANAGED_CLAMP_LINES} label={heading}>
            <ExperimentManagedSection
              kind={managedKind}
              document={managedDocument}
              project={project}
              experimentId={experimentId}
              sourceDocument={componentDocument}
            />
          </ClampedBlock>
        ) : body ? (
          <ClampedBlock lines={SECTION_PROSE_CLAMP_LINES} label={heading}>
            <div className="prose prose-sm max-w-none text-xs/relaxed">
              <Markdown project={project} document={componentDocument}>
                {body}
              </Markdown>
            </div>
          </ClampedBlock>
        ) : (
          <div className="text-xs italic text-muted-foreground">to fill</div>
        )}
      </CardContent>
    </Card>
  )
}

function ResultsSnapshotStatus({ updatedAt }: { updatedAt: string | null }) {
  // Age advances with the shared foreground heartbeat rather than a per-card
  // second timer; it stops moving when the tab is not in front, which is
  // exactly when nothing is being checked either.
  const { tick } = useResourceHeartbeat()
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the heartbeat clock that refreshes now
  const now = useMemo(() => Date.now(), [tick])

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
  runIds,
  deprecatedRuns,
}: {
  project: ProjectTarget
  experimentId: string
  initialOpenRun: string | null
  /** Roster exactly as declared by the Experiment's `runs` frontmatter. */
  runIds: string[]
  deprecatedRuns: string[]
}) {
  const [includeDeprecated, setIncludeDeprecated] = useState(false)
  const excluded = useMemo(() => new Set(deprecatedRuns), [deprecatedRuns])
  const visibleRunIds = includeDeprecated
    ? runIds
    : runIds.filter((id) => !excluded.has(id) || id === initialOpenRun)
  return (
    <Card data-section-heading="Runs">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>
          Runs{' '}
          <span className="font-normal text-sm text-muted-foreground">
            ({visibleRunIds.length})
          </span>
        </CardTitle>
        {excluded.size > 0 && (
          <Button
            variant="outline"
            size="sm"
            aria-pressed={includeDeprecated}
            onClick={() => setIncludeDeprecated((value) => !value)}
          >
            {includeDeprecated ? 'Hide deprecated' : `Show deprecated (${excluded.size})`}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {visibleRunIds.map((runId) => (
          <RunPanel
            key={runId}
            project={project}
            experimentId={experimentId}
            runId={runId}
            initialOpenRun={initialOpenRun}
          />
        ))}
        {visibleRunIds.length === 0 && (
          <div className="text-xs text-muted-foreground">
            {runIds.length === 0 ? '(no runs bound yet)' : '(all bound runs are deprecated)'}
          </div>
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
}: {
  project: ProjectTarget
  experimentId: string
  runId: string
  initialOpenRun: string | null
}) {
  // Folded by default, and a folded panel reads nothing: the collapsed row
  // shows only the declared Run id, and `RunBody` — which owns every Run
  // fetch, the log reader and the file tree — is mounted solely while open.
  // Only an explicit `?run=<this-run>` counts as a request to open it. The
  // toggle is deliberately not persisted: remembering it would silently
  // reintroduce eager Run reads on the next visit.
  const [open, setOpen] = useState<boolean>(initialOpenRun === runId)

  useEffect(() => {
    // Same-page navigation to `?run=<this-run>` (e.g. a Results run link)
    // is a fresh request to open; it never folds a panel the user opened.
    if (initialOpenRun === runId) setOpen(true)
  }, [initialOpenRun, runId])

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border bg-card">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full cursor-pointer items-center gap-2 p-2">
          <span className="font-mono text-sm">{runId}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {open ? 'hide details' : 'show details'}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
        {open && <RunBody project={project} experimentId={experimentId} runId={runId} />}
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
  const {
    data: run,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.run(project, runId),
    queryFn: () => fetchExperiment(project, runId),
  })
  const { data: files } = useQuery({
    queryKey: queryKeys.runFiles(project, runId),
    queryFn: () => fetchRunFiles(project, runId, 3),
  })

  // A declared member id is not proof the Run exists: the roster comes from
  // this Experiment's frontmatter alone. A missing or unreadable Run says so
  // instead of spinning forever on "Loading run details…".
  if (error || (!isLoading && !run)) {
    return (
      <div className="border-t p-3">
        <SectionNotice tone="error">
          Run <code className="font-mono">{runId}</code> is declared by this Experiment but could
          not be read{error ? `: ${(error as Error).message}` : ''}. Fix the Run document or unlink
          the id from this Experiment's <code>runs</code> list.
        </SectionNotice>
      </div>
    )
  }
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
        <ManualRefreshButton
          label="Reload this run from disk"
          queryKeys={[queryKeys.run(project, runId), queryKeys.runFiles(project, runId)]}
        />
        {run.frontMatter.deprecated && (
          <Badge variant="outline">deprecated — excluded from research</Badge>
        )}
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
      {/* Render the actual optional body, including uncategorized legacy content. */}
      <div className="flex flex-col gap-3 border-t p-3">
        {run.body.trim() && runSourceDocumentPath && (
          <Markdown
            project={project}
            document={{
              project: projectName(project),
              host: projectHost(project) ?? undefined,
              path: runSourceDocumentPath,
            }}
          >
            {run.body}
          </Markdown>
        )}
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

/** Experiment documents retain their schema-defined section diagnostics. */
function ExperimentParseWarningsBanner({
  warnings,
}: {
  warnings: Array<{ message: string; severity?: 'error' | 'warning' | 'info' }>
}) {
  const relevant = warnings.filter((w) => w.message.startsWith('UNKNOWN_H2_SECTION'))
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
