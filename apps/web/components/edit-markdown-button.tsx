'use client'

// v3 id-addressed `Edit markdown` action-bar button. Opens the
// ReadmeEditor in a Dialog with the v3 `target` prop so the editor uses
// /api/{experiments,runs}/:id/readme + disambiguated draft keys.
//
// For run targets where the caller already lives on a run page that has
// the side-panel context (`useReadmeEditorOptional`), prefer the existing
// EditReadmeButton — that one toggles the side panel. This button is the
// dialog-only path used by exp-doc + run-panel action bars.

import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { Button } from './ui/button'
import { ReadmeEditor, type EditorTarget } from './readme-editor'

interface Props {
  /** Path used as the editor's display label (passed through to legacy load — see EditorTarget). */
  path: string
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
  const text = label ?? (target.kind === 'exp' ? 'Edit markdown (exp)' : 'Edit markdown (run)')
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <Pencil className="size-3.5" />
        {text}
      </Button>
      {open && (
        <ReadmeEditor
          path={path}
          runId={target.id}
          onClose={() => setOpen(false)}
          target={target}
        />
      )}
    </>
  )
}
