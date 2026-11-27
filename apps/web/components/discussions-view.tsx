'use client'
import type { DiscussionQuestion, QuestionMetadata } from '@memon/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  CheckCheck,
  ChevronRight,
  Circle,
  CircleDot,
  CircleMinus,
  FileText,
  GitCompare,
  Hammer,
  Lock,
  MessageSquare,
  MessagesSquare,
  RefreshCw,
  Sparkles,
  Target,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { fetchDiscussion, fetchDiscussions, mutateDiscussion } from '@/lib/api'
import {
  changedDiscussionItems,
  type DiscussionViewState,
  discussionViewState,
  parseDiscussionViewState,
} from '@/lib/discussion-view-state'
import type { DiscussionComparison, DiscussionDetail } from '@/lib/dto/discussions'
import { projectPagePath, reportPath } from '@/lib/project-routes'
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
import { Alert, AlertAction, AlertDescription, AlertTitle } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Checkbox } from './ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from './ui/item'
import { Label } from './ui/label'
import { Progress } from './ui/progress'
import { RadioGroup, RadioGroupItem } from './ui/radio-group'
import { Separator } from './ui/separator'
import { Tabs, TabsList, TabsTrigger } from './ui/tabs'
import { Textarea } from './ui/textarea'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

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
const WORK_LABELS: Record<string, string> = {
  TODO: 'To build',
  DOING: 'In progress',
  DONE: 'Done',
  SKIP: 'Nothing to build',
}
function WorkIcon({ work }: { work: string }) {
  if (work === 'DONE') return <CheckCheck aria-hidden="true" />
  if (work === 'DOING') return <Hammer aria-hidden="true" />
  if (work === 'SKIP') return <CircleMinus aria-hidden="true" />
  return <Circle aria-hidden="true" />
}
type DiscussionProgressCounts = DiscussionDetail['progress']
/** Settled and completed as two native progress bars, plus the remaining buckets in words. */
function GoalProgress({ progress }: { progress: DiscussionProgressCounts }) {
  if (progress.counted === 0) return null
  const percent = (n: number) => Math.round((n / progress.counted) * 100)
  const rest = [
    progress.awaitingAgent && `${progress.awaitingAgent} awaiting agent`,
    progress.awaitingWork && `${progress.awaitingWork} to build`,
    progress.otherUnsettled && `${progress.otherUnsettled} other open`,
    progress.deferred && `${progress.deferred} deferred`,
  ].filter(Boolean)
  return (
    <section aria-label="Goal progress" className="space-y-1.5" data-discussion-progress>
      <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {(
          [
            ['Settled', progress.settled],
            ['Done', progress.completed],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="space-y-1">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium">{label}</span>
              <span className="font-mono text-muted-foreground tabular-nums">
                {value}/{progress.counted}
              </span>
            </div>
            <Progress
              value={percent(value)}
              aria-label={`${label} ${value} of ${progress.counted}`}
            />
          </div>
        ))}
      </div>
      {(rest.length > 0 || progress.waitingOwner > 0) && (
        <p className="text-xs text-muted-foreground">
          {progress.waitingOwner > 0 && (
            <Badge className="mr-1.5 h-4 px-1.5 tabular-nums">
              {progress.waitingOwner} waiting for you
            </Badge>
          )}
          {rest.join(' · ')}
        </p>
      )}
    </section>
  )
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
const VIEWS = [
  ['OPEN', 'Open'],
  ['waiting', 'Waiting for you'],
  ['decisions', 'Decisions'],
  ['CLOSED', 'Closed'],
] as const
type DiscussionSummary = Awaited<ReturnType<typeof fetchDiscussions>>['discussions'][number]
const waitingQuestion = (q: DiscussionSummary['questions'][number]) => q.segment === 'waitingOwner'
function inView(d: DiscussionSummary, mode: string) {
  return mode === 'CLOSED'
    ? d.status === 'CLOSED'
    : mode === 'decisions'
      ? d.questions.some((q) => q.status === 'DECIDED')
      : d.status === 'OPEN' && (mode !== 'waiting' || d.questions.some(waitingQuestion))
}
function DiscussionList({ project }: { project: ProjectTarget }) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.discussions(project),
    queryFn: () => fetchDiscussions(project),
  })
  const [mode, setMode] = useState('OPEN')
  const discussions = data?.discussions ?? []
  const visible = discussions.filter((d) => inView(d, mode))
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 md:px-6" data-discussion-list>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <MessagesSquare className="size-5 shrink-0" aria-hidden="true" />
          Discussions
        </h1>
        <p className="text-xs text-muted-foreground">
          Questions, feedback and decisions with your agents.
        </p>
      </header>
      <Tabs value={mode} onValueChange={setMode}>
        <TabsList aria-label="Discussion views">
          {VIEWS.map(([value, label]) => {
            const count = discussions.filter((d) => inView(d, value)).length
            return (
              <TabsTrigger key={value} value={value}>
                {label}
                {count > 0 && (
                  <Badge variant="secondary" className="h-4 min-w-4 px-1 tabular-nums">
                    {count}
                  </Badge>
                )}
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>
      {isLoading && <p className="text-xs text-muted-foreground">Loading discussions…</p>}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      {visible.length > 0 && (
        <ItemGroup className="rounded-lg border bg-card">
          {visible.map((d, index) => {
            const href = projectPagePath(projectRouteTarget(project), {
              kind: 'discussion',
              number: Number(d.id.slice(1)),
            })
            const waiting =
              d.status === 'CLOSED'
                ? d.questions.filter(
                    (q) =>
                      q.type !== 'subgoal' &&
                      (q.displayStatus === 'OPEN' || q.displayStatus === 'REVISED'),
                  )
                : d.questions.filter(waitingQuestion)
            const decided = d.questions.filter((q) => q.status === 'DECIDED')
            const questions = mode === 'waiting' ? waiting : mode === 'decisions' ? decided : []
            return (
              <div key={d.id}>
                {index > 0 && <ItemSeparator className="my-0" />}
                <Item size="sm" className="rounded-none">
                  <ItemContent className="min-w-0">
                    <ItemTitle className="w-full">
                      <Link href={href} className="truncate hover:underline">
                        {d.title}
                      </Link>
                    </ItemTitle>
                    {d.goal && <ItemDescription className="w-full">{d.goal}</ItemDescription>}
                    <ItemDescription className="font-mono">
                      {d.id} · settled {d.progress.settled}/{d.progress.counted} · done{' '}
                      {d.progress.completed}/{d.progress.counted}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    {waiting.length > 0 && (
                      <Badge>
                        {waiting.length} {d.status === 'CLOSED' ? 'unresolved' : 'waiting'}
                      </Badge>
                    )}
                    <Badge variant="outline">{d.status}</Badge>
                  </ItemActions>
                  {questions.length > 0 && (
                    <ul className="basis-full space-y-1 border-l pl-3">
                      {questions.map((q) => (
                        <li key={q.id ?? q.line} className="text-xs">
                          <Link href={`${href}#${q.id}`} className="font-medium hover:underline">
                            {q.title}
                          </Link>
                          {mode === 'decisions' && (
                            <span className="text-muted-foreground">
                              {' '}
                              → {formatDecision(q.decision)}
                              {q.rationale ? ` · ${q.rationale}` : ''}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Item>
              </div>
            )
          })}
        </ItemGroup>
      )}
      {!isLoading && !error && visible.length === 0 && (
        <Empty className="border border-dashed py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessagesSquare />
            </EmptyMedia>
            <EmptyTitle>
              {mode === 'waiting'
                ? 'Nothing is waiting for your answer.'
                : 'No discussions in this view.'}
            </EmptyTitle>
            <EmptyDescription>
              Agents publish discussions here when they need your input.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
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
  const [work, setWork] = useSavedState<string>(`${storageKey}:work`, 'all')
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
      setWork('all')
      const frame = requestAnimationFrame(() => scrollFragmentIntoSurface(target))
      return () => cancelAnimationFrame(frame)
    } catch {}
  }, [doc, setCategory, setStatus, setWork, storageKey])
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
  if (isLoading) return <p className="p-6 text-xs text-muted-foreground">Loading discussion…</p>
  if (error || !doc)
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertDescription>{error?.message ?? 'Discussion unavailable'}</AlertDescription>
        </Alert>
      </div>
    )
  const categories = [
    ...new Set([
      ...doc.categories,
      ...doc.questions.map((q) => q.metadata?.category ?? 'Uncategorized'),
    ]),
  ]
  const matches = (q: DiscussionDetail['questions'][number]) =>
    (category === 'all' || (q.metadata?.category ?? 'Uncategorized') === category) &&
    (status === 'all' || q.displayStatus === status) &&
    (work === 'all' || q.segment === work)
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
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 pb-16 md:px-6" data-discussion-page>
      <header
        className={cn(
          'space-y-2 rounded-lg',
          changed.includes('@document') && 'discussion-updated',
        )}
      >
        <Button variant="link" size="sm" className="h-auto px-0 text-muted-foreground" asChild>
          <Link href={projectPagePath(projectRouteTarget(project), { kind: 'discussions' })}>
            <ArrowLeft />
            Discussions
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 flex-1 text-lg font-semibold tracking-tight">
            <span className="mr-2 font-mono text-xs font-normal text-muted-foreground">
              {doc.id}
            </span>
            {doc.title}
          </h1>
          <Badge variant="outline">{doc.status}</Badge>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh discussion"
            onClick={() =>
              void queryClient.invalidateQueries({ queryKey: queryKeys.discussion(project, id) })
            }
          >
            <RefreshCw />
          </Button>
          {owner && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void updateStatus()}>
              {doc.status === 'CLOSED' ? 'Reopen discussion' : 'Close discussion'}
            </Button>
          )}
        </div>
        {doc.goal && (
          <p
            className="flex items-start gap-1.5 text-sm text-muted-foreground"
            data-discussion-goal
          >
            <Target className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="sr-only">Goal: </span>
              {doc.goal}
            </span>
          </p>
        )}
        <GoalProgress progress={doc.progress} />
        {doc.status === 'CLOSED' && (
          <Alert>
            <Lock />
            <AlertDescription>
              This discussion is closed. Unresolved questions and history are preserved.
            </AlertDescription>
          </Alert>
        )}
      </header>
      {(doc.diagnostics.length > 0 || doc.historyDiagnostics.length > 0) && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Source diagnostics</AlertTitle>
          <AlertDescription>
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
          </AlertDescription>
        </Alert>
      )}
      <nav aria-label="Question overview">
        <Card size="sm">
          <CardContent className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={category}
                onValueChange={(value) => value && setCategory(value)}
                aria-label="Filter by category"
                className="flex-wrap"
              >
                <ToggleGroupItem value="all">All categories</ToggleGroupItem>
                {categories.map((c) => (
                  <ToggleGroupItem key={c} value={c}>
                    {c}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Separator orientation="vertical" className="h-4 data-vertical:self-center" />
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={status}
                onValueChange={(value) => value && setStatus(value)}
                aria-label="Filter by status"
                className="flex-wrap"
              >
                <ToggleGroupItem value="all">All statuses</ToggleGroupItem>
                {Object.entries(LABELS)
                  .filter(([s]) => doc.questions.some((q) => q.displayStatus === s))
                  .map(([s, label]) => (
                    <ToggleGroupItem key={s} value={s}>
                      {label}
                    </ToggleGroupItem>
                  ))}
              </ToggleGroup>
              <Separator orientation="vertical" className="h-4 data-vertical:self-center" />
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={work}
                onValueChange={(value) => value && setWork(value)}
                aria-label="Filter by work"
                className="flex-wrap"
              >
                <ToggleGroupItem value="all">All work</ToggleGroupItem>
                <ToggleGroupItem value="awaitingWork">To build</ToggleGroupItem>
                <ToggleGroupItem value="completed">Done</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <Separator />
            {categories
              .filter((c) => category === 'all' || c === category)
              .map((c) => {
                const items = doc.questions.filter(
                  (q) => (q.metadata?.category ?? 'Uncategorized') === c && matches(q),
                )
                if (items.length === 0) return null
                return (
                  <div key={c} className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-xs font-medium text-muted-foreground">{c}</span>
                    {items.map((q) => {
                      const anchor = `#${q.metadata?.id ?? `invalid-${q.line}`}`
                      return (
                        <Badge
                          key={q.metadata?.id ?? q.line}
                          variant={q.displayStatus === 'DECIDED' ? 'secondary' : 'outline'}
                          className="h-auto max-w-full py-0.5 whitespace-normal"
                          asChild
                        >
                          <a href={anchor} onClick={(event) => handleFragmentClick(event, anchor)}>
                            <StatusIcon status={q.displayStatus} />
                            {q.title}
                          </a>
                        </Badge>
                      )
                    })}
                  </div>
                )
              })}
          </CardContent>
        </Card>
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
function StatusIcon({ status }: { status: string }) {
  if (status === 'DECIDED') return <Check aria-hidden="true" />
  if (status === 'INVALID') return <AlertTriangle aria-hidden="true" />
  if (status === 'REVISED') return <GitCompare aria-hidden="true" />
  return <CircleDot aria-hidden="true" />
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
      size="sm"
      id={metadata?.id ?? `invalid-${q.line}`}
      className={cn('scroll-mt-20', changed && 'discussion-updated')}
      data-question-id={metadata?.id}
      data-question-status={q.displayStatus}
    >
      <CardHeader>
        <CardTitle className="text-sm font-semibold">
          <h2>{q.title}</h2>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
          <Badge variant={q.displayStatus === 'DECIDED' ? 'secondary' : 'outline'}>
            <StatusIcon status={q.displayStatus} />
            {LABELS[q.displayStatus]}
          </Badge>
          {metadata &&
            (metadata.type === 'subgoal' || metadata.status === 'DECIDED' || metadata.work) && (
              <Badge
                variant={
                  metadata.work === 'DONE' || metadata.work === 'SKIP' ? 'secondary' : 'outline'
                }
                data-question-work={metadata.work ?? 'TODO'}
              >
                <WorkIcon work={metadata.work ?? 'TODO'} />
                {WORK_LABELS[metadata.work ?? 'TODO']}
              </Badge>
            )}
          {metadata?.status === 'DECIDED' && metadata.decided_by === 'agent' && (
            <Badge variant="outline">
              <Bot />
              Agent decided
            </Badge>
          )}
          {metadata && (
            <>
              <Badge variant="secondary">{metadata.category}</Badge>
              <span className="font-mono">{metadata.id}</span>
              <span>· {metadata.type}</span>
            </>
          )}
          {changed && (
            <Badge role="status">
              <Sparkles />
              Updated
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {metadata && <ReportRefs q={q} project={project} />}
        {!metadata ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription className="whitespace-pre-wrap">
              {q.diagnostics.map((d) => `Line ${d.line}: ${d.message}`).join('\n')}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {q.displayStatus === 'REVISED' && (
              <Alert>
                <GitCompare />
                <AlertDescription>
                  This question changed since your latest answer. Please review and confirm again.
                </AlertDescription>
                <AlertAction>
                  <Dialog open={comparisonOpen} onOpenChange={setComparisonOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="xs">
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
                </AlertAction>
              </Alert>
            )}
            {metadata.prefer &&
              (!owner || doc.status !== 'OPEN') &&
              q.displayStatus !== 'DECIDED' && (
                <Alert>
                  <Sparkles />
                  <AlertTitle>
                    Agent preference: {formatDecision(metadata.prefer.option)}
                  </AlertTitle>
                  {metadata.prefer.reason && (
                    <AlertDescription>
                      <Markdown {...markdownProps}>{metadata.prefer.reason}</Markdown>
                    </AlertDescription>
                  )}
                </Alert>
              )}
            {q.displayStatus === 'DECIDED' && (
              <Alert className="bg-muted/50">
                <Check />
                <AlertTitle>Decided: {formatDecision(metadata.decision)}</AlertTitle>
                {metadata.rationale && (
                  <AlertDescription>
                    <Markdown {...markdownProps} className="text-xs">
                      {metadata.rationale}
                    </Markdown>
                  </AlertDescription>
                )}
                {owner && doc.status === 'OPEN' && !followup && (
                  <AlertAction>
                    <Button variant="ghost" size="xs" onClick={() => setFollowup(true)}>
                      Add follow-up
                    </Button>
                  </AlertAction>
                )}
              </Alert>
            )}
            <Collapsible open={expanded} onOpenChange={setExpanded}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="xs"
                  className="-ml-2 text-muted-foreground [&[data-state=open]>svg]:rotate-90"
                >
                  <ChevronRight className="transition-transform" />
                  Background and evidence
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-1">
                <Markdown {...markdownProps}>{q.body}</Markdown>
              </CollapsibleContent>
            </Collapsible>
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
              <ItemGroup className="gap-1.5">
                {metadata.options.map((o) => (
                  <Item key={o.id} variant="outline" size="xs">
                    <ItemContent>
                      <ItemTitle>{o.label}</ItemTitle>
                      {o.detail && (
                        <div className="text-muted-foreground">
                          <Markdown {...markdownProps}>{o.detail}</Markdown>
                        </div>
                      )}
                    </ItemContent>
                    {JSON.stringify(metadata.prefer?.option) === JSON.stringify(o.id) && (
                      <ItemActions>
                        <Badge variant="secondary">Agent preference</Badge>
                      </ItemActions>
                    )}
                  </Item>
                ))}
              </ItemGroup>
            ) : null}
            {q.history.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <MessageSquare className="size-3.5" />
                    History
                  </h3>
                  {q.history.map((event) => (
                    <div
                      key={event.id ?? JSON.stringify(event)}
                      className="border-l-2 pl-3 text-xs"
                    >
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {event.by === 'owner' ? 'You' : 'Agent'}
                        </span>{' '}
                        · {event.at}
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
                          <Check className="mr-1 inline size-3" />
                          {event.note ?? 'Feedback acknowledged'}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
/** Report citations as linked badges; `refs` entries that did not resolve show as warnings. */
function ReportRefs({
  q,
  project,
}: {
  q: DiscussionDetail['questions'][number]
  project: ProjectTarget
}) {
  const label = (r: { report: string; anchor?: string }) =>
    r.anchor ? `${r.report}#${r.anchor}` : r.report
  const resolved = new Set(q.refs.filter((r) => r.source === 'field').map(label))
  const unresolved = (q.metadata?.refs ?? []).filter((entry) => !resolved.has(entry))
  // A Report cited both in `refs` and by a link is one citation to the reader.
  const shown = q.refs.filter(
    (r, index) => q.refs.findIndex((other) => label(other) === label(r)) === index,
  )
  if (!shown.length && !unresolved.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-question-refs>
      <span className="text-xs text-muted-foreground">Reports</span>
      {shown.map((r) => (
        <Badge
          key={label(r)}
          variant="outline"
          className="h-auto max-w-full py-0.5 whitespace-normal"
          asChild
        >
          <Link
            href={`${reportPath(projectRouteTarget(project), r.report)}${r.anchor ? `#${encodeURIComponent(r.anchor)}` : ''}`}
            data-report-ref={r.report}
          >
            <FileText aria-hidden="true" />
            <span className="font-mono">{r.report}</span>
            {r.title}
            {r.anchor && <span className="text-muted-foreground">#{r.anchor}</span>}
          </Link>
        </Badge>
      ))}
      {unresolved.map((entry) => (
        <Badge key={`missing:${entry}`} variant="destructive" title="Not a registered Report">
          <AlertTriangle aria-hidden="true" />
          {entry}
        </Badge>
      ))}
    </div>
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
  const optionItem = (
    option: { id: string; label: string; detail?: string },
    control: ReactNode,
  ) => (
    <Item
      key={option.id}
      variant="outline"
      size="xs"
      className="items-start has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
    >
      {control}
      <ItemContent>
        <Label htmlFor={`${question.id}-${option.id}`} className="text-xs font-medium">
          {option.label}
        </Label>
        {option.detail && (
          <div className="text-muted-foreground">
            <Markdown {...markdownProps} className="text-xs">
              {option.detail}
            </Markdown>
          </div>
        )}
      </ItemContent>
      {JSON.stringify(question.prefer?.option) === JSON.stringify(option.id) && (
        <ItemActions>
          <Badge variant="secondary">Agent preference</Badge>
        </ItemActions>
      )}
    </Item>
  )
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      {question.prefer && (
        <Alert>
          <Sparkles />
          <AlertTitle>Agent preference: {formatDecision(question.prefer.option)}</AlertTitle>
          {question.prefer.reason && (
            <AlertDescription>
              <Markdown {...markdownProps}>{question.prefer.reason}</Markdown>
            </AlertDescription>
          )}
          <AlertAction>
            <Button type="button" variant="outline" size="xs" onClick={adopt}>
              Adopt preference
            </Button>
          </AlertAction>
        </Alert>
      )}
      {options.length > 0 &&
        (question.type === 'multi' ? (
          <fieldset className="grid gap-1.5" aria-label={`Answer ${question.id}`}>
            {options.map((option) =>
              optionItem(
                option,
                <Checkbox
                  id={`${question.id}-${option.id}`}
                  className="mt-0.5"
                  checked={selected.includes(option.id)}
                  onCheckedChange={(checked) =>
                    setSelected((previous) =>
                      checked
                        ? [...previous, option.id]
                        : previous.filter((id) => id !== option.id),
                    )
                  }
                />,
              ),
            )}
          </fieldset>
        ) : (
          <RadioGroup
            className="gap-1.5"
            aria-label={`Answer ${question.id}`}
            value={selected[0] ?? ''}
            onValueChange={(value) => setSelected([value])}
          >
            {options.map((option) =>
              optionItem(
                option,
                <RadioGroupItem
                  id={`${question.id}-${option.id}`}
                  value={option.id}
                  className="mt-0.5"
                />,
              ),
            )}
          </RadioGroup>
        ))}
      {question.type === 'text' && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${question.id}-text`}>Your answer</Label>
          <Textarea
            id={`${question.id}-text`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
          />
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`${question.id}-comment`}>Comment</Label>
        <Textarea
          id={`${question.id}-comment`}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={
            question.type === 'subgoal'
              ? 'Annotate this subgoal or tell the agent what to change'
              : 'Add context, ask a question or explain your choice'
          }
          rows={2}
        />
      </div>
      {stale && (
        <Alert>
          <GitCompare />
          <AlertDescription>The question changed while you were answering.</AlertDescription>
          <AlertAction>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setSnapshot(q.snapshot)}
            >
              I have reviewed the current version
            </Button>
          </AlertAction>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          disabled={busy || stale || (!selected.length && !text.trim() && !comment.trim())}
        >
          {busy ? 'Saving…' : question.type === 'subgoal' ? 'Send feedback' : 'Send answer'}
        </Button>
      </div>
    </form>
  )
}
