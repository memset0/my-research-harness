'use client'
import type { DiscussionQuestion, QuestionMetadata } from '@memon/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  MessagesSquare,
  RefreshCw,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { fetchDiscussion, fetchDiscussions, mutateDiscussion } from '@/lib/api'
import {
  changedDiscussionItems,
  type DiscussionViewState,
  discussionViewState,
  parseDiscussionViewState,
} from '@/lib/discussion-view-state'
import type { DiscussionComparison, DiscussionDetail } from '@/lib/dto/discussions'
import { projectPagePath } from '@/lib/project-routes'
import {
  type ProjectTarget,
  projectHost,
  projectName,
  projectRouteTarget,
} from '@/lib/project-target'
import { queryKeys } from '@/lib/query-keys'
import { handleFragmentClick, scrollFragmentIntoSurface } from '@/lib/scroll-to-fragment'
import { cn } from '@/lib/utils'
import { Markdown } from './markdown'
import { useIsOwner, useSession } from './session-provider'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader } from './ui/card'
import { Checkbox } from './ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'

const DiffViewer = dynamic(() => import('react-diff-viewer-continued').then((m) => m.default), {
  ssr: false,
  loading: () => <p>Loading comparison…</p>,
})
const LABELS: Record<string, string> = {
  OPEN: 'Open',
  ANSWERED: 'Waiting for agent',
  DECIDED: 'Decided',
  REVISED: 'Review changes',
  DEFERRED: 'Deferred',
  DROPPED: 'Dropped',
  INVALID: 'Invalid question',
}
function useSavedState<T>(key: string, initial: T) {
  const [value, setValue] = useState(initial),
    [loaded, setLoaded] = useState(false)
  useEffect(() => {
    try {
      const text = localStorage.getItem(key)
      if (text !== null) setValue(JSON.parse(text))
    } catch {}
    setLoaded(true)
  }, [key])
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch {}
  }, [key, value, loaded])
  return [value, setValue] as const
}
function useChanges(doc: DiscussionDetail | undefined, key: string) {
  const baseline = useRef<{ key: string; state: DiscussionViewState } | null>(null)
  const [changed, setChanged] = useState<string[]>([])
  useEffect(() => {
    if (!doc) return
    let previous = baseline.current?.key === key ? baseline.current.state : null
    if (!previous)
      try {
        previous = parseDiscussionViewState(localStorage.getItem(key))
      } catch {}
    const next = discussionViewState(doc),
      updates = changedDiscussionItems(previous, next)
    baseline.current = { key, state: next }
    setChanged(updates)
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {}
    const timer = updates.length ? window.setTimeout(() => setChanged([]), 3500) : undefined
    return () => {
      if (timer) window.clearTimeout(timer)
    }
  }, [doc, key])
  return changed
}
export function DiscussionsView({ project, id }: { project: ProjectTarget; id?: string }) {
  return id ? (
    <DiscussionPage key={id} project={project} id={id} />
  ) : (
    <DiscussionList project={project} />
  )
}
function DiscussionList({ project }: { project: ProjectTarget }) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.discussions(project),
    queryFn: () => fetchDiscussions(project),
  })
  const [mode, setMode] = useState('OPEN')
  const discussions = data?.discussions ?? []
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8" data-discussion-list>
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <MessagesSquare className="size-6 shrink-0" aria-hidden="true" />
          Discussions
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Questions, feedback and decisions with your agents.
        </p>
      </header>
      <nav className="flex flex-wrap gap-2" aria-label="Discussion views">
        {[
          ['OPEN', 'Open'],
          ['waiting', 'Waiting for you'],
          ['decisions', 'Decisions'],
          ['CLOSED', 'Closed'],
        ].map(([value, label]) => (
          <Button
            key={value}
            variant={mode === value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode(value!)}
          >
            {label}
          </Button>
        ))}
      </nav>
      {isLoading && <p className="text-muted-foreground">Loading discussions…</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error.message}
        </p>
      )}
      {discussions
        .filter((d) =>
          mode === 'CLOSED'
            ? d.status === 'CLOSED'
            : mode === 'decisions'
              ? d.questions.some((q) => q.status === 'DECIDED')
              : d.status === 'OPEN' &&
                (mode !== 'waiting' ||
                  d.questions.some(
                    (q) => q.displayStatus === 'OPEN' || q.displayStatus === 'REVISED',
                  )),
        )
        .map((d) => {
          const href = projectPagePath(projectRouteTarget(project), {
            kind: 'discussion',
            number: Number(d.id.slice(1)),
          })
          const questions =
            mode === 'waiting'
              ? d.questions.filter(
                  (q) => q.displayStatus === 'OPEN' || q.displayStatus === 'REVISED',
                )
              : mode === 'decisions'
                ? d.questions.filter((q) => q.status === 'DECIDED')
                : []
          return (
            <Card key={d.id}>
              <CardHeader className="gap-2">
                <div className="flex items-center justify-between gap-3">
                  <Link href={href} className="font-medium hover:underline">
                    {d.title}
                  </Link>
                  <Badge variant="outline">{d.status}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {d.id} · {d.questions.length} questions ·{' '}
                  {
                    d.questions.filter(
                      (q) => q.displayStatus === 'OPEN' || q.displayStatus === 'REVISED',
                    ).length
                  }{' '}
                  {d.status === 'CLOSED' ? 'unresolved' : 'waiting for you'}
                </p>
              </CardHeader>
              {questions.length > 0 && (
                <CardContent className="space-y-3">
                  {questions.map((q) => (
                    <div key={q.id ?? q.line}>
                      <Link
                        href={`${href}#${q.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {q.title}
                      </Link>
                      {mode === 'decisions' && (
                        <p className="text-sm text-muted-foreground">
                          {formatDecision(q.decision)}
                          {q.rationale ? ` · ${q.rationale}` : ''}
                        </p>
                      )}
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          )
        })}
      {!isLoading &&
        !error &&
        discussions.filter((d) =>
          mode === 'CLOSED'
            ? d.status === 'CLOSED'
            : mode === 'decisions'
              ? d.questions.some((q) => q.status === 'DECIDED')
              : d.status === 'OPEN' &&
                (mode !== 'waiting' ||
                  d.questions.some((q) => ['OPEN', 'REVISED'].includes(q.displayStatus))),
        ).length === 0 && (
          <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
            {mode === 'waiting'
              ? 'Nothing is waiting for your answer.'
              : 'No discussions in this view.'}
          </p>
        )}
    </div>
  )
}
function formatDecision(value: unknown) {
  return Array.isArray(value)
    ? value.join(', ')
    : typeof value === 'boolean'
      ? value
        ? 'Agree'
        : 'Disagree'
      : String(value ?? '')
}
function DiscussionPage({ project, id }: { project: ProjectTarget; id: string }) {
  const queryClient = useQueryClient(),
    owner = useIsOwner(),
    session = useSession()
  const {
    data: doc,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.discussion(project, id),
    queryFn: () => fetchDiscussion(project, id),
  })
  const reader = `${session.role}:${JSON.stringify(session.scopeDocuments ?? [])}`
  const storageKey = `memon:discussion:view:v1:${reader}:${projectHost(project) ?? ''}:${projectName(project)}:${id}`
  const changed = useChanges(doc, storageKey)
  const [category, setCategory] = useSavedState<string>(`${storageKey}:category`, 'all')
  const [status, setStatus] = useSavedState<string>(`${storageKey}:status`, 'all')
  const initialFragment = useRef<string | null>(null)
  useEffect(() => {
    if (!doc || initialFragment.current === storageKey) return
    initialFragment.current = storageKey
    const fragment = window.location.hash.slice(1)
    if (!fragment) return
    try {
      const target = decodeURIComponent(fragment)
      if (!doc.questions.some((q) => (q.metadata?.id ?? `invalid-${q.line}`) === target)) return
      setCategory('all')
      setStatus('all')
      const frame = requestAnimationFrame(() => scrollFragmentIntoSurface(target))
      return () => cancelAnimationFrame(frame)
    } catch {}
  }, [doc, setCategory, setStatus, storageKey])
  const [busy, setBusy] = useState(false)
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.discussion(project, id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.discussions(project) }),
    ])
  }
  const updateStatus = async () => {
    if (!doc) return
    setBusy(true)
    try {
      const next = await mutateDiscussion(project, id, 'status', {
        status: doc.status === 'CLOSED' ? 'OPEN' : 'CLOSED',
        expectedMtime: doc.mtime,
        expectedHash: doc.hash,
      })
      queryClient.setQueryData(queryKeys.discussion(project, id), next)
      await refresh()
    } catch (e) {
      toast.error((e as Error).message)
      await refresh()
    } finally {
      setBusy(false)
    }
  }
  if (isLoading) return <p className="p-8 text-muted-foreground">Loading discussion…</p>
  if (error || !doc)
    return (
      <p role="alert" className="p-8 text-destructive">
        {error?.message ?? 'Discussion unavailable'}
      </p>
    )
  const categories = [
    ...new Set([
      ...doc.categories,
      ...doc.questions.map((q) => q.metadata?.category ?? 'Uncategorized'),
    ]),
  ]
  const matches = (q: DiscussionDetail['questions'][number]) =>
    (category === 'all' || (q.metadata?.category ?? 'Uncategorized') === category) &&
    (status === 'all' || q.displayStatus === status)
  const resourceBaseUrl = `/api/doc-assets/${encodeURIComponent(projectName(project))}/${doc.resource.split('/').slice(0, -1).map(encodeURIComponent).join('/')}?${new URLSearchParams(projectHost(project) ? { host: projectHost(project)! } : {})}`
  const markdownProps = {
    project,
    resourceBaseUrl,
    document: {
      project: projectName(project),
      ...(projectHost(project) ? { host: projectHost(project)! } : {}),
      path: doc.resource,
    },
  }
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 pb-16 md:p-8" data-discussion-page>
      <Link
        href={projectPagePath(projectRouteTarget(project), { kind: 'discussions' })}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Discussions
      </Link>
      <header
        className={cn(
          'space-y-3 rounded-lg',
          changed.includes('@document') && 'discussion-updated',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">{doc.id}</p>
            <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{doc.status}</Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh discussion"
              onClick={() =>
                void queryClient.invalidateQueries({ queryKey: queryKeys.discussion(project, id) })
              }
            >
              <RefreshCw className="size-4" />
            </Button>
            {owner && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void updateStatus()}
              >
                {doc.status === 'CLOSED' ? 'Reopen discussion' : 'Close discussion'}
              </Button>
            )}
          </div>
        </div>
        {doc.status === 'CLOSED' && (
          <p className="text-sm text-muted-foreground">
            This discussion is closed. Unresolved questions and history are preserved.
          </p>
        )}
      </header>
      {(doc.diagnostics.length > 0 || doc.historyDiagnostics.length > 0) && (
        <div role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm">
          {doc.diagnostics.map((d) => (
            <p key={`source-${d.line}-${d.message}`}>
              README line {d.line}: {d.message}
            </p>
          ))}
          {doc.historyDiagnostics.map((d) => (
            <p key={`history-${d.line}-${d.message}`}>
              responses.jsonl line {d.line}: {d.message}
            </p>
          ))}
        </div>
      )}
      <nav aria-label="Question overview" className="space-y-4 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={category === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setCategory('all')}
          >
            All categories
          </Button>
          {categories.map((c) => (
            <Button
              key={c}
              variant={category === c ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setCategory(c)}
            >
              {c}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={status === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setStatus('all')}
          >
            All statuses
          </Button>
          {Object.entries(LABELS)
            .filter(([s]) => doc.questions.some((q) => q.displayStatus === s))
            .map(([s, label]) => (
              <Button
                key={s}
                variant={status === s ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setStatus(s)}
              >
                {label}
              </Button>
            ))}
        </div>
        {categories
          .filter((c) => category === 'all' || c === category)
          .map((c) => (
            <div key={c}>
              <p className="mb-2 text-xs font-medium text-muted-foreground">{c}</p>
              <div className="flex flex-wrap gap-2">
                {doc.questions
                  .filter((q) => (q.metadata?.category ?? 'Uncategorized') === c && matches(q))
                  .map((q) => (
                    <a
                      key={q.metadata?.id ?? q.line}
                      href={`#${q.metadata?.id ?? `invalid-${q.line}`}`}
                      onClick={(event) =>
                        handleFragmentClick(event, `#${q.metadata?.id ?? `invalid-${q.line}`}`)
                      }
                      className="rounded border px-2 py-1 text-sm hover:bg-accent"
                    >
                      {q.title}
                    </a>
                  ))}
              </div>
            </div>
          ))}
      </nav>
      {doc.parts.map((part) =>
        part.type === 'prose' ? (
          <Markdown key={`prose-${part.start}`} {...markdownProps}>
            {part.markdown}
          </Markdown>
        ) : (
          (() => {
            const q = doc.questions[part.index]!
            return (
              <div key={q.metadata?.id ?? `invalid-${q.line}`} hidden={!matches(q)}>
                <QuestionCard
                  q={q}
                  project={project}
                  doc={doc}
                  storageKey={storageKey}
                  markdownProps={markdownProps}
                  changed={changed.includes(q.metadata?.id ?? `invalid-${q.line}`)}
                  onUpdated={refresh}
                />
              </div>
            )
          })()
        ),
      )}
    </div>
  )
}
type MarkdownProps = {
  project: ProjectTarget
  resourceBaseUrl: string
  document: { project: string; host?: string; path: string }
}
export function QuestionCard({
  q,
  project,
  doc,
  storageKey,
  markdownProps,
  changed,
  onUpdated,
}: {
  q: DiscussionDetail['questions'][number]
  project: ProjectTarget
  doc: DiscussionDetail
  storageKey: string
  markdownProps: MarkdownProps
  changed: boolean
  onUpdated: () => Promise<void>
}) {
  const owner = useIsOwner(),
    metadata = q.metadata
  const [expanded, setExpanded] = useSavedState<boolean>(
    `${storageKey}:expanded:${metadata?.id ?? q.line}`,
    q.displayStatus !== 'DECIDED',
  )
  const [followup, setFollowup] = useState(false)
  const [comparisonOpen, setComparisonOpen] = useState(false)
  const comparison = metadata ? doc.comparisons?.[metadata.id] : undefined
  return (
    <Card
      id={metadata?.id ?? `invalid-${q.line}`}
      className={cn('scroll-mt-20 overflow-hidden', changed && 'discussion-updated')}
      data-question-id={metadata?.id}
      data-question-status={q.displayStatus}
    >
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{LABELS[q.displayStatus]}</Badge>
          {metadata && (
            <>
              <span className="text-xs text-muted-foreground">{metadata.id}</span>
              <Badge variant="secondary">{metadata.category}</Badge>
              <span className="text-xs text-muted-foreground">{metadata.type}</span>
            </>
          )}
          {changed && (
            <span role="status" className="text-xs font-medium text-primary">
              Updated
            </span>
          )}
        </div>
        <h2 className="text-lg font-semibold">{q.title}</h2>
      </CardHeader>
      <CardContent className="space-y-5">
        {!metadata ? (
          <p role="alert" className="whitespace-pre-wrap text-sm text-destructive">
            {q.diagnostics.map((d) => `Line ${d.line}: ${d.message}`).join('\n')}
          </p>
        ) : (
          <>
            {q.displayStatus === 'REVISED' && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                <span>
                  This question changed since your latest answer. Please review and confirm again.
                </span>
                <Dialog open={comparisonOpen} onOpenChange={setComparisonOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      View changes
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                      <DialogTitle>Question changes</DialogTitle>
                    </DialogHeader>
                    <Comparison comparison={comparison} />
                  </DialogContent>
                </Dialog>
              </div>
            )}
            {metadata.prefer &&
              (!owner || doc.status !== 'OPEN') &&
              q.displayStatus !== 'DECIDED' && (
                <div className="rounded-lg bg-muted/50 p-3 text-sm">
                  <p className="font-medium">
                    Agent preference: {formatDecision(metadata.prefer.option)}
                  </p>
                  {metadata.prefer.reason && (
                    <Markdown {...markdownProps}>{metadata.prefer.reason}</Markdown>
                  )}
                </div>
              )}
            <Collapsible open={expanded} onOpenChange={setExpanded}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
                  {expanded ? (
                    <ChevronDown className="size-4" />
                  ) : (
                    <ChevronRight className="size-4" />
                  )}
                  Background and evidence
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <Markdown {...markdownProps}>{q.body}</Markdown>
              </CollapsibleContent>
            </Collapsible>
            {q.displayStatus === 'DECIDED' ? (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-sm font-medium">Decided: {formatDecision(metadata.decision)}</p>
                {metadata.rationale && (
                  <Markdown {...markdownProps} className="mt-2 text-sm">
                    {metadata.rationale}
                  </Markdown>
                )}
                {owner && doc.status === 'OPEN' && !followup && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => setFollowup(true)}
                  >
                    Add follow-up
                  </Button>
                )}
              </div>
            ) : null}
            {doc.status === 'OPEN' && owner && (q.displayStatus !== 'DECIDED' || followup) ? (
              <AnswerForm
                key={metadata.id}
                question={metadata}
                q={q}
                project={project}
                discussionId={doc.id}
                markdownProps={markdownProps}
                onUpdated={onUpdated}
              />
            ) : q.displayStatus !== 'DECIDED' && metadata.options?.length ? (
              <div className="space-y-2">
                {metadata.options.map((o) => (
                  <div key={o.id} className="rounded-lg border p-3 text-sm">
                    <p className="font-medium">
                      {o.label}
                      {JSON.stringify(metadata.prefer?.option) === JSON.stringify(o.id)
                        ? ' · Agent preference'
                        : ''}
                    </p>
                    {o.detail && <Markdown {...markdownProps}>{o.detail}</Markdown>}
                  </div>
                ))}
              </div>
            ) : null}
            {q.history.length > 0 && (
              <div className="space-y-3 border-t pt-4">
                <h3 className="flex items-center gap-2 text-sm font-medium">
                  <MessageSquare className="size-4" />
                  History
                </h3>
                {q.history.map((event) => (
                  <div key={event.id ?? JSON.stringify(event)} className="border-l-2 pl-3 text-sm">
                    <p className="mb-1 text-xs text-muted-foreground">
                      {event.by === 'owner' ? 'You' : 'Agent'} · {event.at}
                    </p>
                    {event.type === 'response' ? (
                      <>
                        <p className="font-medium">
                          {formatDecision(
                            event.choice ??
                              event.choices ??
                              event.confirm ??
                              event.text ??
                              'Comment',
                          )}
                        </p>
                        {event.comment && <Markdown {...markdownProps}>{event.comment}</Markdown>}
                      </>
                    ) : event.type === 'reply' ? (
                      <Markdown {...markdownProps}>{event.text}</Markdown>
                    ) : (
                      <p className="text-muted-foreground">
                        <Check className="mr-1 inline size-3.5" />
                        {event.note ?? 'Feedback acknowledged'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
function Comparison({ comparison }: { comparison?: DiscussionComparison }) {
  const { resolvedTheme } = useTheme()
  if (!comparison)
    return (
      <p>
        The original version is unavailable. Review the current question before answering again.
      </p>
    )
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        {comparison.source === 'git'
          ? 'Original recovered from Git history.'
          : comparison.truncated
            ? 'Only a partial original was saved; the comparison is incomplete.'
            : 'Original saved with your response.'}
      </p>
      <DiffViewer
        oldValue={comparison.before || 'Original unavailable'}
        newValue={comparison.after}
        splitView={false}
        useDarkTheme={resolvedTheme === 'dark'}
        leftTitle="When you answered"
        rightTitle="Current version"
      />
    </div>
  )
}
export function AnswerForm({
  question,
  q,
  project,
  discussionId,
  markdownProps,
  onUpdated,
}: {
  question: QuestionMetadata
  q: DiscussionQuestion
  project: ProjectTarget
  discussionId: string
  markdownProps: MarkdownProps
  onUpdated: () => Promise<void>
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [text, setText] = useState(''),
    [comment, setComment] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const request = useRef<{ payload: string; id: string } | null>(null)
  const [snapshot, setSnapshot] = useState(q.snapshot)
  const stale = snapshot !== q.snapshot
  const adopt = () => {
    const v = question.prefer?.option
    if (v === undefined) return
    setSelected(Array.isArray(v) ? v.map(String) : [String(v)])
  }
  const send = async () => {
    const answer: Record<string, unknown> = {}
    if (comment.trim()) answer.comment = comment.trim()
    if (question.type === 'choice' && selected[0]) answer.choice = selected[0]
    if (question.type === 'multi' && selected.length) answer.choices = selected
    if (question.type === 'confirm' && selected[0] !== undefined)
      answer.confirm = selected[0] === 'true'
    if (question.type === 'text' && text.trim()) answer.text = text.trim()
    setBusy(true)
    setError('')
    const payload = JSON.stringify({ question: question.id, snapshot, answer })
    if (request.current?.payload !== payload)
      request.current = {
        payload,
        id:
          globalThis.crypto?.randomUUID?.() ??
          `r${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
      }
    try {
      await mutateDiscussion(project, discussionId, 'responses', {
        question: question.id,
        snapshot,
        answer,
        responseId: request.current.id,
      })
      request.current = null
      setComment('')
      setText('')
      setSelected([])
      toast.success('Answer saved. Waiting for agent.')
      await onUpdated()
    } catch (e) {
      setError((e as Error).message)
      await onUpdated()
    } finally {
      setBusy(false)
    }
  }
  const options =
    question.type === 'confirm'
      ? [
          { id: 'true', label: 'Agree' },
          { id: 'false', label: 'Disagree' },
        ]
      : (question.options ?? [])
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      {question.prefer && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-3 text-sm">
          <div>
            <p className="font-medium">
              Agent preference: {formatDecision(question.prefer.option)}
            </p>
            {question.prefer.reason && (
              <Markdown {...markdownProps}>{question.prefer.reason}</Markdown>
            )}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={adopt}>
            Adopt preference
          </Button>
        </div>
      )}
      {options.length > 0 && (
        <fieldset className="space-y-2" aria-label={`Answer ${question.id}`}>
          {options.map((option) => (
            <div
              key={option.id}
              className={cn(
                'rounded-lg border p-3',
                selected.includes(option.id) && 'border-primary bg-primary/5',
              )}
            >
              {question.type === 'multi' ? (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`${question.id}-${option.id}`}
                    checked={selected.includes(option.id)}
                    onCheckedChange={(checked) =>
                      setSelected((previous) =>
                        checked
                          ? [...previous, option.id]
                          : previous.filter((id) => id !== option.id),
                      )
                    }
                  />
                  <Label htmlFor={`${question.id}-${option.id}`}>{option.label}</Label>
                </div>
              ) : (
                <Button
                  type="button"
                  role="radio"
                  aria-checked={selected.includes(option.id)}
                  variant="ghost"
                  className="h-auto w-full justify-start whitespace-normal px-0 text-left"
                  onClick={() => setSelected([option.id])}
                >
                  {option.label}
                </Button>
              )}
              {'detail' in option && typeof option.detail === 'string' && (
                <Markdown {...markdownProps} className="mt-2 text-sm">
                  {option.detail}
                </Markdown>
              )}
            </div>
          ))}
        </fieldset>
      )}
      {question.type === 'text' && (
        <div className="space-y-2">
          <Label htmlFor={`${question.id}-text`}>Your answer</Label>
          <Textarea
            id={`${question.id}-text`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
          />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor={`${question.id}-comment`}>Comment</Label>
        <Textarea
          id={`${question.id}-comment`}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Add context, ask a question or explain your choice"
          rows={2}
        />
      </div>
      {stale && (
        <div role="alert" className="rounded border p-3 text-sm">
          The question changed while you were answering.
          <Button type="button" variant="link" onClick={() => setSnapshot(q.snapshot)}>
            I have reviewed the current version
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        disabled={busy || stale || (!selected.length && !text.trim() && !comment.trim())}
      >
        {busy ? 'Saving…' : 'Send answer'}
      </Button>
    </form>
  )
}
