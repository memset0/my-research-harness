'use client'

// v3 experiment-doc detail page (`/p/<project>/e/<E-id>`). Renders the
// exp doc's body sections + a Runs section with one collapsible panel per
// member run. The `?run=<dir>` query param auto-expands that panel.

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  fetchExperiment,
  fetchExperimentDoc,
  fetchRunFiles,
  type ExperimentDocDetail,
  type FullExperiment,
} from '../lib/api'
import { Badge } from './ui/badge'
import { StatusPill } from './status-pill'
import { Markdown } from './markdown'

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

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm text-muted-foreground">{exp.id}</span>
          {exp.frontMatter.tags.map((t) => (
            <Badge key={t} variant="outline" className="text-xs">
              #{t}
            </Badge>
          ))}
        </div>
        <h1 className="text-xl font-semibold">{exp.frontMatter.title}</h1>
        {exp.frontMatter.hypotheses.length > 0 && (
          <div className="flex gap-1 text-xs">
            <span className="text-muted-foreground">Hypotheses:</span>
            {exp.frontMatter.hypotheses.map((h) => (
              <Link key={h} href={`/p/${encodeURIComponent(project)}/hypotheses`} className="underline">
                {h}
              </Link>
            ))}
          </div>
        )}
      </header>

      <Section heading="Motivation" body={exp.sections.motivation} />
      <Section heading="Method" body={exp.sections.method} />
      <Section heading="Conclusion" body={exp.sections.conclusion} />
      <Section heading="Caveats" body={exp.sections.caveats} />
      {exp.warningsRaw && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Warnings</h2>
          <div className="prose prose-sm max-w-none">
            <Markdown>{exp.warningsRaw}</Markdown>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">
          Runs <span className="font-normal text-muted-foreground">({exp.memberRuns.length})</span>
        </h2>
        <div className="flex flex-col gap-2">
          {exp.memberRuns.map((mr) => (
            <RunPanel
              key={mr.id}
              project={project}
              experimentId={exp.id}
              runId={mr.id}
              initiallyOpen={initialOpenRun === mr.id || exp.memberRuns.length === 1}
              summary={mr}
            />
          ))}
        </div>
        {exp.memberRuns.length === 0 && (
          <div className="text-xs text-muted-foreground">(no runs bound yet)</div>
        )}
      </section>
    </div>
  )
}

function Section({ heading, body }: { heading: string; body: string | null }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">{heading}</h2>
      {body ? (
        <div className="prose prose-sm max-w-none">
          <Markdown>{body}</Markdown>
        </div>
      ) : (
        <div className="text-xs italic text-muted-foreground">to fill</div>
      )}
    </section>
  )
}

function RunPanel({
  project,
  experimentId,
  runId,
  initiallyOpen,
  summary,
}: {
  project: string
  experimentId: string
  runId: string
  initiallyOpen: boolean
  summary: ExperimentDocDetail['memberRuns'][number]
}) {
  const [open, setOpen] = useState(initiallyOpen)

  // Persist toggle state in localStorage per experiment id.
  const storageKey = `memon:exp-page:${experimentId}:${runId}:open`
  useEffect(() => {
    const stored = localStorage.getItem(storageKey)
    if (stored === '1') setOpen(true)
    if (stored === '0') setOpen(false)
  }, [storageKey])

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
      <div className="text-xs">
        <span className="text-muted-foreground">command:</span>{' '}
        <code className="rounded bg-muted px-1 font-mono">{run.frontMatter.command}</code>
      </div>
      <Section heading="Setup" body={run.sections.setup ?? null} />
      <Section heading="Result" body={run.sections.result ?? null} />
      {run.sections.artifacts.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold">Artifacts (described)</h3>
          <ul className="text-xs">
            {run.sections.artifacts.map((a, i) => (
              <li key={i}>
                <code className="font-mono">{a.path}</code> — {a.description}
              </li>
            ))}
          </ul>
        </section>
      )}
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
      {/* exp scope id is consumed by callers; we don't render it in body */}
      <span className="hidden">{experimentId}</span>
    </div>
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
