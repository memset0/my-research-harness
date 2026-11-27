'use client'

// Traffic control → Network: what forwarded service and content-asset traffic
// looked like recently, and on-demand probes of each network leg.
//
//   * Forwarded requests — per Host/Project/transport aggregates and the
//     slowest / most recent requests, from central's bounded in-memory tracker.
//     The split into Resolve (central: auth, manifest, tunnel), Upstream TTFB
//     (central→host plus the remote application) and transfer shows where a
//     slow resource spends its time.
//   * Probes — central→host through the Project's own transport, an optional
//     re-fetch of a service path from central (no browser involved), and a
//     browser→central check measured in this browser.
//
// The snapshot rides the shared foreground heartbeat (query root `traffic`).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Gauge, Loader2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import {
  DEFAULT_TRAFFIC_WINDOW_MS,
  formatBytesPerSecond,
  formatTrafficBytes,
  formatTrafficMs,
  type ProbeRequestDto,
  type ProbeResultDto,
  TRAFFIC_WINDOWS_MS,
  type TrafficAggregateDto,
  type TrafficProjectDto,
  type TrafficRecordDto,
  type TrafficSnapshotDto,
} from '../lib/dto/traffic'
import { queryKeys } from '../lib/query-keys'
import {
  BROWSER_CHECK_BYTES,
  type BrowserCheckResult,
  fetchTrafficSnapshot,
  runBrowserCheck,
  runTrafficProbe,
} from '../lib/traffic-api'
import { cn } from '../lib/utils'
import { useIsOwner } from './session-provider'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

const BADGE = 'h-4 px-1.5 py-0 text-[11px]'
const TH = 'h-7 px-2'
const TD = 'px-2 py-1'
const NUM = cn(TD, 'text-right font-mono tabular-nums')

const TRANSPORT_LABEL: Record<string, string> = {
  native: 'native',
  'ssh-tunnel': 'SSH tunnel',
  'file-agent': 'File Agent',
  sshfs: 'SSHFS',
  unsupported: 'unsupported',
}

function TransportBadge({ transport }: { transport: string }) {
  return (
    <Badge variant="outline" className={BADGE}>
      {TRANSPORT_LABEL[transport] ?? transport}
    </Badge>
  )
}

function clock(iso: string): string {
  return iso.slice(11, 19)
}

/** `report/R0001` → a probe document, or null for anything else. */
function documentOf(value: string): ProbeRequestDto['document'] | null {
  const match = /^(wiki|report)\/([WR]\d{4})$/.exec(value)
  return match ? { kind: match[1] as 'wiki' | 'report', id: match[2]! } : null
}

/** A recorded path without the `?…` marker the tracker leaves for a dropped query. */
function probePath(path: string): string {
  return path.endsWith('?…') ? path.slice(0, -2) : path.replace(/…$/, '')
}

function slowClass(ms: number | null, slowMs: number): string | undefined {
  if (ms === null) return undefined
  if (ms >= slowMs) return 'text-destructive'
  if (ms >= slowMs / 4) return 'text-amber-700 dark:text-amber-300'
  return undefined
}

