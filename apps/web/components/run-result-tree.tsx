'use client'

// A Run's `result.csv` on the Run detail (FS v9), as a collapsible tree of
// its path groups: partitions (`params`, `metrics`, `env`), groups and one
// leaf per path — a scalar value, or the statistic rows of a `stats` value.
// Read-only: values are written with `memon run result set`.

import { ChevronDown, ChevronRight, Table2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { RunResultPayload } from '../lib/dto/experiments'
import { compareStatKeys } from '../lib/experiment-results/stats'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'

interface ResultLeaf {
  path: string
  name: string
  scalar: { value: string; line: number } | null
  stats: Array<{ stat: string; value: string; line: number }>
}

interface ResultGroup {
  path: string
  name: string
  groups: ResultGroup[]
  leaves: ResultLeaf[]
}

const PARTITION_LABELS: Record<string, string> = {
  params: 'Parameters',
  metrics: 'Metrics',
  env: 'Environment',
}

const PARTITION_ORDER = ['params', 'metrics', 'env']

function partitionRank(path: string): number {
  const rank = PARTITION_ORDER.indexOf(path)
  return rank === -1 ? PARTITION_ORDER.length : rank
}

/**
 * Group a result file's rows by their path segments: the partitions in
 * `params`, `metrics`, `env` order (any other top-level group after them),
 * everything else in file order.
 */
export function buildRunResultTree(rows: RunResultPayload['rows']): ResultGroup {
  const root: ResultGroup = { path: '', name: '', groups: [], leaves: [] }
  const groups = new Map<string, ResultGroup>([['', root]])
  const leaves = new Map<string, ResultLeaf>()
  for (const row of rows) {
    const segments = row.key.split('.')
    let parent = root
    for (let index = 0; index < segments.length - 1; index += 1) {
      const path = segments.slice(0, index + 1).join('.')
      let group = groups.get(path)
      if (!group) {
        group = { path, name: segments[index]!, groups: [], leaves: [] }
        groups.set(path, group)
        parent.groups.push(group)
      }
      parent = group
    }
    let leaf = leaves.get(row.key)
    if (!leaf) {
      leaf = { path: row.key, name: segments.at(-1) ?? row.key, scalar: null, stats: [] }
      leaves.set(row.key, leaf)
      parent.leaves.push(leaf)
    }
    if (row.stat === null) leaf.scalar = { value: row.value, line: row.line }
    else leaf.stats.push({ stat: row.stat, value: row.value, line: row.line })
  }
  for (const leaf of leaves.values()) leaf.stats.sort((a, b) => compareStatKeys(a.stat, b.stat))
  root.groups.sort((a, b) => partitionRank(a.path) - partitionRank(b.path))
  return root
}

export function RunResultTree({ result }: { result: RunResultPayload }) {
  const tree = useMemo(() => buildRunResultTree(result.rows), [result.rows])
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity !== 'info')
  return (
    <section className="space-y-1.5" data-slot="run-result-tree">
      <h3 className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
        <Table2 className="size-3.5 text-muted-foreground" aria-hidden />
        Results
        <code className="font-mono text-[10px] font-normal text-muted-foreground">
          {result.resource.split('/').at(-1)}
        </code>
        <Badge variant="outline" className="h-4 px-1.5 text-[9px]" data-result-schema-version>
          schema v{result.schemaVersion ?? '?'}
        </Badge>
        <span className="text-[10px] font-normal text-muted-foreground tabular-nums">
          {result.rows.length} {result.rows.length === 1 ? 'row' : 'rows'}
          {result.truncated ? ' (truncated)' : ''}
        </span>
      </h3>
      {result.rows.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">No values recorded yet.</p>
      ) : (
        <ul className="space-y-0.5 text-xs" aria-label="Run results">
          {tree.groups.map((group) => (
            <GroupNode key={group.path} group={group} depth={0} />
          ))}
          {tree.leaves.map((leaf) => (
            <LeafNode key={leaf.path} leaf={leaf} />
          ))}
        </ul>
      )}
      {errors.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-amber-800 dark:text-amber-200">
          {errors.map((diagnostic) => (
            <li key={`${diagnostic.code}:${diagnostic.line ?? ''}:${diagnostic.message}`}>
              <code>{diagnostic.code}</code>
              {diagnostic.line ? ` (line ${diagnostic.line})` : ''}: {diagnostic.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function GroupNode({ group, depth }: { group: ResultGroup; depth: number }) {
  const [open, setOpen] = useState(true)
  const label = depth === 0 ? (PARTITION_LABELS[group.name] ?? group.name) : group.name
  return (
    <li data-result-group={group.path} data-depth={depth}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn('h-6 gap-1 px-1', depth === 0 ? 'font-semibold' : 'font-medium')}
          >
            {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            {label}
            <span className="font-normal text-muted-foreground tabular-nums">
              ({group.groups.length + group.leaves.length})
            </span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="ml-3 space-y-0.5 border-l pl-2">
            {group.groups.map((child) => (
              <GroupNode key={child.path} group={child} depth={depth + 1} />
            ))}
            {group.leaves.map((leaf) => (
              <LeafNode key={leaf.path} leaf={leaf} />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

function LeafNode({ leaf }: { leaf: ResultLeaf }) {
  return (
    <li className="pl-1" data-result-path={leaf.path}>
      <div className="flex items-baseline gap-2" title={leaf.path}>
        <span className="font-mono text-[11px] text-muted-foreground">{leaf.name}</span>
        {leaf.scalar && (
          <span className="break-all font-mono text-[11px] tabular-nums">
            {leaf.scalar.value === '' ? '—' : leaf.scalar.value}
          </span>
        )}
      </div>
      {leaf.stats.length > 0 && (
        <table className="ml-3 text-[11px]">
          <tbody>
            {leaf.stats.map((row) => (
              <tr key={row.stat}>
                <th
                  scope="row"
                  className="pr-3 text-left font-mono font-normal text-muted-foreground"
                >
                  {row.stat}
                </th>
                <td className="font-mono tabular-nums">{row.value === '' ? '—' : row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  )
}
