'use client'

import { useState } from 'react'
import { Button } from './ui/button'
import { AddEventModal } from './add-event-modal'

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
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        + Note
      </Button>
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