export function TrafficNetworkPanel() {
  const isOwner = useIsOwner()
  const client = useQueryClient()
  const [windowMs, setWindowMs] = useState<number>(DEFAULT_TRAFFIC_WINDOW_MS)
  const snapshot = useQuery({
    queryKey: queryKeys.traffic(windowMs),
    queryFn: () => fetchTrafficSnapshot(windowMs),
    enabled: isOwner,
  })
  const probe = useMutation({
    mutationFn: runTrafficProbe,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.traffic(windowMs) }),
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })
  if (!isOwner) return null
  const data = snapshot.data
  return (
    <TooltipProvider>
      <div className="flex flex-col gap-3" data-slot="traffic-network">
        <Card size="sm" data-slot="traffic-requests">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Activity className="size-3.5" aria-hidden />
              Forwarded requests
            </CardTitle>
            <CardDescription>
              Service and content-asset requests through central, kept in memory since the last
              restart.
            </CardDescription>
            <CardAction>
              <Select value={String(windowMs)} onValueChange={(v) => setWindowMs(Number(v))}>
                <SelectTrigger size="sm" className="w-32" aria-label="Traffic window">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRAFFIC_WINDOWS_MS.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      last {Math.round(option / 60_000)} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {snapshot.isError && (
              <p className="text-destructive">
                {snapshot.error instanceof Error ? snapshot.error.message : 'Unavailable'}
              </p>
            )}
            {!data && !snapshot.isError && (
              <p className="text-muted-foreground">Loading traffic measurements…</p>
            )}
            {data && (
              <RequestTabs
                data={data}
                pending={probe.isPending}
                onProbe={(input) => probe.mutate(input)}
              />
            )}
          </CardContent>
        </Card>

        <Card size="sm" data-slot="traffic-probes">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Gauge className="size-3.5" aria-hidden />
              Probes
            </CardTitle>
            <CardDescription>
              Measure each leg on demand: browser → central here, central → host through the
              project's own transport. Nothing is installed on remote hosts.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <BrowserCheck />
            {data && (
              <ProbeForm
                projects={data.projects}
                pending={probe.isPending}
                onProbe={(input) => probe.mutate(input)}
              />
            )}
            {data && <ProbeResults results={data.probes} />}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  )
}

