'use client'

import { useState } from 'react'
import { useIsDesktop } from '@/hooks/use-is-desktop'
import { Button } from './ui/button'
import { ReadmeEditor } from './readme-editor'
import { useReadmeEditorOptional } from './readme-editor-context'

export function EditReadmeButton({
  path,
  experimentId,
}: {
  path: string
  experimentId: string
}) {
  const isDesktop = useIsDesktop()
  const ctx = useReadmeEditorOptional()
  const [openDialog, setOpenDialog] = useState(false)

  // Desktop path: toggle the side panel via context.
  if (isDesktop && ctx) {
    const isPanelOpen = ctx.open && !ctx.collapsed
    return (
      <Button
        variant={ctx.open ? 'secondary' : 'outline'}
        size="sm"
        aria-pressed={ctx.open}
        onClick={() => ctx.setOpen(!ctx.open)}
      >
        {isPanelOpen ? 'Hide editor' : 'Edit README'}
      </Button>
    )
  }

  // Mobile / tablet path (or before useIsDesktop has settled, or no provider):
  // open a Dialog locally.
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpenDialog(true)}>
        Edit README
      </Button>
      {openDialog && (
        <ReadmeEditor
          path={`${path}/README.md`}
          experimentId={experimentId}
          onClose={() => setOpenDialog(false)}
        />
      )}
    </>
  )
}
