'use client'

import { useState } from 'react'
import type { ProjectTarget } from '../lib/api'
import { AddEventModal } from './add-event-modal'
import { Button } from './ui/button'
import { ViewerGuard } from './viewer-guard'

export function AddJournalEntryButton({ project }: { project: ProjectTarget }) {
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
