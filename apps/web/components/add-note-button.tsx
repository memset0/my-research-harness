'use client'

import { useState } from 'react'
import { Button } from './ui/button'
import { AddEventModal } from './add-event-modal'
import { ViewerGuard } from './viewer-guard'

export function AddNoteButton({
  project,
  runId,
}: {
  project: string
  runId: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <ViewerGuard reason="Add note">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          + Note
        </Button>
      </ViewerGuard>
      <AddEventModal
        mode="note"
        project={project}
        runId={runId}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
