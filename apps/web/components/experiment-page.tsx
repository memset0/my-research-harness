'use client'

// v3 experiment-doc detail page (`/p/<project>/e/<E-id>`). Renders the
// exp doc's body sections + a Runs section with one collapsible panel per
// member run. The `?run=<dir>` query param auto-expands that panel.
//
// Page layout (top to bottom):
//   1. Header (id + title + tags + hypotheses)
//   2. Runs section (collapsible panels — default folded)
//   3. Motivation / Method / Conclusion / Caveats (each in a Card)
//   4. Warnings (raw markdown for now)
//   5. Artifacts (aggregated from member runs, grouped by run)

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import {
  fetchExperiment,
  fetchExperimentDoc,
  fetchRunFiles,
  type FullExperiment,
  type MemberRunSummary,
} from '../lib/api'
import { Badge } from './ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { StatusPill } from './status-pill'
import { StatusEdit } from './status-edit'
import { Markdown } from './markdown'
import { EditMarkdownButton } from './edit-markdown-button'
import { OpenClaudeCodeButton } from './open-claude-code-button'
import { TerminalButton } from './terminal-button'
import { AddNoteButton } from './add-note-button'
import { WarningsCard } from './warnings-card'
import { LogViewer } from './log-viewer'
import { TimestampLocal } from './timestamp'
import { cn } from '../lib/utils'

interface Props {
  project: string
  experimentId: string
  initialOpenRun: string | null
}

