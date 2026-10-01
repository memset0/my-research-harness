'use client'

// Owner-only File access panel: what the central filesystem scheduler is doing
// right now, and what it will do after the next restart.
//
// Two honest separations drive the layout:
//   * effective vs pending — saving writes the local config only; the running
//     process keeps its startup values until an explicit restart.
//   * queue wait vs execution — a slow mount shows up as execution latency,
//     a saturated concurrency limit as queue wait. Both are split by origin so
//     human demand and background upkeep can be told apart.
//
// Metrics ride the shared foreground heartbeat (query root `file-access` is in
// the resource allow-list), so there is no timer of its own here. Reading this
// page touches no project files.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  DEFAULT_FILE_ACCESS_METRIC_WINDOW_MS,
  FILE_ACCESS_METRIC_WINDOWS_MS,
  FILE_ACCESS_OPTION_KEYS,
  type FileAccessOptionsDto,
  type FileAccessSettings,
  type FileOperationCounters,
  type FileOperationMetrics,
  fetchFileAccessSettings,
  requestFileAccessRestart,
  saveFileAccessSettings,
} from '../lib/file-access-api'
import { queryKeys } from '../lib/query-keys'
import { cn } from '../lib/utils'
import { useIsOwner } from './session-provider'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

type OptionKey = keyof FileAccessOptionsDto

interface FieldSpec {
  label: string
  help: string
  unit: 'ms' | 'ops' | 'x'
}

const FIELDS: Record<OptionKey, FieldSpec> = {
  concurrency: {
    label: 'Parallel operations',
    help: 'Filesystem operations allowed to run at once per storage group.',
    unit: 'ops',
  },
  heartbeatMs: {
    label: 'Heartbeat',
    help: 'How often a visible, focused page asks about its resources, measured from the previous answer.',
    unit: 'ms',
  },
  leaseMs: {
    label: 'Attention lease',
    help: 'How long a page keeps its interest after its last heartbeat. At least three heartbeats.',
    unit: 'ms',
  },
  fileMinMs: {
    label: 'File check, fastest',
    help: 'Shortest gap between checks of a file someone is looking at.',
    unit: 'ms',
  },
  fileMaxMs: {
    label: 'File check, slowest',
    help: 'Gap a quiet file backs off to while still being watched.',
    unit: 'ms',
  },
  directoryMinMs: {
    label: 'Listing check, fastest',
    help: 'Shortest gap between directory listings behind an open page.',
    unit: 'ms',
  },
  directoryMaxMs: {
    label: 'Listing check, slowest',
    help: 'Gap a quiet directory backs off to.',
    unit: 'ms',
  },
  maintenanceMinMs: {
    label: 'Idle upkeep, fastest',
    help: 'Shortest gap between checks of paths nobody is watching.',
    unit: 'ms',
  },
  maintenanceMaxMs: {
    label: 'Idle upkeep, slowest',
    help: 'Gap unwatched paths settle at.',
    unit: 'ms',
  },
  failureMinMs: {
    label: 'Retry after error, fastest',
    help: 'Wait before retrying a path that just failed.',
    unit: 'ms',
  },
  failureMaxMs: {
    label: 'Retry after error, slowest',
    help: 'Longest wait for a path that keeps failing.',
    unit: 'ms',
  },
  backoffFactor: {
    label: 'Backoff factor',
    help: 'Multiplier applied each time a check finds no change.',
    unit: 'x',
  },
  wikiTtlMs: {
    label: 'Wiki cache period',
    help: 'Opted-in SSHFS Wiki files and listings. Open/focus reuses valid cache; manual refresh bypasses this period.',
    unit: 'ms',
  },
  defaultTtlMs: {
    label: 'Other document cache period',
    help: 'Opted-in SSHFS non-Wiki files and listings. Requires a local cache dump configured on this instance.',
    unit: 'ms',
  },
}

const FIELD_GROUPS: ReadonlyArray<{ title: string; keys: readonly OptionKey[] }> = [
  { title: 'Throughput', keys: ['concurrency'] },
  { title: 'Foreground attention', keys: ['heartbeatMs', 'leaseMs'] },
  { title: 'Persistent SSHFS cache', keys: ['wikiTtlMs', 'defaultTtlMs'] },
  {
    title: 'Memory-only watched paths',
    keys: ['fileMinMs', 'fileMaxMs', 'directoryMinMs', 'directoryMaxMs'],
  },
  { title: 'Memory-only unwatched paths', keys: ['maintenanceMinMs', 'maintenanceMaxMs'] },
  { title: 'Errors', keys: ['failureMinMs', 'failureMaxMs', 'backoffFactor'] },
]

