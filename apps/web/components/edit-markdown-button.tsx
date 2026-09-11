'use client'

// v3 id-addressed `Edit markdown` action-bar button. Opens the
// ReadmeEditor in a Dialog with the v3 `target` prop so the editor uses
// /api/{experiments,runs}/:id/readme + disambiguated draft keys.
//
// For run targets where the caller already lives on a run page that has
// the side-panel context (`useReadmeEditorOptional`), prefer the existing
// EditReadmeButton — that one toggles the side panel. This button is the
// dialog-only path used by exp-doc + run-panel action bars.

import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { type EditorTarget, ReadmeEditor } from './readme-editor'
import { Button } from './ui/button'
import { ViewerGuard } from './viewer-guard'

interface Props {
  /** Path used as the editor's display label (passed through to legacy load — see EditorTarget). */
  path?: string
  target: EditorTarget
  /** Display label override; defaults based on target.kind. */
  label?: string
  variant?: 'default' | 'outline' | 'secondary' | 'ghost'
  size?: 'sm' | 'default'
}

export function EditMarkdownButton({
  path,
  target,
  label,
  variant = 'outline',
  size = 'sm',
}: Props) {
  const [open, setOpen] = useState(false)
  const displayPath = path ?? target.id
  const text = label ?? (target.kind === 'exp' ? 'Edit markdown (exp)' : 'Edit markdown (run)')
  return (
    <>
      <ViewerGuard reason="Edit markdown">
        <Button variant={variant} size={size} onClick={() => { window.dispatchEvent(new Event('memon-translation-stop')); setOpen(true) }}>
          <Pencil className="size-3.5" />
          {text}
        </Button>
      </ViewerGuard>
      {open && (
        <ReadmeEditor
          path={displayPath}
          runId={target.id}
          onClose={() => setOpen(false)}
          target={target}
        />
      )}
    </>
  )
}
