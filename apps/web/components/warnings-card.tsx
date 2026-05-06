'use client'

// Renders the `## Warnings` table from a run's README.md as an interactive
// card on the experiment detail page. Each row has Resolve / Reopen / Delete
// controls; the bottom of the card has an Add-warning form.
//
// AI may only APPEND `[OPEN]` rows via the CLI / agent path. Resolve, Reopen,
// and Delete are human-only acts; the controls below are the human path.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  deleteWarningApi,
  fetchWarnings,
  patchWarningApi,
  postWarning,
  type WarningRecord,
  type WarningsOpResponse,
} from '../lib/api'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { Textarea } from './ui/textarea'
import { SuccessBadge, WarningBadge } from './colored-badge'
import { TimestampLocal } from './timestamp'
import { cn } from '../lib/utils'

// Closed enum mirrored from @memon/core. Kept inline here so client bundles
// don't pull `@memon/core` JS at runtime (per CLAUDE.md web conventions).
const WARNING_CATEGORIES: readonly string[] = [
  'methodology',
  'result',
  'config',
  'data',
  'repro',
  'compare',
  'infra',
  'other',
]

const NOTE_DRAFT_PREFIX = 'memon:warning-note-draft:'
const ADD_DRAFT_PREFIX = 'memon:warning-add-draft:'
const DEBOUNCE_MS = 500

interface DraftRecord<T = unknown> {
  value: T
  savedAt: string
}

function loadDraft<T>(key: string): T | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraftRecord<T>
    return parsed.value
  } catch {
    return null
  }
}

function saveDraft<T>(key: string, value: T): void {
  if (typeof localStorage === 'undefined') return
  try {
    const rec: DraftRecord<T> = { value, savedAt: new Date().toISOString() }
    localStorage.setItem(key, JSON.stringify(rec))
  } catch {
    // QuotaExceededError or serialization failure: ignore — we still have
    // in-memory state.
  }
}

