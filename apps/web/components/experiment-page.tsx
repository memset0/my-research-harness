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
import { useEffect, useState } from 'react'
import {
  fetchExperiment,
  fetchExperimentDoc,
  fetchRunFiles,
  type MemberRunSummary,
} from '../lib/api'
import { Badge } from './ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { StatusPill } from './status-pill'
import { Markdown } from './markdown'
import { EditMarkdownButton } from './edit-markdown-button'
import { OpenClaudeCodeButton } from './open-claude-code-button'

interface Props {
  project: string
  experimentId: string
  initialOpenRun: string | null
}

export function ExperimentPage({ project, experimentId, initialOpenRun }: Props) {
  const { data: exp, isLoading, error } = useQuery({
    queryKey: ['experiment-doc', experimentId],
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
            <Badge key={t} variant="outline" className="text-xs">
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
    <details
      open={open}
      onToggle={(e) => setOpenAndPersist((e.target as HTMLDetailsElement).open)}
      className="rounded-md border bg-card"
    >
      <summary className="flex cursor-pointer items-center gap-2 p-2">
        <StatusPill status={summary.status as never} />
        <span className="font-mono text-sm">{runId}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {summary.createdAt.slice(0, 16).replace('T', ' ')}
          {summary.host ? ` • ${summary.host}` : ''}
        </span>
      </summary>
      {open && <RunBody project={project} experimentId={experimentId} runId={runId} />}
    </details>
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
      <div className="flex flex-wrap gap-2">
        <EditMarkdownButton path={run.path} target={{ kind: 'run', id: runId }} />
        <OpenClaudeCodeButton kind="run" id={runId} projectName={project} />
      </div>
      <div className="text-xs">
        <span className="text-muted-foreground">command:</span>{' '}
        <code className="rounded bg-muted px-1 font-mono">{run.frontMatter.command}</code>
      </div>
      <RunSection heading="Setup" body={run.sections.setup ?? null} />
      <RunSection heading="Result" body={run.sections.result ?? null} />
      {files && files.tree.children && files.tree.children.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold">
            Files in run dir{' '}
            {files.truncated && <span className="text-muted-foreground">(truncated)</span>}
          </h3>
          <FileTree node={files.tree} />
        </section>
      )}
      <div className="flex gap-2 text-xs">
        <Link
          href={`/p/${encodeURIComponent(project)}/experiments/${encodeURIComponent(runId)}`}
          className="rounded border px-2 py-1 hover:bg-muted"
        >
          Open run page (legacy)
        </Link>
      </div>
      <span className="hidden">{experimentId}</span>
    </div>
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

function FileTree({ node, depth = 0 }: { node: TreeNodeShape; depth?: number }) {
  if (node.type === 'file') {
    return (
      <li className="font-mono text-xs">
        <span style={{ paddingLeft: depth * 8 }}>📄 {node.path}</span>
      </li>
    )
  }
  return (
    <ul className="text-xs">
      <li style={{ paddingLeft: depth * 8 }} className="font-semibold">
        📁 {node.path === '.' ? '(run dir)' : node.path}
      </li>
      {(node.children ?? []).map((c, i) => (
        <FileTree key={i} node={c} depth={depth + 1} />
      ))}
    </ul>
  )
}

