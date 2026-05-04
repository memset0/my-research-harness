'use client'

import { Copy as CopyIcon, Type as TypeIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'

export interface ReadmeEditorToolbarProps {
  path: string
  dirty: boolean
  saving: boolean
  plain: boolean
  onPlainChange: (next: boolean) => void
  onCopy: () => void
  onSave: () => void
  onCancel: () => void
  /** Slot for collapse / close buttons that only the desktop side panel renders. */
  trailing?: ReactNode
  /** When true, render the cancel button as 'Close' (panel) instead of 'Cancel' (dialog). */
  closeAs?: 'cancel' | 'close'
}

export function ReadmeEditorToolbar({
  path,
  dirty,
  saving,
  plain,
  onPlainChange,
  onCopy,
  onSave,
  onCancel,
  trailing,
  closeAs = 'cancel',
}: ReadmeEditorToolbarProps) {
  const allDisabled = saving
  return (
    <div className="flex flex-col border-b">
      {/* Row 1: title + actions */}
      <div className="flex items-center justify-between gap-2 p-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="shrink-0 text-xs font-semibold">Edit README</h2>
          {dirty && (
            <span
              data-testid="readme-editor-dirty-dot"
              aria-label="Unsaved changes"
              className="inline-block size-1.5 shrink-0 rounded-full bg-amber-500"
            />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant={plain ? 'secondary' : 'ghost'}
            aria-pressed={plain}
            aria-label={plain ? 'Switch to Monaco editor' : 'Switch to plain editor'}
            title={plain ? 'Switch to Monaco editor' : 'Switch to plain editor (monospace textarea)'}
            disabled={allDisabled}
            onClick={() => onPlainChange(!plain)}
            className={cn(plain && 'ring-1 ring-border')}
          >
            <TypeIcon />
            <span className="hidden lg:inline">{plain ? 'Plain' : 'Monaco'}</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Copy markdown"
            title="Copy markdown to clipboard"
            disabled={allDisabled}
            onClick={onCopy}
          >
            <CopyIcon />
            <span className="hidden lg:inline">Copy</span>
          </Button>
          <Button size="sm" variant="ghost" disabled={allDisabled} onClick={onCancel}>
            {closeAs === 'close' ? 'Close' : 'Cancel'}
          </Button>
          <Button size="sm" disabled={allDisabled || !dirty} onClick={onSave}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {trailing}
        </div>
      </div>
      {/* Row 2: full path on its own line, separated by a border */}
      <div className="border-t px-2 py-1">
        <span
          className="block truncate font-mono text-[0.625rem] leading-relaxed text-muted-foreground"
          title={path}
        >
          {path}
        </span>
      </div>
    </div>
  )
}