function clearDraft(key: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export interface WarningsCardProps {
  runId: string
  readmePath: string
  /** Initial warnings + mtime + hash from the SSR fetch. */
  initialWarnings: WarningRecord[]
  initialMtime: number
}

export function WarningsCard({
  runId,
  readmePath,
  initialWarnings,
  initialMtime,
}: WarningsCardProps) {
  const qc = useQueryClient()
  const [warnings, setWarnings] = useState<WarningRecord[]>(initialWarnings)
  const [mtime, setMtime] = useState(initialMtime)
  const [hash, setHash] = useState<string | undefined>(undefined)

  const refetch = useCallback(async () => {
    try {
      const r = await fetchWarnings(runId)
      setWarnings(r.warnings)
      setMtime(r.mtime)
      setHash(r.hash)
    } catch {
      /* swallow — invalidating the experiment query below will trigger a refresh */
    }
  }, [runId])

  const onMutated = useCallback(
    (out: WarningsOpResponse) => {
      setWarnings(out.warnings)
      setMtime(out.mtime)
      setHash(out.hash)
      qc.invalidateQueries({ queryKey: ['experiment', runId] })
    },
    [runId, qc],
  )

  const handleConflict = useCallback(async () => {
    toast.error('Warnings: someone else changed this README — refreshing')
    await refetch()
    qc.invalidateQueries({ queryKey: ['experiment', runId] })
  }, [runId, qc, refetch])

  const openCount = warnings.filter((w) => w.status === 'OPEN').length
  const resolvedCount = warnings.length - openCount

  return (
    <Card id="warnings">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Warnings</CardTitle>
          {warnings.length > 0 && (
            <span className="flex items-center gap-1 text-xs">
              <WarningBadge>{openCount} open</WarningBadge>
              <SuccessBadge>{resolvedCount} resolved</SuccessBadge>
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {warnings.length === 0 ? (
          <div className="text-xs italic text-muted-foreground/70">
            No warnings — add one if you noticed something the human should review.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="border-b py-1 pr-2 text-left font-medium">Status</th>
                  <th className="border-b py-1 pr-2 text-left font-medium">Created</th>
                  <th className="border-b py-1 pr-2 text-left font-medium">Category</th>
                  <th className="border-b py-1 pr-2 text-left font-medium">Message</th>
                  <th className="border-b py-1 pr-2 text-left font-medium">Resolved</th>
                  <th className="border-b py-1 pr-2 text-left font-medium">Note</th>
                  <th className="border-b py-1 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {warnings.map((w) => (
                  <WarningRow
                    key={w.rowId}
                    w={w}
                    runId={runId}
                    readmePath={readmePath}
                    mtime={mtime}
                    hash={hash}
                    onMutated={onMutated}
                    onConflict={handleConflict}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <AddWarningForm
          runId={runId}
          readmePath={readmePath}
          mtime={mtime}
          hash={hash}
          onMutated={onMutated}
          onConflict={handleConflict}
        />
      </CardContent>
    </Card>
  )
}

interface RowProps {
  w: WarningRecord
  runId: string
  readmePath: string
  mtime: number
  hash: string | undefined
  onMutated: (out: WarningsOpResponse) => void
  onConflict: () => Promise<void>
}

function WarningRow({ w, runId, readmePath, mtime, hash, onMutated, onConflict }: RowProps) {
  const [editingNote, setEditingNote] = useState(false)
  const draftKey = `${NOTE_DRAFT_PREFIX}${readmePath}:${w.rowId}:${mtime}`
  const [note, setNote] = useState<string>(() => loadDraft<string>(draftKey) ?? w.note ?? '')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced draft autosave while typing.
  useEffect(() => {
    if (!editingNote) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => saveDraft(draftKey, note), DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [note, editingNote, draftKey])

  const submitResolve = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        toast.error('Resolve note required')
        return
      }
      setSaving(true)
      try {
        const out = await patchWarningApi(runId, w.rowId, {
          op: 'resolve',
          note: text,
          expectedMtime: mtime,
          expectedHash: hash,
        })
        if ('error' in out) {
          await onConflict()
          return
        }
        clearDraft(draftKey)
        onMutated(out)
        setEditingNote(false)
        toast.success('Warning resolved')
      } catch (err) {
        toast.error(`Resolve failed: ${(err as Error).message}`)
      } finally {
        setSaving(false)
      }
    },
    [draftKey, runId, hash, mtime, onConflict, onMutated, w.rowId],
  )

  const submitReopen = useCallback(async () => {
    setSaving(true)
    try {
      const out = await patchWarningApi(runId, w.rowId, {
        op: 'reopen',
        expectedMtime: mtime,
        expectedHash: hash,
      })
      if ('error' in out) {
        await onConflict()
        return
      }
      onMutated(out)
      toast.success('Warning reopened')
    } catch (err) {
      toast.error(`Reopen failed: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }, [runId, hash, mtime, onConflict, onMutated, w.rowId])

  const submitDelete = useCallback(async () => {
    setSaving(true)
    try {
      const out = await deleteWarningApi(runId, w.rowId, {
        expectedMtime: mtime,
        expectedHash: hash,
      })
      if ('error' in out) {
        await onConflict()
        return
      }
      onMutated(out)
      toast.success('Warning deleted')
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`)
    } finally {
      setSaving(false)
      setConfirmDelete(false)
    }
  }, [runId, hash, mtime, onConflict, onMutated, w.rowId])

  return (
    <tr className={cn('align-top border-b last:border-b-0', w.status === 'RESOLVED' && 'opacity-70')}>
      <td className="py-2 pr-2">
        {w.status === 'OPEN' ? (
          <WarningBadge data-status="open">OPEN</WarningBadge>
        ) : (
          <SuccessBadge data-status="resolved">RESOLVED</SuccessBadge>
        )}
      </td>
      <td className="py-2 pr-2 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
        <TimestampLocal value={w.created} variant="long" />
      </td>
      <td className="py-2 pr-2">
        <Badge variant="outline" className="font-mono text-[10px]">
          {w.category}
        </Badge>
      </td>
      <td className="py-2 pr-2 whitespace-pre-wrap">{w.message}</td>
      <td className="py-2 pr-2 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
        {w.resolved ? <TimestampLocal value={w.resolved} variant="long" /> : '—'}
      </td>
      <td className="py-2 pr-2 whitespace-pre-wrap">
        {editingNote ? (
          <div className="flex flex-col gap-1">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="how was it resolved?"
              className="text-xs"
              data-slot="warning-note-textarea"
            />
            <div className="flex gap-1">
              <Button
                size="sm"
                disabled={saving || !note.trim()}
                onClick={() => submitResolve(note)}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setEditingNote(false)
                  setNote(w.note ?? '')
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <span className="text-xs">{w.note ?? '—'}</span>
        )}
      </td>
      <td className="py-2 text-right">
        <div className="flex flex-wrap justify-end gap-1">
          {w.status === 'OPEN' && !editingNote && (
            <Button size="sm" variant="outline" disabled={saving} onClick={() => setEditingNote(true)}>
              Resolve
            </Button>
          )}
          {w.status === 'RESOLVED' && !editingNote && (
            <>
              <Button size="sm" variant="outline" disabled={saving} onClick={() => setEditingNote(true)}>
                Edit note
              </Button>
              <Button size="sm" variant="ghost" disabled={saving} onClick={submitReopen}>
                Reopen
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={saving}
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </Button>
        </div>
      </td>
      <DeleteConfirm
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={submitDelete}
        message={w.message}
        category={w.category}
      />
    </tr>
  )
}

function DeleteConfirm({
  open,
  onCancel,
  onConfirm,
  message,
  category,
}: {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
  message: string
  category: string
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogTitle>Delete this warning?</DialogTitle>
        <DialogDescription>
          You're about to delete a <span className="font-mono">{category}</span> warning. The full row
          content is recorded in docs/journal.md as a `[WARNING]` event with `op=delete`, but the row will
          be removed from the README's Warnings section.
        </DialogDescription>
        <div className="rounded border bg-muted/30 px-3 py-2 text-xs">{message}</div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface AddFormProps {
  runId: string
  readmePath: string
  mtime: number
  hash: string | undefined
  onMutated: (out: WarningsOpResponse) => void
  onConflict: () => Promise<void>
}

interface AddDraft {
  category: string
  message: string
}

function AddWarningForm({ runId, readmePath, mtime, hash, onMutated, onConflict }: AddFormProps) {
  const draftKey = `${ADD_DRAFT_PREFIX}${readmePath}:${mtime}`
  const initial = loadDraft<AddDraft>(draftKey)
  const [open, setOpen] = useState(initial !== null)
  const [category, setCategory] = useState<string>(initial?.category ?? 'result')
  const [message, setMessage] = useState<string>(initial?.message ?? '')
  const [submitting, setSubmitting] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => saveDraft(draftKey, { category, message }), DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [category, message, open, draftKey])

  const submit = useCallback(async () => {
    if (!message.trim()) return
    setSubmitting(true)
    try {
      const out = await postWarning(runId, {
        category,
        message,
        expectedMtime: mtime,
        expectedHash: hash,
      })
      if ('error' in out) {
        // Conflict (or 409 from another error) — surface and refresh
        await onConflict()
        return
      }
      clearDraft(draftKey)
      onMutated(out)
      setMessage('')
      setOpen(false)
      toast.success('Warning added')
    } catch (err) {
      toast.error(`Add failed: ${(err as Error).message}`)
    } finally {
      setSubmitting(false)
    }
  }, [category, draftKey, runId, hash, message, mtime, onConflict, onMutated])

  if (!open) {
    return (
      <div className="mt-3 flex">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-slot="warnings-add-button">
          + Add warning
        </Button>
      </div>
    )
  }
  return (
    <div className="mt-3 flex flex-col gap-2 rounded border bg-muted/20 p-3" data-slot="warnings-add-form">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">category</span>
        <Select value={category} onValueChange={(v) => setCategory(v)}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="category" />
          </SelectTrigger>
          <SelectContent>
            {WARNING_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c} className="text-xs">
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="what should the human review?"
        rows={3}
        className="text-xs"
        data-slot="warnings-add-message"
      />
      <div className="flex gap-1">
        <Button size="sm" disabled={submitting || !message.trim()} onClick={submit}>
          Add
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={submitting}
          onClick={() => {
            clearDraft(draftKey)
            setMessage('')
            setOpen(false)
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