function RequestTabs({
  data,
  pending,
  onProbe,
}: {
  data: TrafficSnapshotDto
  pending: boolean
  onProbe: (input: ProbeRequestDto) => void
}) {
  return (
    <Tabs defaultValue="projects" className="gap-2">
      <TabsList>
        <TabsTrigger value="projects">By project ({data.aggregates.length})</TabsTrigger>
        <TabsTrigger value="slowest">Slowest ({data.slowest.length})</TabsTrigger>
        <TabsTrigger value="recent">Recent ({data.recent.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="projects">
        <AggregateTable data={data} pending={pending} onProbe={onProbe} />
      </TabsContent>
      <TabsContent value="slowest">
        <RecordTable
          records={data.slowest}
          slowMs={data.slowMs}
          pending={pending}
          onProbe={onProbe}
          empty="No forwarded requests in this window."
        />
      </TabsContent>
      <TabsContent value="recent">
        <RecordTable
          records={data.recent}
          slowMs={data.slowMs}
          pending={pending}
          onProbe={onProbe}
          empty="No forwarded requests since the last restart."
        />
      </TabsContent>
      <p className="text-[11px] text-muted-foreground">
        Resolve is central's own work before forwarding (auth, manifest read, tunnel readiness).
        TTFB counts from arrival at central to the upstream's response headers; Upstream is the same
        from the moment central sent the request, so it covers central → host and the application.
        The remainder of Total is transfer; a slow browser link slows transfer, never TTFB.
        Throughput is shown for bodies of 32 KiB or more. Slow means over{' '}
        {formatTrafficMs(data.slowMs)}. Generated {clock(data.generatedAt)}.
      </p>
    </Tabs>
  )
}

function AggregateTable({
  data,
  pending,
  onProbe,
}: {
  data: TrafficSnapshotDto
  pending: boolean
  onProbe: (input: ProbeRequestDto) => void
}) {
  if (data.aggregates.length === 0)
    return <p className="text-muted-foreground">No forwarded requests in this window.</p>
  return (
    <div className="overflow-x-auto">
      <Table className="text-xs" data-slot="traffic-aggregates">
        <TableHeader>
          <TableRow>
            <TableHead className={TH}>Project</TableHead>
            <TableHead className={TH}>Transport</TableHead>
            <TableHead className={TH}>Kind</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Requests</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Errors</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Slow</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Bytes</TableHead>
            <TableHead className={cn(TH, 'text-right')}>TTFB mean</TableHead>
            <TableHead className={cn(TH, 'text-right')}>TTFB p95</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Total mean</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Total p95</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Throughput</TableHead>
            <TableHead className={TH} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.aggregates.map((row) => (
            <AggregateRow
              key={`${row.host}/${row.project}/${row.transport}/${row.kind}`}
              row={row}
              slowMs={data.slowMs}
              pending={pending}
              onProbe={onProbe}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function AggregateRow({
  row,
  slowMs,
  pending,
  onProbe,
}: {
  row: TrafficAggregateDto
  slowMs: number
  pending: boolean
  onProbe: (input: ProbeRequestDto) => void
}) {
  const document = row.kind === 'service' ? documentOf(row.lastDocument) : null
  return (
    <TableRow data-traffic-key={`${row.host}/${row.project}/${row.kind}`}>
      <TableCell className={cn(TD, 'font-mono')}>
        {row.host}/{row.project}
      </TableCell>
      <TableCell className={TD}>
        <TransportBadge transport={row.transport} />
      </TableCell>
      <TableCell className={TD}>{row.kind}</TableCell>
      <TableCell className={NUM}>{row.count}</TableCell>
      <TableCell className={cn(NUM, row.errors > 0 && 'text-destructive')}>{row.errors}</TableCell>
      <TableCell className={cn(NUM, row.slow > 0 && 'text-amber-700 dark:text-amber-300')}>
        {row.slow}
      </TableCell>
      <TableCell className={NUM}>{formatTrafficBytes(row.bytes)}</TableCell>
      <TableCell className={cn(NUM, slowClass(row.ttfbMeanMs, slowMs))}>
        {formatTrafficMs(row.ttfbMeanMs)}
      </TableCell>
      <TableCell className={cn(NUM, slowClass(row.ttfbP95Ms, slowMs))}>
        {row.ttfbP95Ms === null ? '—' : `≤${formatTrafficMs(row.ttfbP95Ms)}`}
      </TableCell>
      <TableCell className={cn(NUM, slowClass(row.totalMeanMs, slowMs))}>
        {formatTrafficMs(row.totalMeanMs)}
      </TableCell>
      <TableCell className={cn(NUM, slowClass(row.totalP95Ms, slowMs))}>
        {row.totalP95Ms === null ? '—' : `≤${formatTrafficMs(row.totalP95Ms)}`}
      </TableCell>
      <TableCell className={NUM}>{formatBytesPerSecond(row.throughputBps)}</TableCell>
      <TableCell className={cn(TD, 'text-right')}>
        <Button
          size="xs"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            onProbe({
              host: row.host,
              project: row.project,
              ...(document ? { document, path: '/' } : {}),
            })
          }
        >
          Probe
        </Button>
      </TableCell>
    </TableRow>
  )
}

function RecordTable({
  records,
  slowMs,
  pending,
  onProbe,
  empty,
}: {
  records: TrafficRecordDto[]
  slowMs: number
  pending: boolean
  onProbe: (input: ProbeRequestDto) => void
  empty: string
}) {
  if (records.length === 0) return <p className="text-muted-foreground">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <Table className="text-xs" data-slot="traffic-records">
        <TableHeader>
          <TableRow>
            <TableHead className={TH}>Time</TableHead>
            <TableHead className={TH}>Project</TableHead>
            <TableHead className={TH}>Transport</TableHead>
            <TableHead className={TH}>Request</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Status</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Bytes</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Resolve</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Upstream</TableHead>
            <TableHead className={cn(TH, 'text-right')}>TTFB</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Total</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Throughput</TableHead>
            <TableHead className={TH}>Conn</TableHead>
            <TableHead className={TH} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => {
            const document = record.kind === 'service' ? documentOf(record.document) : null
            return (
              <TableRow key={record.seq}>
                <TableCell className={cn(TD, 'font-mono text-muted-foreground')}>
                  {clock(record.at)}
                </TableCell>
                <TableCell className={cn(TD, 'font-mono')}>
                  {record.host}/{record.project}
                </TableCell>
                <TableCell className={TD}>
                  <TransportBadge transport={record.transport} />
                </TableCell>
                <TableCell className={cn(TD, 'max-w-80')}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="block truncate font-mono">
                        <span className="text-muted-foreground">
                          {record.kind === 'service' ? '' : `${record.kind} `}
                          {record.document}
                        </span>{' '}
                        {record.method !== 'GET' ? `${record.method} ` : ''}
                        {record.path}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-md break-all font-mono">
                      {record.kind} {record.document} {record.method} {record.path}
                      {record.sessionMs !== null &&
                        ` · session ${formatTrafficMs(record.sessionMs)}, ${formatTrafficBytes(record.bytesUp)} up`}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell
                  className={cn(
                    NUM,
                    (record.outcome !== 'ok' || (record.status ?? 0) >= 500) && 'text-destructive',
                  )}
                >
                  {record.outcome === 'aborted'
                    ? 'aborted'
                    : (record.status ?? (record.outcome === 'error' ? 'error' : '—'))}
                </TableCell>
                <TableCell className={NUM}>{formatTrafficBytes(record.bytes)}</TableCell>
                <TableCell className={cn(NUM, slowClass(record.resolveMs, slowMs))}>
                  {formatTrafficMs(record.resolveMs)}
                </TableCell>
                <TableCell className={cn(NUM, slowClass(record.upstreamTtfbMs, slowMs))}>
                  {formatTrafficMs(record.upstreamTtfbMs)}
                </TableCell>
                <TableCell className={cn(NUM, slowClass(record.ttfbMs, slowMs))}>
                  {formatTrafficMs(record.ttfbMs)}
                </TableCell>
                <TableCell className={cn(NUM, slowClass(record.totalMs, slowMs))}>
                  {formatTrafficMs(record.totalMs)}
                </TableCell>
                <TableCell className={NUM}>{formatBytesPerSecond(record.throughputBps)}</TableCell>
                <TableCell className={cn(TD, 'text-muted-foreground')}>
                  {record.reused === null ? '—' : record.reused ? 'reused' : 'new'}
                </TableCell>
                <TableCell className={cn(TD, 'text-right')}>
                  {document && (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={pending}
                      title="Fetch this path again from central, without the browser"
                      onClick={() =>
                        onProbe({
                          host: record.host,
                          project: record.project,
                          document,
                          path: probePath(record.path),
                        })
                      }
                    >
                      Re-fetch
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function BrowserCheck() {
  const [result, setResult] = useState<BrowserCheckResult | null>(null)
  const check = useMutation({
    mutationFn: () => runBrowserCheck(),
    onSuccess: setResult,
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })
  return (
    <div className="flex flex-wrap items-center gap-2" data-slot="traffic-browser-check">
      <span className="font-medium">Browser → central</span>
      <Button size="xs" variant="outline" disabled={check.isPending} onClick={() => check.mutate()}>
        {check.isPending && <Loader2 className="animate-spin" data-icon="inline-start" />}
        Run browser check
      </Button>
      {result ? (
        <span className="font-mono text-muted-foreground">
          {result.at} · latency {formatTrafficMs(result.latencyMedianMs)} median (
          {formatTrafficMs(result.latencyMinMs)}–{formatTrafficMs(result.latencyMaxMs)},{' '}
          {result.samples} requests) · {formatTrafficBytes(result.downloadBytes)} in{' '}
          {formatTrafficMs(result.downloadMs)}, first byte {formatTrafficMs(result.downloadTtfbMs)}{' '}
          · {formatBytesPerSecond(result.throughputBps)}
        </span>
      ) : (
        <span className="text-muted-foreground">
          Times {formatTrafficBytes(0)} requests and one {formatTrafficBytes(BROWSER_CHECK_BYTES)}{' '}
          download from central, through every proxy in between.
        </span>
      )}
    </div>
  )
}

const PROBE_LABEL: Record<TrafficProjectDto['probe'], string> = {
  agent: 'File Agent round trips',
  ssh: 'SSH echo + download',
  native: 'loopback',
  none: 'not probeable',
}

function ProbeForm({
  projects,
  pending,
  onProbe,
}: {
  projects: TrafficProjectDto[]
  pending: boolean
  onProbe: (input: ProbeRequestDto) => void
}) {
  const [target, setTarget] = useState('')
  const [document, setDocument] = useState('')
  const [path, setPath] = useState('/')
  const selected = projects.find((p) => `${p.host}/${p.project}` === target)
  const docId = document.trim().toUpperCase()
  const docValid = docId === '' || /^[WR]\d{4}$/.test(docId)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!selected || !docValid) return
    onProbe({
      host: selected.host,
      project: selected.project,
      ...(docId
        ? {
            document: { kind: docId.startsWith('W') ? 'wiki' : 'report', id: docId },
            path: path.trim() || '/',
          }
        : {}),
    })
  }
  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2"
      data-slot="traffic-probe-form"
    >
      <span className="font-medium">Central → host</span>
      <Select value={target} onValueChange={setTarget}>
        <SelectTrigger size="sm" className="min-w-56" aria-label="Project to probe">
          <SelectValue placeholder="Project" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem
              key={`${p.host}/${p.project}`}
              value={`${p.host}/${p.project}`}
              disabled={p.probe === 'none'}
            >
              {p.host}/{p.project} · {TRANSPORT_LABEL[p.transport]} · {PROBE_LABEL[p.probe]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        className="h-7 w-28 text-xs"
        aria-label="Service document id"
        placeholder="R0001 (optional)"
        value={document}
        onChange={(e) => setDocument(e.target.value)}
      />
      <Input
        className="h-7 w-48 font-mono text-xs"
        aria-label="Service path"
        placeholder="/"
        value={path}
        disabled={docId === ''}
        onChange={(e) => setPath(e.target.value)}
      />
      <Button size="sm" type="submit" disabled={pending || !selected || !docValid}>
        {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
        Probe
      </Button>
      {projects
        .filter((p) => p.probe === 'none')
        .map((p) => (
          <span key={`${p.host}/${p.project}`} className="w-full text-[11px] text-muted-foreground">
            {p.host}/{p.project}: {p.reason}
          </span>
        ))}
    </form>
  )
}

function ProbeResults({ results }: { results: ProbeResultDto[] }) {
  if (results.length === 0)
    return (
      <p className="text-muted-foreground">
        No probes yet. Probe a project above, or use Probe / Re-fetch in the request tables.
      </p>
    )
  return (
    <div className="overflow-x-auto">
      <Table className="text-xs" data-slot="traffic-probe-results">
        <TableHeader>
          <TableRow>
            <TableHead className={TH}>Time</TableHead>
            <TableHead className={TH}>Project</TableHead>
            <TableHead className={TH}>Step</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Setup</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Median</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Min–max</TableHead>
            <TableHead className={cn(TH, 'text-right')}>TTFB</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Bytes</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Throughput</TableHead>
            <TableHead className={TH}>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.flatMap((result) =>
            result.steps.map((step, index) => (
              <TableRow key={`${result.id}-${step.label}`} data-probe={result.id}>
                <TableCell className={cn(TD, 'font-mono text-muted-foreground')}>
                  {index === 0 ? clock(result.at) : ''}
                </TableCell>
                <TableCell className={TD}>
                  {index === 0 && (
                    <span className="flex items-center gap-1">
                      <span className="font-mono">
                        {result.host}/{result.project}
                      </span>
                      <TransportBadge transport={result.transport} />
                    </span>
                  )}
                </TableCell>
                <TableCell className={cn(TD, !step.ok && 'text-destructive')}>
                  {step.label}
                </TableCell>
                <TableCell className={NUM}>{formatTrafficMs(step.setupMs)}</TableCell>
                <TableCell className={NUM}>{formatTrafficMs(step.medianMs)}</TableCell>
                <TableCell className={NUM}>
                  {step.minMs === undefined || step.minMs === null
                    ? '—'
                    : `${formatTrafficMs(step.minMs)}–${formatTrafficMs(step.maxMs)}`}
                </TableCell>
                <TableCell className={NUM}>{formatTrafficMs(step.ttfbMs)}</TableCell>
                <TableCell className={NUM}>
                  {step.bytes === undefined ? '—' : formatTrafficBytes(step.bytes)}
                </TableCell>
                <TableCell className={NUM}>{formatBytesPerSecond(step.throughputBps)}</TableCell>
                <TableCell className={cn(TD, 'max-w-72 truncate text-muted-foreground')}>
                  {[
                    step.status !== undefined && step.status !== null
                      ? `HTTP ${step.status}`
                      : null,
                    step.samples !== undefined ? `${step.samples} samples` : null,
                    step.note ?? null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </TableCell>
              </TableRow>
            )),
          )}
        </TableBody>
      </Table>
    </div>
  )
}
