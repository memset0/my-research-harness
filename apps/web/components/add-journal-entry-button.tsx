'use client'

import { useState } from 'react'
import { Button } from './ui'
import { AddEventModal } from './add-event-modal'

export function AddJournalEntryButton({ project }: { project: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        + Add entry
      </Button>
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
