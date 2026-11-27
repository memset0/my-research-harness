'use client'

// Owner cluster overview built from stock shadcn components: one dense Table
// per cluster, a collapsible row group per node, and a Timeline column whose
// lanes show each node's availability window, live use and (later) ticket
// tasks. Self-contained so it can move under an admin area unchanged.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, ListTodo, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import {
  barGeometry,
  dayTicks,
  formatSpan,
  type Horizon,
  horizonFor,
  positionPct,
} from '../lib/cluster-timeline'
import { fetchClusterOverview } from '../lib/clusters-api'
import type {
  ClusterGpuDto,
  ClusterGroupDto,
  ClusterNodeDto,
  ClusterOverviewDto,
  ClusterTaskDto,
} from '../lib/dto/clusters'
import { formatRelativeTime } from '../lib/format-relative-time'
import { queryKeys } from '../lib/query-keys'
import { cn } from '../lib/utils'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty'
import { Progress } from './ui/progress'
import { Skeleton } from './ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

const POLL_MS = 60_000
const BADGE = 'h-4 px-1.5 py-0 text-[11px]'
const COLUMNS = 6

interface TimeContext {
  horizon: Horizon
  nowMs: number
}

function Segment({
  left,
  width,
  className,
  tip,
  slot,
  elapsed,
  elapsedClassName,
}: {
  left: number
  width: number
  className: string
  tip: string
  slot?: string
  /** Part of `width` already used, drawn with `elapsedClassName`. */
  elapsed?: number
  elapsedClassName?: string
}) {
  const shown = Math.max(0.6, width)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          data-slot={slot}
          className={cn('absolute inset-y-0 overflow-hidden rounded-sm', className)}
          style={{ left: `${left}%`, width: `${shown}%` }}
        >
          {elapsed !== undefined && elapsed > 0 && (
            <div
              data-slot="task-elapsed"
              className={cn('h-full', elapsedClassName)}
              style={{ width: `${Math.min(100, (elapsed / shown) * 100)}%` }}
            />
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

function Lane({
  node,
  gpu,
  tasks,
  time,
}: {
  node: ClusterNodeDto
  gpu: ClusterGpuDto
  tasks: ClusterTaskDto[]
  time: TimeContext
}) {
  const until = Date.parse(node.available_until)
  const busy = (gpu.processes ?? 0) > 0
  return (
    <div className="relative h-1.5 w-full rounded-sm bg-muted" data-slot="gpu-lane">
      <Segment
        left={0}
        width={positionPct(time.horizon, until)}
        className={gpu.allocatable ? 'bg-primary/20' : 'bg-muted-foreground/20'}
        tip={`${gpu.allocatable ? 'Allocatable' : 'Reserved'} until ${node.available_until}`}
      />
      {tasks
        .filter(
          (task) => task.state === 'RUNNING' && task.gpus.includes(gpu.index) && task.granted_at,
        )
        .map((task) => {
          const start = Date.parse(task.granted_at as string)
          const end = task.expires_at
            ? Date.parse(task.expires_at)
            : start + task.requested_duration_s * 1000
          const bar = barGeometry(time.horizon, start, end, time.nowMs)
          const left = `${formatSpan(end - time.nowMs)} left`
          return (
            <Segment
              key={`${task.id}-${task.granted_at}-${task.gpus.join(',')}`}
              slot={task.redacted ? 'task-bar-occupied' : 'task-bar'}
              left={bar.left}
              width={bar.width}
              elapsed={bar.elapsed}
              className={task.redacted ? 'bg-muted-foreground/40' : 'bg-primary/50'}
              elapsedClassName={task.redacted ? 'bg-muted-foreground/60' : 'bg-primary'}
              tip={
                task.redacted
                  ? `Occupied by another project · ${left}`
                  : `${task.id} · ${task.project}${task.label ? ` · ${task.label}` : ''} · ${left}`
              }
            />
          )
        })}
      {busy && (
        <Segment
          slot="lane-busy"
          left={positionPct(time.horizon, time.nowMs)}
          width={2}
          className="bg-destructive"
          tip={`${gpu.processes} compute process${gpu.processes === 1 ? '' : 'es'} now`}
        />
      )}
    </div>
  )
}

function NodeBadges({ node, nowMs }: { node: ClusterNodeDto; nowMs: number }) {
  const busy = node.gpu_rows.filter((gpu) => (gpu.processes ?? 0) > 0).length
  const state =
    node.state === 'ok' ? (
      <Badge variant="outline" className={BADGE} data-slot="node-state">
        Reachable
      </Badge>
    ) : node.state === 'expired' ? (
      <Badge variant="secondary" className={BADGE} data-slot="node-state">
        Expired
      </Badge>
    ) : (
      <Badge variant="destructive" className={BADGE} data-slot="node-state">
        Unreachable
      </Badge>
    )
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>{state}</TooltipTrigger>
        <TooltipContent>
          via {node.transport}
          {node.probed_at
            ? ` · probed ${formatRelativeTime(node.probed_at, nowMs)}`
            : ' · not probed'}
        </TooltipContent>
      </Tooltip>
      <Badge variant="outline" className={BADGE}>
        {node.gpus ?? node.gpu_rows.length}× {node.gpu_type ?? 'GPU'}
      </Badge>
      <Badge variant="outline" className={BADGE}>
        {node.allocation === 'node' ? 'Whole node' : 'Per GPU'}
      </Badge>
      {busy > 0 && <Badge className={BADGE}>{busy} busy</Badge>}
    </>
  )
}

function NodeExpiry({ node, time }: { node: ClusterNodeDto; time: TimeContext }) {
  if (node.expired) return null
  const until = Date.parse(node.available_until)
  const at = positionPct(time.horizon, until)
  return (
    <div className="relative h-4 w-full">
      <div className="absolute inset-y-0 w-px bg-muted-foreground/60" style={{ left: `${at}%` }} />
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-slot="node-expiry"
            className={cn(
              'absolute top-0 whitespace-nowrap px-1 text-[11px] text-muted-foreground',
              at > 50 && '-translate-x-full',
            )}
            style={{ left: `${at}%` }}
          >
            expires in {formatSpan(until - time.nowMs)}
          </span>
        </TooltipTrigger>
        <TooltipContent>Available until {node.available_until}</TooltipContent>
      </Tooltip>
    </div>
  )
}

function GpuRow({
  node,
  gpu,
  tasks,
  time,
}: {
  node: ClusterNodeDto
  gpu: ClusterGpuDto
  tasks: ClusterTaskDto[]
  time: TimeContext
}) {
  const used = gpu.memory_used_mib
  const total = gpu.memory_total_mib
  return (
    <TableRow data-slot="gpu-row">
      <TableCell className="pl-6">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono">{gpu.index}</span>
          </TooltipTrigger>
          <TooltipContent>{gpu.name ?? node.gpu_type ?? 'GPU'}</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell>
        {used === null || total === null || total === 0 ? (
          '—'
        ) : (
          <div className="flex items-center gap-1.5">
            <Progress value={(used / total) * 100} className="w-16" />
            <span className="tabular-nums text-muted-foreground">
              {(used / 1024).toFixed(0)}/{(total / 1024).toFixed(0)}G
            </span>
          </div>
        )}
      </TableCell>
      <TableCell className="tabular-nums">
        {gpu.utilization_pct === null ? '—' : `${gpu.utilization_pct}%`}
      </TableCell>
      <TableCell>
        <Badge variant={gpu.allocatable ? 'secondary' : 'outline'} className={BADGE}>
          {gpu.allocatable ? 'Allocatable' : 'Reserved'}
        </Badge>
      </TableCell>
      <TableCell>
        {gpu.processes === null ? (
          '—'
        ) : gpu.processes > 0 ? (
          <Badge data-slot="gpu-running" className={BADGE}>
            Busy · {gpu.processes}
          </Badge>
        ) : (
          <Badge variant="outline" className={BADGE}>
            Idle
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <Lane node={node} gpu={gpu} tasks={tasks} time={time} />
      </TableCell>
    </TableRow>
  )
}

function NodeCard({
  node,
  tasks,
  time,
  open,
  setOpen,
}: {
  node: ClusterNodeDto
  tasks: ClusterTaskDto[]
  time: TimeContext
  open: boolean
  setOpen: (open: boolean) => void
}) {
  const nodeTasks = tasks.filter((task) => task.node === node.id)
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card size="sm" data-slot="cluster-node" data-open={open} className="gap-0 py-0">
        <Table className="min-w-[760px] table-fixed [&_td]:px-1.5 [&_td]:py-1 [&_th]:h-7 [&_th]:px-1.5">
          <colgroup>
            <col className="w-14" />
            <col className="w-36" />
            <col className="w-11" />
            <col className="w-24" />
            <col className="w-20" />
            <col />
          </colgroup>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead colSpan={COLUMNS - 1} className="font-normal">
                <div className="flex items-center gap-1 whitespace-nowrap">
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-1 h-5 gap-0.5 px-1 font-mono text-xs"
                    >
                      <ChevronRight
                        className={cn('size-3 transition-transform', open && 'rotate-90')}
                      />
                      {node.id}
                    </Button>
                  </CollapsibleTrigger>
                  <NodeBadges node={node} nowMs={time.nowMs} />
                </div>
              </TableHead>
              <TableHead className="font-normal">
                <NodeExpiry node={node} time={time} />
              </TableHead>
            </TableRow>
            {open && (
              <TableRow>
                <TableHead className="pl-6">GPU</TableHead>
                <TableHead>Memory</TableHead>
                <TableHead>Util</TableHead>
                <TableHead>Allocatable</TableHead>
                <TableHead>Now</TableHead>
                <TableHead>
                  <TimeAxis horizon={time.horizon} nowMs={time.nowMs} />
                </TableHead>
              </TableRow>
            )}
          </TableHeader>
          {open && (
            <TableBody>
              {node.error && (
                <TableRow>
                  <TableCell colSpan={COLUMNS} className="pl-6">
                    <Alert variant="destructive" className="px-2 py-0.5">
                      <AlertDescription className="text-xs">{node.error}</AlertDescription>
                    </Alert>
                  </TableCell>
                </TableRow>
              )}
              {node.gpu_rows.map((gpu) => (
                <GpuRow key={gpu.index} node={node} gpu={gpu} tasks={nodeTasks} time={time} />
              ))}
            </TableBody>
          )}
        </Table>
      </Card>
    </Collapsible>
  )
}

function TimeAxis({ horizon, nowMs }: { horizon: Horizon; nowMs: number }) {
  return (
    <div className="relative h-4 w-full font-normal" data-slot="time-axis">
      <span className="absolute" style={{ left: `${positionPct(horizon, nowMs)}%` }}>
        now
      </span>
      {dayTicks(horizon, nowMs).map((tick) => (
        <span
          key={tick}
          className="absolute -translate-x-full"
          style={{ left: `${positionPct(horizon, tick)}%` }}
        >
          +{formatSpan(tick - nowMs)}
        </span>
      ))}
    </div>
  )
}

function ClusterSection({
  group,
  tasks,
  time,
  isOpen,
  setOpen,
}: {
  group: ClusterGroupDto
  tasks: ClusterTaskDto[]
  time: TimeContext
  isOpen: (node: ClusterNodeDto) => boolean
  setOpen: (id: string, open: boolean) => void
}) {
  return (
    <section data-slot="cluster-group" className="flex flex-col gap-1.5">
      <h2 className="text-xs font-medium">
        {group.cluster}{' '}
        <span className="font-normal text-muted-foreground">
          · {group.nodes.length} node{group.nodes.length === 1 ? '' : 's'}
        </span>
      </h2>
      {group.nodes.map((node) => (
        <NodeCard
          key={node.id}
          node={node}
          tasks={tasks}
          time={time}
          open={isOpen(node)}
          setOpen={(open) => setOpen(node.id, open)}
        />
      ))}
    </section>
  )
}

const STATUS_VARIANT = {
  GRANTED: 'default',
  QUEUED: 'outline',
  RELEASED: 'secondary',
  EXPIRED: 'secondary',
  FAILED: 'destructive',
} as const

function shortTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const SYNC_TEXT: Record<string, string> = {
  PULLING: 'pulling',
  READY: 'synced',
  PULL_FAILED: 'pull failed',
  PUSHING: 'pushing',
  PUSHED: 'pushed',
  NOTHING_TO_PUSH: 'nothing to push',
  PUSH_FAILED: 'push failed',
}

/** Checkout pull / Run push state of a ticket; failures stand out, details in the tooltip. */
function SyncBadge({
  label,
  state,
  output,
}: {
  label: string
  state: string | undefined
  output: string | null | undefined
}) {
  if (!state) return null
  const failed = state.endsWith('FAILED')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={failed ? 'destructive' : 'outline'}
          className={cn(BADGE, 'ml-1')}
          data-slot={`ticket-${label}`}
          data-state={state}
        >
          {SYNC_TEXT[state] ?? state}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-md whitespace-pre-wrap font-mono text-xs">
        {output || `${label}: ${SYNC_TEXT[state] ?? state}`}
      </TooltipContent>
    </Tooltip>
  )
}

function TicketRow({ task, nowMs }: { task: ClusterTaskDto; nowMs: number }) {
  const ends = task.expires_at ? Date.parse(task.expires_at) : null
  return (
    <TableRow data-slot="ticket-row" data-status={task.status}>
      <TableCell className="font-mono">
        {task.id}
        {task.label && <span className="ml-1 font-sans text-muted-foreground">{task.label}</span>}
      </TableCell>
      <TableCell className="truncate">
        {task.project}
        {task.owner && <span className="ml-1 text-muted-foreground">· {task.owner}</span>}
      </TableCell>
      <TableCell>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant={STATUS_VARIANT[task.status]} className={BADGE}>
              {task.status}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{task.reason ?? `requested ${task.requested_at ?? '—'}`}</TooltipContent>
        </Tooltip>
        <SyncBadge label="pull" state={task.sync?.state} output={task.sync?.output} />
        <SyncBadge
          label="push"
          state={task.push?.state}
          output={[
            task.push?.output,
            task.push?.unrecorded_runs.length
              ? `unrecorded Runs (not pushed): ${task.push.unrecorded_runs.join(', ')}`
              : null,
          ]
            .filter(Boolean)
            .join('\n')}
        />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {task.node ? `${task.node} · ${task.gpus.join(',')}` : '—'}
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
        {task.state === 'QUEUED'
          ? `${shortTime(task.requested_at)} · ${formatSpan(task.requested_duration_s * 1000)}`
          : `${shortTime(task.granted_at)} → ${shortTime(task.ended_at ?? task.expires_at)}`}
        {task.state === 'RUNNING' && ends !== null && (
          <span className="ml-1 text-foreground">({formatSpan(ends - nowMs)} left)</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {task.tasks.length === 0
            ? '—'
            : task.tasks.map((run) => (
                <Badge
                  key={run.name}
                  variant={run.state === 'live' ? 'secondary' : 'outline'}
                  className={BADGE}
                >
                  {run.name}
                  {run.exit_code !== null ? ` · ${run.exit_code}` : ''}
                </Badge>
              ))}
        </div>
      </TableCell>
    </TableRow>
  )
}

function TicketTable({ tasks, nowMs }: { tasks: ClusterTaskDto[]; nowMs: number }) {
  return (
    <Table className="table-fixed [&_td]:px-1.5 [&_td]:py-1 [&_th]:h-7 [&_th]:px-1.5">
      <colgroup>
        <col className="w-40" />
        <col className="w-36" />
        <col className="w-24" />
        <col className="w-32" />
        <col className="w-64" />
        <col />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead>Ticket</TableHead>
          <TableHead>Project</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Node · GPUs</TableHead>
          <TableHead>Time</TableHead>
          <TableHead>Tasks</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => (
          <TicketRow key={task.id} task={task} nowMs={nowMs} />
        ))}
      </TableBody>
    </Table>
  )
}

function TasksPanel({ data }: { data: ClusterOverviewDto }) {
  const [endedOpen, setEndedOpen] = useState(false)
  const mine = data.tasks.items.filter((task) => !task.redacted)
  const open = mine.filter((task) => task.state !== 'ENDED')
  const ended = mine.filter((task) => task.state === 'ENDED')
  const nowMs = Date.parse(data.now)
  if (!data.tasks.available || mine.length === 0)
    return (
      <Empty data-slot="tasks-unavailable" className="border p-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListTodo />
          </EmptyMedia>
          <EmptyTitle>{data.tasks.available ? 'No tickets' : 'No ticket source'}</EmptyTitle>
          <EmptyDescription>
            {data.tasks.available
              ? 'Nothing is running or queued. Request GPUs with memon ticket request.'
              : 'GPU tickets are not available on this server.'}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return (
    <div className="flex flex-col gap-1.5" data-slot="tickets">
      <Card size="sm" className="gap-0 py-0">
        {open.length > 0 ? (
          <TicketTable tasks={open} nowMs={nowMs} />
        ) : (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Nothing running or queued.</p>
        )}
      </Card>
      {ended.length > 0 && (
        <Collapsible open={endedOpen} onOpenChange={setEndedOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-0.5 px-1 text-xs"
              data-slot="ended-toggle"
            >
              <ChevronRight
                className={cn('size-3 transition-transform', endedOpen && 'rotate-90')}
              />
              Ended in the last 24 h · {ended.length}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card size="sm" className="gap-0 py-0">
              <TicketTable tasks={ended} nowMs={nowMs} />
            </Card>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

export function ClusterDashboard() {
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  // Per-node overrides of the default (healthy open, problem nodes collapsed).
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({})
  const { data, error, isPending, isFetching } = useQuery({
    queryKey: queryKeys.clusters(),
    queryFn: () => fetchClusterOverview(false),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  })

  async function refresh() {
    setRefreshing(true)
    try {
      queryClient.setQueryData(queryKeys.clusters(), await fetchClusterOverview(true))
    } finally {
      setRefreshing(false)
    }
  }

  const nowMs = data ? Date.parse(data.now) : Date.now()
  const nodes = data?.clusters.flatMap((group) => group.nodes) ?? []
  const gpus = nodes.flatMap((node) => node.gpu_rows)
  const issues = nodes.filter((node) => node.state !== 'ok')
  const openTickets = (data?.tasks.items ?? []).filter(
    (task) => !task.redacted && task.state !== 'ENDED',
  ).length
  const isOpen = (node: ClusterNodeDto) => openOverride[node.id] ?? node.state === 'ok'
  const issuesOpen = issues.length > 0 && issues.every(isOpen)
  const setNodeOpen = (id: string, open: boolean) =>
    setOpenOverride((previous) => ({ ...previous, [id]: open }))
  function toggleIssues() {
    setOpenOverride((previous) => ({
      ...previous,
      ...Object.fromEntries(issues.map((node) => [node.id, !issuesOpen])),
    }))
  }
  const time: TimeContext = {
    nowMs,
    horizon: horizonFor(
      nowMs,
      nodes.filter((node) => !node.expired).map((node) => Date.parse(node.available_until)),
      (data?.tasks.items ?? [])
        .filter((task) => task.state === 'RUNNING' && task.granted_at)
        .map((task) => {
          const startMs = Date.parse(task.granted_at as string)
          return {
            startMs,
            endMs: task.expires_at
              ? Date.parse(task.expires_at)
              : startMs + task.requested_duration_s * 1000,
          }
        }),
    ),
  }

  return (
    <TooltipProvider>
      <Tabs defaultValue="nodes" className="gap-1.5" data-slot="cluster-dashboard">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-semibold">Clusters</h1>
          <TabsList>
            <TabsTrigger value="nodes">Nodes</TabsTrigger>
            <TabsTrigger value="tasks" data-slot="tasks-tab">
              Tasks
              {openTickets > 0 && (
                <Badge variant="secondary" className={BADGE}>
                  {openTickets}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
          {data && (
            <span className="text-xs text-muted-foreground" data-slot="cluster-summary">
              {data.clusters.length} clusters · {nodes.length} nodes · {gpus.length} GPUs ·{' '}
              {gpus.filter((gpu) => gpu.allocatable).length} allocatable ·{' '}
              {gpus.filter((gpu) => (gpu.processes ?? 0) > 0).length} busy
            </span>
          )}
          {issues.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              data-slot="toggle-issues"
              onClick={toggleIssues}
            >
              {issuesOpen ? 'Collapse' : 'Expand'} issues · {issues.length}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className={cn(issues.length === 0 && 'ml-auto')}
            onClick={refresh}
            disabled={refreshing}
          >
            <RefreshCw className={cn((refreshing || isFetching) && 'animate-spin')} />
            Refresh
          </Button>
        </div>

        {isPending && <Skeleton className="h-24 w-full" />}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{(error as Error).message}</AlertDescription>
          </Alert>
        )}

        <TabsContent value="nodes" className="flex flex-col gap-2">
          {data && data.clusters.length === 0 && (
            <Empty className="border p-6">
              <EmptyHeader>
                <EmptyTitle>No nodes registered</EmptyTitle>
                <EmptyDescription>Add nodes to the machine-local node registry.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {data?.clusters.map((group) => (
            <ClusterSection
              key={group.cluster}
              group={group}
              tasks={data.tasks.items}
              time={time}
              isOpen={isOpen}
              setOpen={setNodeOpen}
            />
          ))}
        </TabsContent>
        <TabsContent value="tasks">{data && <TasksPanel data={data} />}</TabsContent>
      </Tabs>
    </TooltipProvider>
  )
}
