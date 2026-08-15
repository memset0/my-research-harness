'use client'

import type {
  ImplementationDocument,
  ImplementationItem,
  ImplementationStatus,
  InvestigationDocument,
  InvestigationItem,
  InvestigationStatus,
} from '@memon/core'
import {
  BadgeCheck,
  Ban,
  CheckCircle2,
  Circle,
  CircleDot,
  CircleHelp,
  CircleSlash2,
  Code2,
  FileCode2,
  FlaskConical,
  GitCommitHorizontal,
  GitPullRequest,
  Link2,
  ListChecks,
  type LucideIcon,
  Milestone,
  Network,
  Search,
  Target,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '../lib/utils'
import { Markdown } from './markdown'
import { Badge } from './ui/badge'

type ManagedDocumentKind = 'implementation' | 'investigation'
type ManagedDocument = ImplementationDocument | InvestigationDocument
type ManagedItem = ImplementationItem | InvestigationItem
type ManagedStatus = ImplementationStatus | InvestigationStatus

const STATUS_STYLE: Record<
  ManagedStatus,
  { icon: LucideIcon; className: string; markerClassName: string }
> = {
  TODO: {
    icon: Circle,
    className:
      'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700/50 dark:bg-slate-900/50 dark:text-slate-300',
    markerClassName: 'bg-slate-400 dark:bg-slate-500',
  },
  PLANNED: {
    icon: Circle,
    className:
      'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700/50 dark:bg-slate-900/50 dark:text-slate-300',
    markerClassName: 'bg-slate-400 dark:bg-slate-500',
  },
  IN_PROGRESS: {
    icon: CircleDot,
    className:
      'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700/50 dark:bg-sky-950/50 dark:text-sky-200',
    markerClassName: 'bg-sky-500 dark:bg-sky-400',
  },
  BLOCKED: {
    icon: Ban,
    className:
      'border-red-300 bg-red-50 text-red-800 dark:border-red-700/50 dark:bg-red-950/40 dark:text-red-200',
    markerClassName: 'bg-red-500 dark:bg-red-400',
  },
  DONE: {
    icon: CheckCircle2,
    className:
      'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/50 dark:bg-emerald-950/40 dark:text-emerald-200',
    markerClassName: 'bg-emerald-500 dark:bg-emerald-400',
  },
  ANSWERED: {
    icon: BadgeCheck,
    className:
      'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/50 dark:bg-emerald-950/40 dark:text-emerald-200',
    markerClassName: 'bg-emerald-500 dark:bg-emerald-400',
  },
  INCONCLUSIVE: {
    icon: CircleHelp,
    className:
      'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200',
    markerClassName: 'bg-amber-500 dark:bg-amber-400',
  },
  DROPPED: {
    icon: CircleSlash2,
    className:
      'border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-700/50 dark:bg-stone-900/50 dark:text-stone-300',
    markerClassName: 'bg-stone-400 dark:bg-stone-500',
  },
}

const STATUS_ORDER: Record<ManagedDocumentKind, ManagedStatus[]> = {
  implementation: ['IN_PROGRESS', 'BLOCKED', 'TODO', 'DONE', 'DROPPED'],
  investigation: ['IN_PROGRESS', 'BLOCKED', 'PLANNED', 'ANSWERED', 'INCONCLUSIVE', 'DROPPED'],
}

export function ExperimentManagedSection({
  kind,
  document,
  project,
  experimentId,
}: {
  kind: ManagedDocumentKind
  document: ManagedDocument
  project: string
  experimentId: string
}) {
  const items = document.items as ManagedItem[]
  const flatItems = flattenItems(items)
  const statusCounts = new Map<ManagedStatus, number>()
  for (const item of flatItems) {
    statusCounts.set(item.status, (statusCounts.get(item.status) ?? 0) + 1)
  }

  return (
    <div className="space-y-3" data-slot={`${kind}-document`}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/35 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {kind === 'implementation' ? (
            <Code2 className="size-3.5" aria-hidden />
          ) : (
            <FlaskConical className="size-3.5" aria-hidden />
          )}
          <span data-slot="document-summary">
            <strong className="font-medium tabular-nums text-foreground">{flatItems.length}</strong>{' '}
            {flatItems.length === 1 ? 'item' : 'items'} across {items.length}{' '}
            {items.length === 1 ? 'workstream' : 'workstreams'}
          </span>
        </div>
        <fieldset className="flex flex-wrap items-center gap-1">
          <legend className="sr-only">Status summary</legend>
          {STATUS_ORDER[kind].map((status) => {
            const count = statusCounts.get(status) ?? 0
            return count > 0 ? (
              <StatusBadge key={status} status={status} count={count} compact />
            ) : null
          })}
        </fieldset>
      </div>

      {items.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-8 text-center text-xs italic text-muted-foreground">
          No {kind} items yet.
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <ManagedItemNode
              key={item.id}
              item={item}
              kind={kind}
              project={project}
              experimentId={experimentId}
              depth={0}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ManagedItemNode({
  item,
  kind,
  project,
  experimentId,
  depth,
}: {
  item: ManagedItem
  kind: ManagedDocumentKind
  project: string
  experimentId: string
  depth: number
}) {
  const style = STATUS_STYLE[item.status]
  const childItems = item.children as ManagedItem[]
  const settledChildren = childItems.filter((child) => isSettled(child.status)).length
  const description = item.description

  return (
    <li className="relative list-none" data-depth={depth}>
      <article
        id={item.id}
        className="relative scroll-mt-20 overflow-hidden rounded-md border bg-card shadow-xs"
        data-item-id={item.id}
      >
        <span className={cn('absolute inset-y-0 left-0 w-1', style.markerClassName)} aria-hidden />
        <div className="space-y-3 py-3 pr-3 pl-4">
          <header className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <a
                  href={`#${item.id}`}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={`Link to ${item.id}`}
                >
                  {item.id}
                </a>
                {childItems.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
                    <Network className="size-3" aria-hidden />
                    {settledChildren}/{childItems.length} child items settled
                  </span>
                )}
              </div>
              <h3 className="text-sm font-medium leading-snug text-foreground">{item.title}</h3>
            </div>
            <StatusBadge status={item.status} />
          </header>

          {description && <RichText>{description}</RichText>}

          {kind === 'implementation' ? (
            <ImplementationDetails
              item={item as ImplementationItem}
              project={project}
              experimentId={experimentId}
            />
          ) : (
            <InvestigationDetails item={item as InvestigationItem} />
          )}
        </div>
      </article>

      {childItems.length > 0 && (
        <ul className="relative ml-2 min-w-0 space-y-2 border-l pt-2 pl-2 sm:ml-4 sm:pl-4">
          {childItems.map((child) => (
            <ManagedItemNode
              key={child.id}
              item={child}
              kind={kind}
              project={project}
              experimentId={experimentId}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function ImplementationDetails({
  item,
  project,
  experimentId,
}: {
  item: ImplementationItem
  project: string
  experimentId: string
}) {
  return (
    <div className="space-y-3">
      {item.acceptanceCriteria.length > 0 && (
        <CriteriaBlock
          icon={ListChecks}
          label="Acceptance criteria"
          items={item.acceptanceCriteria}
        />
      )}

      <MetadataRows>
        {item.dependsOn.length > 0 && (
          <MetadataRow icon={Link2} label="Depends on">
            {item.dependsOn.map((id) => (
              <ReferenceChip key={id} id={id} />
            ))}
          </MetadataRow>
        )}
        {item.files.length > 0 && (
          <MetadataRow icon={FileCode2} label="Files">
            {item.files.map((file) => (
              <CodeChip key={file}>{file}</CodeChip>
            ))}
          </MetadataRow>
        )}
        {item.commits.length > 0 && (
          <MetadataRow icon={GitCommitHorizontal} label="Commits">
            {item.commits.map((commit) => {
              const label = `${commit.repo === '.' ? '' : `${commit.repo}:`}${shortSha(commit.sha)}`
              return commit.url ? (
                <a
                  key={`${commit.repo}:${commit.sha}`}
                  href={commit.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground underline-offset-2 hover:underline"
                  title={`${commit.repo}:${commit.sha}`}
                >
                  {label}
                </a>
              ) : (
                <CodeChip
                  key={`${commit.repo}:${commit.sha}`}
                  title={`${commit.repo}:${commit.sha}`}
                >
                  {label}
                </CodeChip>
              )
            })}
          </MetadataRow>
        )}
        {item.codeReviews.length > 0 && (
          <MetadataRow icon={GitPullRequest} label="Code reviews">
            {item.codeReviews.map((review) => (
              <Link
                key={review}
                href={codeReviewHref(project, experimentId, review)}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground underline-offset-2 hover:underline"
              >
                {review}
              </Link>
            ))}
          </MetadataRow>
        )}
      </MetadataRows>

      {item.outcome && (
        <OutcomeBlock tone={item.status === 'DONE' ? 'success' : 'neutral'}>
          {item.outcome}
        </OutcomeBlock>
      )}
    </div>
  )
}

function InvestigationDetails({ item }: { item: InvestigationItem }) {
  return (
    <div className="space-y-3">
      {item.question && (
        <Callout icon={Search} label="Question" tone="question">
          {item.question}
        </Callout>
      )}
      {item.rationale && (
        <Callout icon={Milestone} label="Rationale" tone="neutral">
          {item.rationale}
        </Callout>
      )}
      {item.successCriteria.length > 0 && (
        <CriteriaBlock icon={Target} label="Success criteria" items={item.successCriteria} />
      )}

      <MetadataRows>
        {item.dependsOn.length > 0 && (
          <MetadataRow icon={Link2} label="Depends on">
            {item.dependsOn.map((id) => (
              <ReferenceChip key={id} id={id} />
            ))}
          </MetadataRow>
        )}
        {item.variantIds.length > 0 && (
          <MetadataRow icon={FlaskConical} label="Variants">
            {item.variantIds.map((id) => (
              <CodeChip key={id}>{id}</CodeChip>
            ))}
          </MetadataRow>
        )}
      </MetadataRows>

      {item.outcome && (
        <OutcomeBlock
          tone={
            item.status === 'ANSWERED'
              ? 'success'
              : item.status === 'INCONCLUSIVE'
                ? 'warning'
                : 'neutral'
          }
        >
          {item.outcome}
        </OutcomeBlock>
      )}
    </div>
  )
}

function StatusBadge({
  status,
  count,
  compact = false,
}: {
  status: ManagedStatus
  count?: number
  compact?: boolean
}) {
  const style = STATUS_STYLE[status]
  const Icon = style.icon
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 font-medium tabular-nums',
        compact && 'h-4 px-1.5 text-[9px]',
        style.className,
      )}
    >
      <Icon className="size-2.5" aria-hidden />
      {status.replace('_', ' ')}
      {count !== undefined && (
        <span>
          <span className="sr-only">{count} items</span>
          <span aria-hidden>· {count}</span>
        </span>
      )}
    </Badge>
  )
}

function CriteriaBlock({
  icon: Icon,
  label,
  items,
}: {
  icon: LucideIcon
  label: string
  items: string[]
}) {
  return (
    <section className="rounded-md border bg-muted/20 px-3 py-2.5">
      <h4 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3" aria-hidden />
        {label}
      </h4>
      <ul className="space-y-1.5">
        {withOccurrenceKeys(items).map(({ key, value: criterion }) => (
          <li key={key} className="flex items-start gap-2 text-xs leading-relaxed">
            <span className="mt-[0.45rem] size-1 shrink-0 rounded-full bg-muted-foreground/60" />
            <RichText className="min-w-0 flex-1">{criterion}</RichText>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Callout({
  icon: Icon,
  label,
  tone,
  children,
}: {
  icon: LucideIcon
  label: string
  tone: 'question' | 'neutral'
  children: string
}) {
  return (
    <section
      className={cn(
        'rounded-md border px-3 py-2.5',
        tone === 'question'
          ? 'border-sky-200 bg-sky-50/60 dark:border-sky-800/50 dark:bg-sky-950/25'
          : 'bg-muted/20',
      )}
    >
      <h4
        className={cn(
          'mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide',
          tone === 'question' ? 'text-sky-700 dark:text-sky-300' : 'text-muted-foreground',
        )}
      >
        <Icon className="size-3" aria-hidden />
        {label}
      </h4>
      <RichText>{children}</RichText>
    </section>
  )
}

function OutcomeBlock({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'neutral'
  children: string
}) {
  return (
    <section
      className={cn(
        'rounded-md border px-3 py-2.5',
        tone === 'success' &&
          'border-emerald-200 bg-emerald-50/60 dark:border-emerald-800/50 dark:bg-emerald-950/25',
        tone === 'warning' &&
          'border-amber-200 bg-amber-50/60 dark:border-amber-800/50 dark:bg-amber-950/25',
        tone === 'neutral' && 'bg-muted/20',
      )}
    >
      <h4
        className={cn(
          'mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide',
          tone === 'success' && 'text-emerald-700 dark:text-emerald-300',
          tone === 'warning' && 'text-amber-700 dark:text-amber-300',
          tone === 'neutral' && 'text-muted-foreground',
        )}
      >
        <BadgeCheck className="size-3" aria-hidden />
        Outcome
      </h4>
      <RichText>{children}</RichText>
    </section>
  )
}

function MetadataRows({ children }: { children: ReactNode }) {
  return <dl className="space-y-1.5 empty:hidden">{children}</dl>
}

function MetadataRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon
  label: string
  children: ReactNode
}) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-start">
      <dt className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:pt-0.5">
        <Icon className="size-3" aria-hidden />
        {label}
      </dt>
      <dd className="flex min-w-0 flex-wrap gap-1">{children}</dd>
    </div>
  )
}

function ReferenceChip({ id }: { id: string }) {
  return (
    <a
      href={`#${id}`}
      className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground underline-offset-2 hover:underline"
    >
      {id}
    </a>
  )
}

function CodeChip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <code
      className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground"
      title={title ?? (typeof children === 'string' ? children : undefined)}
    >
      {children}
    </code>
  )
}

function RichText({ children, className }: { children: string; className?: string }) {
  return (
    <Markdown
      className={cn(
        'text-xs/relaxed text-foreground/85',
        '[&_p]:my-0 [&_p+p]:mt-1.5',
        '[&_ul]:my-1 [&_ol]:my-1',
        className,
      )}
    >
      {children}
    </Markdown>
  )
}

function flattenItems(items: ManagedItem[]): ManagedItem[] {
  return items.flatMap((item) => [item, ...flattenItems(item.children as ManagedItem[])])
}

function isSettled(status: ManagedStatus): boolean {
  return ['DONE', 'ANSWERED', 'INCONCLUSIVE', 'DROPPED'].includes(status)
}

function shortSha(sha: string): string {
  return sha.length > 8 ? sha.slice(0, 8) : sha
}

function codeReviewHref(project: string, experimentId: string, review: string): string {
  const withoutExtension = review.replace(/\.md$/i, '')
  const normalized = withoutExtension.startsWith('code-review/')
    ? `experiments/${experimentId}/${withoutExtension}`
    : withoutExtension
  const encoded = normalized.split('/').map(encodeURIComponent).join('/')
  return `/p/${encodeURIComponent(project)}/code-review/${encoded}`
}

function withOccurrenceKeys(values: string[]): Array<{ key: string; value: string }> {
  const occurrences = new Map<string, number>()
  return values.map((value) => {
    const occurrence = (occurrences.get(value) ?? 0) + 1
    occurrences.set(value, occurrence)
    return { key: `${value}\0${occurrence}`, value }
  })
}
