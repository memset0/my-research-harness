'use client'

// Reusable per-file diff renderer. Stateless — content + meta come in as
// props; the view mode (split vs inline) comes from `useDiffViewMode()` so
// every mounted instance stays in sync.

import ReactDiffViewer from 'react-diff-viewer-continued'
import type { GitFileStatus } from '../lib/api'
import { useDiffViewMode } from '../lib/use-diff-view-mode'
import { Skeleton } from './ui/skeleton'
import { cn } from '../lib/utils'

export type FileDiffSkipReason = 'too-large' | 'binary' | 'conflict'

export interface FileDiffProps {
  filename: string
  oldFilename?: string
  status: GitFileStatus
  oldContent: string | null
  newContent: string | null
  skipReason?: FileDiffSkipReason | null
  /** Bytes of the offending side; rendered when skipReason === 'too-large'. */
  skipSizeBytes?: number
  /** Max-bytes cap; rendered when skipReason === 'too-large'. */
  skipMaxBytes?: number
  loading?: boolean
  errorMessage?: string | null
  className?: string
}

const SKIP_REASON_LABEL: Record<FileDiffSkipReason, string> = {
  'too-large': 'file too large',
  binary: 'binary file',
  conflict: 'file in merge conflict — resolve in terminal',
}

function normalizeLineEndings(s: string | null): string {
  if (s == null) return ''
  return s.replace(/\r\n/g, '\n')
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export function FileDiff(props: FileDiffProps) {
  const {
    filename,
    oldFilename,
    status,
    oldContent,
    newContent,
    skipReason,
    skipSizeBytes,
    skipMaxBytes,
    loading,
    errorMessage,
    className,
  } = props
  const [mode] = useDiffViewMode()

  if (loading) {
    return (
      <div
        data-slot="file-diff-loading"
        className={cn('px-3 py-2', className)}
      >
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="mt-2 h-4 w-2/3" />
        <Skeleton className="mt-2 h-4 w-4/5" />
      </div>
    )
  }

  if (errorMessage) {
    return (
      <div
        data-slot="file-diff-error"
        className={cn('px-3 py-2 text-xs text-destructive', className)}
      >
        {errorMessage}
      </div>
    )
  }

  if (skipReason) {
    const label = SKIP_REASON_LABEL[skipReason]
    const sizeNote =
      skipReason === 'too-large' && typeof skipSizeBytes === 'number' && typeof skipMaxBytes === 'number'
        ? ` — ${formatBytes(skipSizeBytes)} / ${formatBytes(skipMaxBytes)} cap`
        : ''
    return (
      <div
        data-slot="file-diff-skip"
        data-skip-reason={skipReason}
        className={cn('px-3 py-2 text-xs text-muted-foreground italic', className)}
      >
        {label}
        {sizeNote}
      </div>
    )
  }

  const oldVal = normalizeLineEndings(oldContent)
  const newVal = normalizeLineEndings(newContent)
  const splitView = mode === 'split'
  const leftTitle = oldFilename ?? filename
  const rightTitle = filename

  return (
    <div
      data-slot="file-diff"
      data-status={status}
      data-view-mode={mode}
      className={cn('w-full min-w-0 text-xs', className)}
    >
      <ReactDiffViewer
        oldValue={oldVal}
        newValue={newVal}
        splitView={splitView}
        leftTitle={leftTitle}
        rightTitle={rightTitle}
        useDarkTheme={false}
        hideLineNumbers={false}
        hideSummary
        disableWorker
        styles={RDV_STYLE_OVERRIDES}
      />
    </div>
  )
}

// Force the split-view to fill 100% of the available width with each side
// at exactly 50%, and wrap long lines so the diff never overflows the
// container. RDV's default layout lets columns grow to fit content, which
// makes long lines push the dialog into horizontal scroll — we want fixed
// columns + wrap instead.
const RDV_STYLE_OVERRIDES = {
  diffContainer: {
    width: '100%',
    minWidth: 0,
    tableLayout: 'fixed' as const,
  },
  contentText: {
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    overflowWrap: 'anywhere' as const,
  },
  lineContent: {
    width: '50%',
    minWidth: 0,
  },
  content: {
    width: '50%',
    minWidth: 0,
  },
  column: {
    width: '50%',
    minWidth: 0,
  },
}
