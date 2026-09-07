'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { resolveDocumentResourceUrl } from '../../lib/document-resource-url'
import type { MemonDataTable, MemonDataV1 } from '../../lib/wiki-components/memon-data@1'
import { memonDataCommitLabel, parseMemonDataFile } from '../../lib/wiki-components/memon-data@1'
import { cn } from '../../lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table'

type FileState =
  | { phase: 'inline' }
  | { phase: 'unresolvable' }
  | { phase: 'loading' }
  | { phase: 'ready'; table: MemonDataTable }
  | { phase: 'error'; message: string }

/**
 * Fetch the `data:` file of a file-form block through the containing
 * document's asset route. Surfaces without an asset base (a Run README, an
 * Experiment README, a single-file wiki page) cannot resolve a bundle path at
 * all, which the block reports in place instead of failing the page.
 */
function useDataFile(data: MemonDataV1, assetBase: string | null): FileState {
  const [state, setState] = useState<FileState>(() =>
    data.file === null
      ? { phase: 'inline' }
      : assetBase
        ? { phase: 'loading' }
        : { phase: 'unresolvable' },
  )

  useEffect(() => {
    const file = data.file
    if (file === null) {
      setState({ phase: 'inline' })
      return
    }
    const url = assetBase ? resolveDocumentResourceUrl(assetBase, file) : null
    if (!url) {
      setState({ phase: 'unresolvable' })
      return
    }
    const controller = new AbortController()
    setState({ phase: 'loading' })
    void fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return parseMemonDataFile(file, await response.text())
      })
      .then((table) => setState({ phase: 'ready', table }))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setState({
          phase: 'error',
          message: cause instanceof Error ? cause.message : String(cause),
        })
      })
    return () => controller.abort()
  }, [assetBase, data.file])

  return state
}

export function MemonDataBlock({
  data,
  assetBase,
}: {
  data: MemonDataV1
  assetBase: string | null
}) {
  const fileState = useDataFile(data, assetBase)
  const table = data.table ?? (fileState.phase === 'ready' ? fileState.table : null)
  const commit = memonDataCommitLabel(data)

  return (
    <figure
      className="not-prose my-4 min-w-0 overflow-hidden rounded-md border bg-card text-card-foreground"
      data-wiki-component="memon-data@1"
    >
      {table ? (
        <Table>
          <TableHeader>
            <TableRow>
              {table.columns.map((column) => (
                <TableHead key={column} className="font-mono">
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.map((row, rowIndex) => (
              <TableRow key={`row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <TableCell
                    key={`cell-${cellIndex}`}
                    className={cn(
                      'align-top',
                      typeof cell === 'number' && 'font-mono tabular-nums',
                    )}
                  >
                    {cell === null ? '—' : String(cell)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <DataNotice state={fileState} path={data.file} />
      )}

      <figcaption className="space-y-1 border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {data.title && (
          <div className="font-medium text-foreground" data-memon-data-title>
            {data.title}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>captured {data.capturedAt}</span>
          {commit && (
            <span>
              commit <code className="font-mono">{commit}</code>
            </span>
          )}
          {data.file && (
            <span>
              data <code className="font-mono">{data.file}</code>
            </span>
          )}
        </div>
        {data.script ? (
          <div className="min-w-0 overflow-x-auto">
            <code className="font-mono whitespace-pre">{data.script}</code>
          </div>
        ) : (
          data.code && <CollectionScript runner={data.runner} code={data.code} />
        )}
        {data.note && <p className="text-muted-foreground">{data.note}</p>}
      </figcaption>
    </figure>
  )
}

function CollectionScript({ runner, code }: { runner: string; code: string }) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="font-medium underline decoration-dotted underline-offset-2 hover:text-foreground">
        {isOpen ? 'Hide collection script' : 'Collection script'}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 rounded border bg-background p-2">
          <div className="mb-1 font-mono text-[0.6875rem]">{runner}</div>
          <pre className="min-w-0 overflow-x-auto font-mono text-[0.6875rem] leading-relaxed">
            {code.replace(/\n$/, '')}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function DataNotice({ state, path }: { state: FileState; path: string | null }) {
  if (state.phase === 'loading') {
    return (
      <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Loading <code className="font-mono">{path}</code>…
      </div>
    )
  }
  const message =
    state.phase === 'unresolvable'
      ? `This document has no asset route, so the relative data path ${path} cannot be resolved here. Open the page in its own bundle to see the table.`
      : state.phase === 'error'
        ? `Unable to load ${path}: ${state.message}`
        : 'This block declares no rows.'
  return (
    <div className="flex items-start gap-2 px-3 py-4 text-xs text-muted-foreground" role="alert">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
      <span>{message}</span>
    </div>
  )
}
