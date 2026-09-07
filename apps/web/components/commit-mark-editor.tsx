'use client'

// Set / change / clear a commit's verification mark. Used in the
// git-history dialog's selected-commit detail header.
//
// Save policy (per spec):
//   - Clicking a status toggle AUTO-saves (status + the current note
//     draft, in one PUT). The user does NOT need to also click Save.
//   - Typing in the note does NOT trigger a save; the Save button (and
//     Ctrl/Cmd+S in the textarea) handles that.
//   - `onDirtyChange` is fired when the note draft diverges from /
//     converges back to the persisted note. The parent uses this to
//     gate commit-switch navigation behind a confirm dialog.

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  deleteCommitMark,
  setCommitMark,
  type CommitMark,
  type CommitMarkStatus,
} from '../lib/api'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { cn } from '../lib/utils'

export interface CommitMarkEditorProps {
  project: string
  sha: string
  mark?: CommitMark | null
  /** When set, mutations are scoped to the named submodule. Empty / undefined = main repo. */
  submodule?: string
  /** Fires on a successful upsert OR delete. */
  onMutated?: () => void
  /** Fires whenever the note draft's dirty state flips. */
  onDirtyChange?: (dirty: boolean) => void
}

const STATUS_OPTIONS: { value: CommitMarkStatus; label: string; dot: string }[] = [
  { value: 'verified', label: 'verified', dot: 'bg-emerald-500' },
  { value: 'suspicious', label: 'suspicious', dot: 'bg-amber-500' },
  { value: 'issue', label: 'issue', dot: 'bg-destructive' },
]

interface SaveVariables {
  /** Override the status when auto-saving from a toggle click. */
  status?: CommitMarkStatus
  /** Override the note (rarely needed). */
  note?: string
}

export function CommitMarkEditor({
  project,
  sha,
  mark,
  submodule,
  onMutated,
  onDirtyChange,
}: CommitMarkEditorProps) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<CommitMarkStatus | null>(mark?.status ?? null)
  const [note, setNote] = useState<string>(mark?.note ?? '')

  // Reset local state if the underlying mark prop changes (e.g. the user
  // selected a different commit, or refresh swapped the data).
  useEffect(() => {
    setStatus(mark?.status ?? null)
    setNote(mark?.note ?? '')
  }, [mark])

  const persistedNote = mark?.note ?? ''
  const noteIsDirty = note !== persistedNote
  // Save button is enabled only when there's a status AND the note (the
  // only thing that needs manual save) differs from the persisted value.
  const canSave = status !== null && noteIsDirty

  // Signal note-dirty transitions up to the parent so it can gate
  // commit-switch navigation. Cleanup fires `false` on unmount so the
  // next mount's editor starts the parent's dirty bookkeeping clean.
  useEffect(() => {
    onDirtyChange?.(noteIsDirty)
    return () => {
      onDirtyChange?.(false)
    }
  }, [noteIsDirty, onDirtyChange])

  const saveMutation = useMutation({
    mutationFn: (vars: SaveVariables = {}) => {
      const finalStatus = vars.status ?? status
      if (!finalStatus) throw new Error('status required')
      const finalNote = vars.note !== undefined ? vars.note : note
      return setCommitMark(
        project,
        sha,
        { status: finalStatus, note: finalNote || undefined },
        submodule,
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commit-marks', project] })
      onMutated?.()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteCommitMark(project, sha, submodule),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commit-marks', project] })
      setStatus(null)
      setNote('')
      onMutated?.()
    },
  })

  const error = saveMutation.error ?? deleteMutation.error
  const inFlight = saveMutation.isPending || deleteMutation.isPending

  function onStatusToggle(next: CommitMarkStatus) {
    setStatus(next)
    // Auto-save the new status + the CURRENT note draft. After the
    // mutation lands and the parent refetches `commit-marks`, this
    // editor's `mark` prop swaps in fresh and the reset effect aligns
    // local state.
    saveMutation.mutate({ status: next })
  }

  function onNoteKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (canSave && !inFlight) {
        saveMutation.mutate({})
      }
    }
  }

  return (
    <div
      data-slot="commit-mark-editor"
      data-sha={sha}
      data-note-dirty={noteIsDirty}
      className="space-y-2 rounded border border-border bg-muted/30 p-2 text-xs"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground" title="Superseded by wiki review; kept for compatibility.">
          mark (deprecated):
        </span>
        <div className="inline-flex overflow-hidden rounded-md border">
          {STATUS_OPTIONS.map((opt) => {
            const active = status === opt.value
            return (
              <Button
                key={opt.value}
                type="button"
                variant={active ? 'default' : 'ghost'}
                size="sm"
                className="h-7 rounded-none px-2 text-xs"
                aria-pressed={active}
                data-active={active}
                data-slot={`commit-mark-option-${opt.value}`}
                onClick={() => onStatusToggle(opt.value)}
                disabled={inFlight}
              >
                <span
                  className={cn('inline-block size-2 rounded-full', opt.dot)}
                  aria-hidden
                />
                {opt.label}
              </Button>
            )
          })}
        </div>
        {mark && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            data-slot="commit-mark-clear"
            onClick={() => deleteMutation.mutate()}
            disabled={inFlight}
          >
            Clear
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          className="ml-auto h-7 px-3 text-xs"
          data-slot="commit-mark-save"
          onClick={() => saveMutation.mutate({})}
          disabled={!canSave || inFlight}
        >
          Save
        </Button>
      </div>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={onNoteKeyDown}
        placeholder="Optional note (e.g. 'check GPU count, also logs'). Ctrl+S to save."
        rows={2}
        className="text-xs"
        data-slot="commit-mark-note"
      />
      {error && (
        <p className="text-xs text-destructive" data-slot="commit-mark-error">
          {(error as Error).message ?? 'mutation failed'}
        </p>
      )}
    </div>
  )
}
