// Status displays. Spec (web-layout / "Status display uses colored Badge"):
// run + hypothesis status render as a colored shadcn Badge with a lucide
// icon. The on-disk emoji ( 🟢 ✅ ❌ … ) is never rendered in the UI.

import type { ExperimentStatus, Status } from '@memon/core'
import {
  AlertTriangle,
  Archive as ArchiveIcon,
  CheckCircle2,
  Circle,
  CircleDot,
  CircleSlash,
  Clock,
  HelpCircle,
  Loader2,
  type LucideIcon,
  PauseCircle,
  XCircle,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'

const STATUS_ICON: Readonly<Record<Status, LucideIcon>> = {
  PENDING: Clock,
  RUNNING: Loader2,
  FINISHED: CheckCircle2,
  INTERRUPTED: PauseCircle,
  FAILED: XCircle,
  UNKNOWN: HelpCircle,
}

const STATUS_CLASS: Readonly<Record<Status, string>> = {
  PENDING:
    'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700/40 dark:bg-slate-900/40 dark:text-slate-300',
  RUNNING:
    'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700/40 dark:bg-sky-950/40 dark:text-sky-200',
  FINISHED:
    'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-950/40 dark:text-emerald-200',
  INTERRUPTED:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-200',
  FAILED:
    'border-red-300 bg-red-50 text-red-800 dark:border-red-700/40 dark:bg-red-950/40 dark:text-red-200',
  UNKNOWN:
    'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800/40 dark:bg-rose-950/30 dark:text-rose-200',
}

// v4: archived overlay desaturates the status pill and prefixes with the
// Archive icon, per archive-frontmatter spec "Visual treatment of archived
// items." Keeps the same color family so the underlying status is still
// readable, just dimmed.
const STATUS_CLASS_ARCHIVED: Readonly<Record<Status, string>> = {
  PENDING:
    'border-slate-200 bg-slate-50/60 text-slate-500 dark:border-slate-800/40 dark:bg-slate-900/20 dark:text-slate-400',
  RUNNING:
    'border-sky-200 bg-sky-50/60 text-sky-600 dark:border-sky-800/40 dark:bg-sky-950/20 dark:text-sky-300',
  FINISHED:
    'border-emerald-200 bg-emerald-50/60 text-emerald-600 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300',
  INTERRUPTED:
    'border-amber-200 bg-amber-50/60 text-amber-600 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300',
  FAILED:
    'border-red-200 bg-red-50/60 text-red-600 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-300',
  UNKNOWN:
    'border-rose-100 bg-rose-50/40 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300',
}

export function StatusPill({
  status,
  stale,
  archived,
  className,
}: {
  status: Status
  stale?: boolean
  /** v4: when true, render the desaturated variant + Archive icon prefix. */
  archived?: boolean
  className?: string
}) {
  const Icon = STATUS_ICON[status]
  const palette = archived ? STATUS_CLASS_ARCHIVED[status] : STATUS_CLASS[status]
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <Badge variant="outline" className={cn('gap-1 font-medium', palette)}>
        {archived && <ArchiveIcon className="size-3" aria-label="archived" />}
        <Icon
          className={cn('size-3', status === 'RUNNING' && !archived && 'animate-spin')}
          aria-hidden
        />
        {status}
      </Badge>
      {stale && (
        <AlertTriangle
          className="size-3.5 text-amber-600 dark:text-amber-400"
          aria-label="stale (no recent directory activity)"
        />
      )}
    </span>
  )
}

// ---------- Experiment-doc status (v4) ----------

const EXP_STATUS_ICON: Readonly<Record<ExperimentStatus, LucideIcon>> = {
  OPEN: CircleDot,
  RESOLVED: CheckCircle2,
  ABANDONED: XCircle,
}

const EXP_STATUS_CLASS: Readonly<Record<ExperimentStatus, string>> = {
  OPEN: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700/40 dark:bg-sky-950/40 dark:text-sky-200',
  RESOLVED:
    'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-950/40 dark:text-emerald-200',
  ABANDONED:
    'border-stone-300 bg-stone-100 text-stone-800 dark:border-stone-700/40 dark:bg-stone-900/40 dark:text-stone-300',
}

const EXP_STATUS_CLASS_ARCHIVED: Readonly<Record<ExperimentStatus, string>> = {
  OPEN: 'border-sky-200 bg-sky-50/60 text-sky-600 dark:border-sky-800/40 dark:bg-sky-950/20 dark:text-sky-300',
  RESOLVED:
    'border-emerald-200 bg-emerald-50/60 text-emerald-600 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300',
  ABANDONED:
    'border-stone-200 bg-stone-50/60 text-stone-600 dark:border-stone-700/40 dark:bg-stone-900/20 dark:text-stone-400',
}

export function ExperimentStatusPill({
  status,
  archived,
  className,
}: {
  status: ExperimentStatus
  /** v4: when true, render the desaturated variant + Archive icon prefix. */
  archived?: boolean
  className?: string
}) {
  const Icon = EXP_STATUS_ICON[status]
  const palette = archived ? EXP_STATUS_CLASS_ARCHIVED[status] : EXP_STATUS_CLASS[status]
  return (
    <Badge variant="outline" className={cn('gap-1 font-medium', palette, className)}>
      {archived && <ArchiveIcon className="size-3" aria-label="archived" />}
      <Icon className="size-3" aria-hidden />
      {status}
    </Badge>
  )
}

// ---------- Hypothesis status ----------

type HypothesisStatus = 'CONFIRMED' | 'REFUTED' | 'PARTIAL' | 'OPEN' | 'DEFERRED'

const HYP_STATUS_ICON: Readonly<Record<HypothesisStatus, LucideIcon>> = {
  CONFIRMED: CheckCircle2,
  REFUTED: XCircle,
  PARTIAL: CircleDot,
  OPEN: Circle,
  DEFERRED: CircleSlash,
}

const HYP_STATUS_CLASS: Readonly<Record<HypothesisStatus, string>> = {
  CONFIRMED:
    'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-950/40 dark:text-emerald-200',
  REFUTED:
    'border-red-300 bg-red-50 text-red-800 dark:border-red-700/40 dark:bg-red-950/40 dark:text-red-200',
  PARTIAL:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-200',
  OPEN: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700/40 dark:bg-sky-950/40 dark:text-sky-200',
  DEFERRED: 'border-muted-foreground/30 bg-muted text-muted-foreground',
}

export function HypothesisStatusPill({
  status,
  className,
}: {
  status: HypothesisStatus
  className?: string
}) {
  const Icon = HYP_STATUS_ICON[status]
  return (
    <Badge
      variant="outline"
      className={cn('gap-1 font-medium', HYP_STATUS_CLASS[status], className)}
    >
      <Icon className="size-3" aria-hidden />
      {status}
    </Badge>
  )
}