type Draft = Record<OptionKey, string>

function toDraft(options: FileAccessOptionsDto): Draft {
  const draft = {} as Draft
  for (const key of FILE_ACCESS_OPTION_KEYS) draft[key] = String(options[key])
  return draft
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}

function formatMs(ms: number): string {
  if (ms < 1) return '<1 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

function formatValue(key: OptionKey, value: number): string {
  if (FIELDS[key].unit === 'ms') return formatMs(value)
  if (FIELDS[key].unit === 'x') return `x${value}`
  return String(value)
}

export function FileAccessSettingsPanel() {
  const isOwner = useIsOwner()
  const queryClient = useQueryClient()
  const [windowMs, setWindowMs] = useState<number>(DEFAULT_FILE_ACCESS_METRIC_WINDOW_MS)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [baselineRevision, setBaselineRevision] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [issues, setIssues] = useState<string[]>([])
  const [conflict, setConflict] = useState<{
    revision: string
    pending: FileAccessOptionsDto
  } | null>(null)

  const query = useQuery({
    queryKey: queryKeys.fileAccess(windowMs),
    queryFn: () => fetchFileAccessSettings(windowMs),
    enabled: isOwner,
  })
  const result = query.data
  const settings: FileAccessSettings | null = result && result.ok ? result.data : null

  const dirty = useMemo(() => {
    if (!settings || !draft) return false
    return FILE_ACCESS_OPTION_KEYS.some((key) => draft[key] !== String(settings.pending[key]))
  }, [settings, draft])

  useEffect(() => {
    if (!settings) return
    // Adopt fresh values only when nothing is being edited: a heartbeat must
    // never overwrite half-typed input.
    setDraft((current) => {
      if (current === null) return toDraft(settings.pending)
      if (baselineRevision !== settings.revision && !dirty) return toDraft(settings.pending)
      return current
    })
    setBaselineRevision(settings.revision)
  }, [settings, baselineRevision, dirty])

  if (!isOwner) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>File access</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Filesystem scheduling and operator metrics are available to the owner account only.
        </CardContent>
      </Card>
    )
  }

  if (result && !result.ok) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>File access</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4" aria-hidden />
            <span>{result.message}</span>
          </div>
          <code className="w-fit rounded bg-muted px-1.5 py-0.5 text-xs">{result.code}</code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!settings || !draft) {
    return <div className="p-1 text-sm text-muted-foreground">Loading file access settings…</div>
  }

  const parsedDraft = (): FileAccessOptionsDto | string[] => {
    const problems: string[] = []
    const parsed = {} as FileAccessOptionsDto
    for (const key of FILE_ACCESS_OPTION_KEYS) {
      const value = Number(draft[key])
      if (!Number.isFinite(value) || value <= 0) {
        problems.push(`${FIELDS[key].label} must be a positive number.`)
        continue
      }
      parsed[key] = value
    }
    return problems.length > 0 ? problems : parsed
  }

  const save = async () => {
    const parsed = parsedDraft()
    if (Array.isArray(parsed)) {
      setIssues(parsed)
      return
    }
    setSaving(true)
    setIssues([])
    setConflict(null)
    try {
      const response = await saveFileAccessSettings({
        revision: settings.revision,
        settings: parsed,
        windowMs,
      })
      if (response.ok) {
        queryClient.setQueryData(queryKeys.fileAccess(windowMs), response)
        setDraft(toDraft(response.data.pending))
        setBaselineRevision(response.data.revision)
        toast.success('Saved. Restart to activate.')
        return
      }
      setIssues(response.issues ?? [])
      if (response.code === 'REVISION_CONFLICT' && response.revision && response.pending) {
        setConflict({ revision: response.revision, pending: response.pending })
      }
      toast.error(response.message)
    } finally {
      setSaving(false)
    }
  }

  const restart = async () => {
    setRestarting(true)
    try {
      const response = await requestFileAccessRestart()
      if (!response.ok) {
        toast.error(response.message ?? 'Restart is not available on this machine.')
        return
      }
      toast.success('Restart scheduled. Reconnecting…')
      await verifyAfterRestart()
    } finally {
      setRestarting(false)
    }
  }

  /**
   * Poll the settings endpoint until the process answers again and reports the
   * saved values as effective. Only then is the restart genuinely activated.
   */
  const verifyAfterRestart = async () => {
    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2_000))
      const response = await fetchFileAccessSettings(windowMs).catch(() => null)
      if (!response?.ok) continue
      queryClient.setQueryData(queryKeys.fileAccess(windowMs), response)
      if (
        !response.data.restartRequired &&
        response.data.metrics &&
        settings.metrics &&
        response.data.metrics.epoch !== settings.metrics.epoch
      ) {
        toast.success('New settings are effective.')
        return
      }
    }
    toast.warning('Could not confirm the new effective settings. Check the service by hand.')
  }

  const metrics = settings.metrics

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">File access</h1>
        {settings.restartRequired ? (
          <Badge
            variant="outline"
            className="border-amber-500/60 text-amber-700 dark:text-amber-300"
          >
            saved values not active
          </Badge>
        ) : (
          <Badge variant="secondary">running saved values</Badge>
        )}
        {!settings.restartAvailable && (
          <Badge variant="outline">restart must be done on the machine</Badge>
        )}
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          config revision {settings.revision.slice(0, 12)}
        </span>
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Scheduling</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!dirty || saving}
              onClick={() => {
                setDraft(toDraft(settings.pending))
                setIssues([])
              }}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Discard edits
            </Button>
            <Button type="button" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <p className="text-[11px] text-muted-foreground">
            These settings and the metrics below cover <code>storage: sshfs</code> projects only; a{' '}
            <code>storage: local</code> project is read directly through the filesystem, so it is
            never queued, cached or listed as a storage group here.
          </p>
          {issues.length > 0 && (
            <ul
              className="list-disc space-y-1 rounded-md border border-destructive/50 bg-destructive/5 p-3 pl-7 text-xs text-destructive"
              data-slot="file-access-issues"
            >
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          {conflict && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs">
              <span>
                The local config changed elsewhere. Load the values now on disk to continue from
                them.
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraft(toDraft(conflict.pending))
                  setBaselineRevision(conflict.revision)
                  setConflict(null)
                  void query.refetch()
                }}
              >
                Load saved values
              </Button>
            </div>
          )}
          {FIELD_GROUPS.map((group) => (
            <section key={group.title} className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold uppercase text-muted-foreground">
                {group.title}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.keys.map((key) => {
                  const field = FIELDS[key]
                  const changed = draft[key] !== String(settings.pending[key])
                  const pendingDiffers = settings.pending[key] !== settings.effective[key]
                  return (
                    <div key={key} className="flex flex-col gap-1.5">
                      <Label htmlFor={`file-access-${key}`} className="text-xs">
                        {field.label}
                        {field.unit === 'ms' && (
                          <span className="text-muted-foreground"> (ms)</span>
                        )}
                      </Label>
                      <Input
                        id={`file-access-${key}`}
                        inputMode="numeric"
                        disabled={
                          !settings.cacheConfigured &&
                          (key === 'wikiTtlMs' || key === 'defaultTtlMs')
                        }
                        value={draft[key]}
                        aria-describedby={`file-access-${key}-help`}
                        className={cn('h-8 font-mono text-xs', changed && 'border-primary')}
                        onChange={(event) =>
                          setDraft((current) =>
                            current ? { ...current, [key]: event.target.value } : current,
                          )
                        }
                      />
                      <p
                        id={`file-access-${key}-help`}
                        className="text-[11px] leading-snug text-muted-foreground"
                      >
                        {field.help}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        running {formatValue(key, settings.effective[key])}
                        {pendingDiffers && (
                          <span className="text-amber-700 dark:text-amber-300">
                            {' '}
                            · saved {formatValue(key, settings.pending[key])}
                          </span>
                        )}
                      </p>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Activation</CardTitle>
          <Button
            type="button"
            variant={settings.restartRequired ? 'default' : 'outline'}
            size="sm"
            disabled={restarting || !settings.restartAvailable}
            onClick={() => void restart()}
          >
            {restarting ? 'Restarting…' : 'Restart service'}
          </Button>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          {settings.restartAvailable
            ? 'Restart uses the restart adapter configured on this machine. Memory caches, queue and metrics start empty; persisted SSHFS observations remain available. This panel re-reads the effective values to confirm activation.'
            : 'No restart adapter is configured on this machine, so saved values can only be activated by restarting the service there. Saving never restarts on its own.'}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Operations</CardTitle>
          <Select value={String(windowMs)} onValueChange={(value) => setWindowMs(Number(value))}>
            <SelectTrigger size="sm" className="w-[9.5rem]" aria-label="Metrics window">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILE_ACCESS_METRIC_WINDOWS_MS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  last {Math.round(option / 60_000)} min
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>{metrics ? <MetricsView metrics={metrics} /> : <EmptyMetrics />}</CardContent>
      </Card>
    </div>
  )
}

function EmptyMetrics() {
  return (
    <p className="text-xs text-muted-foreground">
      No operation metrics were reported. They start empty after a restart and fill in as pages read
      files.
    </p>
  )
}

function MetricsView({ metrics }: { metrics: FileOperationMetrics }) {
  const rows: Array<{ label: string; counters: FileOperationCounters }> = [
    { label: 'All', counters: metrics.overall },
    { label: 'Human', counters: metrics.byOrigin.human },
    { label: 'Automatic', counters: metrics.byOrigin.automatic },
  ]
  for (const [operation, counters] of Object.entries(metrics.byOperation)) {
    if (counters.samples === 0 && counters.cacheHits === 0 && counters.coalesced === 0) continue
    rows.push({ label: operation, counters })
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="In flight" value={String(metrics.inFlight)} />
        <Stat label="Queued" value={String(metrics.queued)} />
        <Stat
          label="Oldest wait"
          value={metrics.oldestWaitingAgeMs === null ? '—' : formatMs(metrics.oldestWaitingAgeMs)}
        />
        <Stat label="Cache entries" value={String(metrics.cacheEntries)} />
        <Stat label="Cached content" value={formatBytes(metrics.cachedContentBytes)} />
      </dl>

      <div className="overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>Scope</TableHead>
              <TableHead className="text-right">Ops</TableHead>
              <TableHead className="text-right">Queue mean</TableHead>
              <TableHead className="text-right">Queue p95</TableHead>
              <TableHead className="text-right">Run mean</TableHead>
              <TableHead className="text-right">Run p95</TableHead>
              <TableHead className="text-right">Cache hits</TableHead>
              <TableHead className="text-right">Joined</TableHead>
              <TableHead className="text-right">Errors</TableHead>
              <TableHead className="text-right">Read</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell className="text-right font-mono">{row.counters.samples}</TableCell>
                <TableCell className="text-right font-mono">
                  {formatMs(row.counters.queueWaitMs.meanMs)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatMs(row.counters.queueWaitMs.p95Ms)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatMs(row.counters.executionMs.meanMs)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatMs(row.counters.executionMs.p95Ms)}
                </TableCell>
                <TableCell className="text-right font-mono">{row.counters.cacheHits}</TableCell>
                <TableCell className="text-right font-mono">{row.counters.coalesced}</TableCell>
                <TableCell
                  className={cn(
                    'text-right font-mono',
                    row.counters.errors > 0 && 'text-destructive',
                  )}
                >
                  {row.counters.errors}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatBytes(row.counters.readBytes)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {metrics.groups.length > 0 && (
        <div className="overflow-x-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Storage group</TableHead>
                <TableHead className="text-right">Limit</TableHead>
                <TableHead className="text-right">In flight</TableHead>
                <TableHead className="text-right">Queued</TableHead>
                <TableHead className="text-right">Oldest wait</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.groups.map((group) => (
                <TableRow key={group.storageGroup}>
                  <TableCell className="font-mono">{group.storageGroup}</TableCell>
                  <TableCell className="text-right font-mono">{group.concurrency}</TableCell>
                  <TableCell className="text-right font-mono">{group.inFlight}</TableCell>
                  <TableCell className="text-right font-mono">{group.queued}</TableCell>
                  <TableCell className="text-right font-mono">
                    {group.oldestWaitingAgeMs === null ? '—' : formatMs(group.oldestWaitingAgeMs)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Instance-wide completed filesystem operations in the selected rolling window, not unique
        files or this page's requests. All equals Human + Automatic and also the sum of operation
        rows; these are alternative breakdowns, not additional totals. Runtime entries count
        project/path/operation keys in scheduler memory, including keys with pending work; they are
        not unique paths, observation-LRU values, or dump records. Read volume counts application
        bytes from physical reads; cache hits read nothing. Joined counts each extra caller once
        when it joins an existing task. Window {Math.round(metrics.windowMs / 60_000)} min,
        generated {metrics.generatedAt}.
      </p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-2.5 py-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm">{value}</dd>
    </div>
  )
}
