'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PencilLine } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { type ProjectTarget, renameDocument } from '../lib/api'
import { queryKeys } from '../lib/query-keys'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'

const MAX_TITLE = 512

/**
 * Owner action that renames a Report or Wiki page's display title. Only the
 * title changes on disk; the ID, slug and path stay.
 */
export function RenameDocumentButton({
  project,
  kind,
  id,
  title,
}: {
  project: ProjectTarget
  kind: 'wiki' | 'report'
  id: string
  title: string
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(title)
  const queryClient = useQueryClient()
  const rename = useMutation({
    mutationFn: (next: string) => renameDocument(project, kind, id, next),
    onSuccess: () => {
      const keys =
        kind === 'report'
          ? [
              queryKeys.report(project, id),
              queryKeys.reports(project),
              queryKeys.reportsInventory(project),
            ]
          : [
              queryKeys.wikiPage(project, id),
              queryKeys.wiki(project),
              queryKeys.wikiInventory(project),
            ]
      for (const queryKey of keys) queryClient.invalidateQueries({ queryKey })
      setOpen(false)
      toast.success(`Renamed ${id}`)
    },
  })
  const trimmed = value.trim()
  const valid = trimmed.length > 0 && trimmed.length <= MAX_TITLE && trimmed !== title
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (valid && !rename.isPending) rename.mutate(trimmed)
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 text-xs"
        onClick={() => {
          setValue(title)
          rename.reset()
          setOpen(true)
        }}
      >
        <PencilLine className="size-3.5" aria-hidden />
        Rename
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Rename {id}</DialogTitle>
              <DialogDescription>
                Changes only the displayed title. The ID, slug and path stay the same.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={`rename-${id}`}>Title</Label>
              <Input
                id={`rename-${id}`}
                value={value}
                maxLength={MAX_TITLE}
                autoFocus
                onChange={(event) => setValue(event.target.value)}
              />
              {rename.error && (
                <p className="text-xs text-destructive" role="alert">
                  {rename.error.message}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!valid || rename.isPending}>
                {rename.isPending ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
