'use client'

import { useState } from 'react'
import { Button } from './ui/button'
import { AddEventModal } from './add-event-modal'
import { ViewerGuard } from './viewer-guard'

export function AddJournalEntryButton({ project }: { project: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <ViewerGuard reason="Add journal entry">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          + Add entry
        </Button>
      </ViewerGuard>
      <AddEventModal
        mode="note"
        project={project}
        allowTagSelect
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
