'use client'

import { useState } from 'react'
import type { ProjectTarget } from '../lib/api'
import { AddEventModal } from './add-event-modal'
import { Button } from './ui/button'
import { ViewerGuard } from './viewer-guard'

export function AddNoteButton({ project, runId }: { project: ProjectTarget; runId: string }) {
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
