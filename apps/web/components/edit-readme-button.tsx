'use client'

import { useState } from 'react'
import { useIsDesktop } from '@/hooks/use-is-desktop'
import { Button } from './ui/button'
import { ReadmeEditor } from './readme-editor'
import { useReadmeEditorOptional } from './readme-editor-context'
import { ViewerGuard } from './viewer-guard'

export function EditReadmeButton({ path, runId }: { path: string; runId: string }) {
  const isDesktop = useIsDesktop()
  const ctx = useReadmeEditorOptional()
  const [openDialog, setOpenDialog] = useState(false)

  // Desktop path: toggle the side panel via context.
  if (isDesktop && ctx) {
    const isPanelOpen = ctx.open && !ctx.collapsed
    return (
      <ViewerGuard reason="Edit README">
        <Button
          variant={ctx.open ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={ctx.open}
          onClick={() => ctx.setOpen(!ctx.open)}
        >
          {isPanelOpen ? 'Hide editor' : 'Edit README'}
        </Button>
      </ViewerGuard>
    )
  }

  // Mobile / tablet path (or before useIsDesktop has settled, or no provider):
  // open a Dialog locally.
  return (
    <>
      <ViewerGuard reason="Edit README">
        <Button variant="outline" size="sm" onClick={() => setOpenDialog(true)}>
          Edit README
        </Button>
      </ViewerGuard>
      {openDialog && (
        <ReadmeEditor
          path={`${path}/README.md`}
          runId={runId}
          onClose={() => setOpenDialog(false)}
        />
      )}
    </>
  )
}
