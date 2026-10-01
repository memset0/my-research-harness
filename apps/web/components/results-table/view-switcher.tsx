'use client'

import { CopyPlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { ExperimentResultsViewsState } from '../../lib/use-experiment-results-views'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

export type ViewCollection = Pick<
  ExperimentResultsViewsState,
  | 'views'
  | 'activeView'
  | 'canMutate'
  | 'loading'
  | 'error'
  | 'selectView'
  | 'createView'
  | 'renameView'
  | 'deleteView'
>

/**
 * Selects the active Results View and, for owners, creates (duplicates),
 * renames and deletes Views. `onActiveViewReplaced` runs after any change of
 * the active View so mounted-only temporary controls can be cleared.
 */
export function ViewSwitcher({
  experimentId,
  views,
  onActiveViewReplaced,
}: {
  experimentId: string
  views: ViewCollection
  onActiveViewReplaced: () => void
}) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<'create' | 'rename'>('create')
  const [viewName, setViewName] = useState('')
  const [pending, setPending] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const active = views.activeView

  const openEditor = (mode: 'create' | 'rename') => {
    if (mode === 'rename' && !active) return
    setEditorMode(mode)
    setViewName(
      mode === 'rename' ? (active?.name ?? '') : active ? `${active.name} copy` : 'New view',
    )
    setEditorOpen(true)
  }

  const run = async (action: () => Promise<void>, failure: string) => {
    setPending(true)
    try {
      await action()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failure)
    } finally {
      setPending(false)
    }
  }

  const submitEditor = () => {
    const name = viewName.trim()
    if (!name) return
    return run(async () => {
      if (editorMode === 'create') {
        await views.createView(name)
        onActiveViewReplaced()
      } else if (active) {
        await views.renameView(active.id, name)
      }
      setEditorOpen(false)
    }, 'Failed to save View')
  }

  const deleteActive = () => {
    if (!active) return
    return run(async () => {
      await views.deleteView(active.id)
      onActiveViewReplaced()
      setDeleteOpen(false)
    }, 'Failed to delete View')
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-slot="results-view-controls">
      <Label htmlFor={`results-view-${experimentId}`} className="text-xs font-medium">
        View
      </Label>
      <Select
        value={active?.id ?? ''}
        onValueChange={(viewId) => {
          views.selectView(viewId)
          onActiveViewReplaced()
        }}
        disabled={views.loading || views.views.length === 0}
      >
        <SelectTrigger
          id={`results-view-${experimentId}`}
          className="h-8 w-56 max-w-full"
          aria-label="Results view"
        >
          <SelectValue placeholder={views.loading ? 'Loading views…' : 'No saved views'} />
        </SelectTrigger>
        <SelectContent>
          {views.views.map((view) => (
            <SelectItem key={view.id} value={view.id}>
              {view.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Badge variant="secondary" className="tabular-nums">
        {views.views.length} {views.views.length === 1 ? 'view' : 'views'}
      </Badge>
      {views.canMutate ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => openEditor('create')}
            disabled={pending}
          >
            {active ? <CopyPlus data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
            {active ? 'Duplicate' : 'New view'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => openEditor('rename')}
            disabled={!active || pending}
            aria-label="Rename Results view"
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setDeleteOpen(true)}
            disabled={!active || pending}
            aria-label="Delete Results view"
          >
            <Trash2 aria-hidden />
          </Button>
        </>
      ) : (
        <Badge variant="outline">Read-only</Badge>
      )}
      {views.error && (
        <span className="text-xs text-destructive" role="status">
          {views.error}
        </span>
      )}

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editorMode === 'rename'
                ? 'Rename Results view'
                : active
                  ? 'Duplicate Results view'
                  : 'New Results view'}
            </DialogTitle>
            <DialogDescription>
              {editorMode === 'rename'
                ? 'The new name is shared with everyone who can open this Experiment.'
                : active
                  ? 'The new View starts with the active filters, checked columns, and layout.'
                  : 'The new View starts with the default Results table layout.'}
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor={`results-view-name-${experimentId}`}>View name</Label>
          <Input
            id={`results-view-name-${experimentId}`}
            value={viewName}
            maxLength={96}
            onChange={(event) => setViewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && viewName.trim() && !pending) {
                event.preventDefault()
                void submitEditor()
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              onClick={() => void submitEditor()}
              disabled={!viewName.trim() || pending}
            >
              {pending
                ? 'Saving…'
                : editorMode === 'rename'
                  ? 'Rename'
                  : active
                    ? 'Duplicate'
                    : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Results view?</DialogTitle>
            <DialogDescription>
              {active
                ? `“${active.name}” will be removed for everyone who can open this Experiment.`
                : 'This shared View will be removed.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void deleteActive()}
              disabled={!active || pending}
            >
              <Trash2 data-icon="inline-start" />
              {pending ? 'Deleting…' : 'Delete view'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
