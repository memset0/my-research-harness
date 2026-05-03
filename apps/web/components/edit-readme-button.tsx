'use client'

import { useState } from 'react'
import { Button } from './ui'
import { ReadmeEditor } from './readme-editor'

export function EditReadmeButton({
  path,
  experimentId,
}: {
  path: string
  experimentId: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Edit README
      </Button>
      {open && (
        <ReadmeEditor
          path={`${path}/README.md`}
          experimentId={experimentId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