export function ExperimentPage({ project, experimentId, initialOpenRun }: Props) {
  const { data: exp, isLoading, error } = useQuery({
    queryKey: ['experiment', experimentId],
    queryFn: () => fetchExperimentDoc(experimentId),
  })

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  if (error || !exp) {
    return <div className="p-6 text-sm text-destructive">Failed to load experiment {experimentId}</div>
  }

  const aggregatedArtifacts = exp.memberRuns.flatMap((r) =>
    r.artifacts.map((a) => ({ runId: r.id, path: a.path, description: a.description })),
  )

  return (
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
              <Link key={h} href={`/p/${encodeURIComponent(project)}/hypotheses`} className="underline">
                {h}
              </Link>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <EditMarkdownButton path={exp.path} target={{ kind: 'exp', id: exp.id }} />
          <OpenClaudeCodeButton kind="exp" id={exp.id} projectName={project} />
        </div>
      </header>

      {/* Runs first — it's the most actionable info for the user opening
          this page. Default folded so the long-form prose below is
          immediately visible too. */}
      <Card>
        <CardHeader>
          <CardTitle>
            Runs <span className="font-normal text-sm text-muted-foreground">({exp.memberRuns.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {exp.memberRuns.map((mr) => (
            <RunPanel
              key={mr.id}
              project={project}
              experimentId={exp.id}
              runId={mr.id}
              initialOpenRun={initialOpenRun}
              summary={mr}
            />
          ))}
          {exp.memberRuns.length === 0 && (
            <div className="text-xs text-muted-foreground">(no runs bound yet)</div>
          )}
        </CardContent>
      </Card>

      <SectionCard heading="Motivation" body={exp.sections.motivation} />
      <SectionCard heading="Method" body={exp.sections.method} />
      <SectionCard heading="Conclusion" body={exp.sections.conclusion} />
      <SectionCard heading="Caveats" body={exp.sections.caveats} />

      {exp.warningsRaw && (
        <Card>
          <CardHeader>
            <CardTitle>Warnings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none text-xs/relaxed">
              <Markdown>{exp.warningsRaw}</Markdown>
            </div>
          </CardContent>
        </Card>
      )}

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
              {aggregatedArtifacts.map((a, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-1">
                  <span className="font-mono text-muted-foreground">{a.runId}</span>
                  <code className="font-mono">{a.path}</code>
                  <span className="text-muted-foreground">— {a.description}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SectionCard({ heading, body }: { heading: string; body: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{heading}</CardTitle>
      </CardHeader>
      <CardContent>
        {body ? (
          <div className="prose prose-sm max-w-none text-xs/relaxed">
            <Markdown>{body}</Markdown>
          </div>
        ) : (
          <div className="text-xs italic text-muted-foreground">to fill</div>
        )}
      </CardContent>
    </Card>
  )
}

function RunPanel({
  project,
  experimentId,
  runId,
  initialOpenRun,
  summary,
}: {
  project: string
  experimentId: string
  runId: string
  initialOpenRun: string | null
  summary: MemberRunSummary
}) {
  // Default folded; localStorage remembers per-(exp, run) toggle state.
  // Exception: if URL ?run=<this-run> matches, force open on first paint.
  const storageKey = `memon:exp-page:${experimentId}:${runId}:open`
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
    <Collapsible
      open={open}
      onOpenChange={setOpenAndPersist}
      className="rounded-md border bg-card"
    >
      <CollapsibleTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          className="flex cursor-pointer items-center gap-2 p-2"
        >
          <StatusPill status={summary.status as never} />
          <span className="font-mono text-sm">{runId}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {summary.createdAt.slice(0, 16).replace('T', ' ')}
            {summary.host ? ` • ${summary.host}` : ''}
          </span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent
        className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up"
      >
        <RunBody project={project} experimentId={experimentId} runId={runId} />
      </CollapsibleContent>
    </Collapsible>
  )
}

function RunBody({ project, experimentId, runId }: { project: string; experimentId: string; runId: string }) {
  const { data: run, isLoading } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => fetchExperiment(runId),
  })
  const { data: files } = useQuery({
    queryKey: ['run-files', runId],
    queryFn: () => fetchRunFiles(runId, 3),
  })

  if (isLoading || !run) {
    return <div className="border-t p-3 text-xs text-muted-foreground">Loading run details…</div>
  }

  return (
    <div className="flex flex-col gap-3 border-t p-3">
      <RunFrontmatterCard run={run} project={project} />
      <div className="flex flex-wrap gap-2">
        <TerminalButton runId={runId} projectName={project} />
        <AddNoteButton project={project} runId={runId} />
        <EditMarkdownButton path={run.path} target={{ kind: 'run', id: runId }} />
        <OpenClaudeCodeButton kind="run" id={runId} projectName={project} />
      </div>
      <RunSection heading="Setup" body={run.sections.setup ?? null} />
      <RunSection heading="Result" body={run.sections.result ?? null} />
      {run.hasReadme && (
        <WarningsCard
          runId={runId}
          readmePath={`${run.path}/README.md`}
          initialWarnings={run.warnings}
          initialMtime={run.mtime}
        />
      )}
      <RunArtifactsBlock artifacts={run.sections.artifacts ?? []} />
      {run.hasReadme && <LogViewer expPath={run.path} />}
      {files && files.tree.children && files.tree.children.length > 0 && (
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
  )
}

function RunFrontmatterCard({ run, project }: { run: FullExperiment; project: string }) {
  const fm = run.frontMatter
  return (
    <div className="rounded-md border bg-card/40 p-2">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">{run.id}</span>
        {run.hasReadme ? (
          <StatusEdit
            id={run.id}
            status={fm.status}
            stale={run.stale}
            expectedMtime={run.mtime}
          />
        ) : (
          <Badge variant="outline" className="text-[10px]">no README</Badge>
        )}
        {run.parseErrors.length > 0 && (
          <Badge variant="destructive" className="text-[10px]">
            {run.parseErrors.length} parse errors
          </Badge>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs md:grid-cols-4">
        <FmField label="name" value={fm.name} />
        {fm.project && fm.project !== project && (
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
                <Link key={h} href={`/p/${encodeURIComponent(project)}/hypotheses#${h}`}>
                  <Badge className="text-[10px]">{h}</Badge>
                </Link>
              ))}
            </div>
          </div>
        )}
      </dl>
    </div>
  )
}

function FmLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  )
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
      {children ?? (
        <div className="truncate font-mono text-[11px] text-foreground">{value}</div>
      )}
    </div>
  )
}

function RunArtifactsBlock({
  artifacts,
}: {
  artifacts: { path: string; description: string }[]
}) {
  if (artifacts.length === 0) return null
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold">Artifacts</h3>
      <ul className="flex flex-col gap-0.5 text-xs">
        {artifacts.map((a, i) => (
          <li key={i} className="grid grid-cols-1 gap-x-3 md:grid-cols-2">
            <code className="font-mono text-foreground/80">{a.path}</code>
            <span className="text-muted-foreground">{a.description}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RunSection({ heading, body }: { heading: string; body: string | null }) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold">{heading}</h3>
      {body ? (
        <div className="prose prose-sm max-w-none text-xs/relaxed">
          <Markdown>{body}</Markdown>
        </div>
      ) : (
        <div className="text-xs italic text-muted-foreground">to fill</div>
      )}
    </section>
  )
}

interface TreeNodeShape {
  type: 'dir' | 'file'
  path: string
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
      <FileTreeRow
        node={node}
        depth={0}
        overrides={overrides}
        onToggle={toggle}
      />
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
  const isRoot = node.path === '.'
  const label = isRoot ? '(run dir)' : basename(node.path)
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
  const expanded = isRoot ? true : (overrides[node.path] ?? defaultExpanded)
  const Chevron = expanded ? ChevronDown : ChevronRight
  const FolderIcon = expanded ? FolderOpen : Folder
  return (
    <>
      <li
        className={cn(
          'flex items-center gap-1.5 font-mono',
          !isRoot && 'cursor-pointer select-none hover:bg-muted/40 rounded',
        )}
        style={{ paddingLeft: depth * INDENT_PX }}
        onClick={isRoot ? undefined : () => onToggle(node.path, defaultExpanded)}
      >
        {!isRoot && <Chevron className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
        <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate font-semibold">{label}</span>
        {!isRoot && (
          <span className="text-muted-foreground tabular-nums">({childCount})</span>
        )}
      </li>
      {expanded &&
        (node.children ?? []).map((c, i) => (
          <FileTreeRow
            key={i}
            node={c}
            depth={depth + 1}
            overrides={overrides}
            onToggle={onToggle}
          />
        ))}
    </>
  )
}

