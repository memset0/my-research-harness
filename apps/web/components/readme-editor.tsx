'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { fetchReadme, putReadme, type PutReadmeConflict } from '../lib/api'
import { readPlainPref, writePlainPref } from '../lib/readme-editor-prefs'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { ReadmeEditorToolbar } from './readme-editor-toolbar'
import { ReadmeMonaco } from './readme-monaco'
import { ReadmePlain } from './readme-plain'

// react-diff-viewer-continued is client-only.
const DiffViewer = dynamic(
  () => import('react-diff-viewer-continued').then((m) => m.default),
  {
    ssr: false,
    loading: () => <div className="p-6 text-sm text-muted-foreground">loading diff…</div>,
  },
)

const DRAFT_PREFIX = 'memon:draft:'
const DEBOUNCE_MS = 500
const STALE_DRAFT_MS = 7 * 24 * 60 * 60 * 1000
const MIN_DRAFT_DIFF = 5

interface DraftRecord {
  content: string
  savedAt: string
}

type Phase = 'loading' | 'recovery-prompt' | 'editing' | 'saving' | 'conflict' | 'load-error'

export type ContainerKind = 'dialog' | 'panel'

export interface ReadmeEditorBodyProps {
  path: string
  runId: string
  onClose: () => void
  containerKind: ContainerKind
  /** Slot for the panel collapse / close buttons; rendered at the right end of the toolbar. */
  toolbarTrailing?: React.ReactNode
}

export function ReadmeEditorBody({
  path,
  runId,
  onClose,
  containerKind,
  toolbarTrailing,
}: ReadmeEditorBodyProps) {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<Phase>('loading')
  const [content, setContent] = useState('')
  const [diskContent, setDiskContent] = useState('')
  const [diskMtime, setDiskMtime] = useState<number | null>(null)
  const [diskHash, setDiskHash] = useState<string | null>(null)
  const [draftContent, setDraftContent] = useState<string | null>(null)
  const [conflict, setConflict] = useState<PutReadmeConflict | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Initial render must match between SSR and client hydration: read the
  // localStorage pref AFTER mount, not in the useState initializer (which
  // runs once on each side and would diverge when localStorage is set).
  const [plain, setPlainState] = useState<boolean>(false)
  useEffect(() => {
    setPlainState(readPlainPref())
  }, [])
  const plainTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  const draftKey = useCallback((mtime: number) => `${DRAFT_PREFIX}${path}:${mtime}`, [path])

  const setPlain = useCallback((v: boolean) => {
    setPlainState(v)
    writePlainPref(v)
  }, [])

  // Load + draft recovery on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      cleanupStaleDrafts()
      try {
        const r = await fetchReadme(path)
        if (cancelled) return
        setDiskContent(r.content)
        setDiskMtime(r.mtime)
        setDiskHash(r.hash)
        const key = `${DRAFT_PREFIX}${path}:${r.mtime}`
        const draft = readDraft(key)
        if (
          draft &&
          Math.abs(draft.length - r.content.length) >= MIN_DRAFT_DIFF &&
          draft !== r.content
        ) {
          setDraftContent(draft)
          setPhase('recovery-prompt')
        } else {
          if (draft) safeRemove(key)
          setContent(r.content)
          setPhase('editing')
        }
      } catch (err) {
        if (cancelled) return
        setLoadError((err as Error).message)
        setPhase('load-error')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [path])

  // Debounced autosave
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (diskMtime === null) return
    if (phase !== 'editing') return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      try {
        const record: DraftRecord = { content, savedAt: new Date().toISOString() }
        localStorage.setItem(draftKey(diskMtime), JSON.stringify(record))
      } catch {
        toast.error('Draft autosave failed (storage full)')
      }
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [content, diskMtime, draftKey, phase])

  const handleSave = async () => {
    if (diskMtime === null) return
    setPhase('saving')
    try {
      const res = await putReadme({
        path,
        content,
        expectedMtime: diskMtime,
        expectedHash: diskHash ?? undefined,
      })
      if ('error' in res && res.error?.code === 'CONFLICT') {
        setConflict(res)
        setPhase('conflict')
      } else if ('mtime' in res) {
        toast.success(`Saved · mtime ${new Date(res.mtime).toLocaleTimeString()}`)
        safeRemove(draftKey(diskMtime))
        queryClient.invalidateQueries({ queryKey: ['experiment', runId] })
        queryClient.invalidateQueries({ queryKey: ['experiments'] })
        // Refresh the in-memory baseline so dirty state clears.
        setDiskContent(content)
        setDiskMtime(res.mtime)
        setDiskHash(null)
        if (containerKind === 'dialog') {
          onClose()
        } else {
          setPhase('editing')
        }
      }
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`, {
        action: { label: 'Retry', onClick: () => void handleSave() },
      })
      setPhase('editing')
    }
  }

  const handleKeepMine = async () => {
    if (!conflict) return
    setPhase('saving')
    try {
      const res = await putReadme({
        path,
        content,
        expectedMtime: conflict.mtime,
      })
      if ('error' in res && res.error?.code === 'CONFLICT') {
        setConflict(res)
        setPhase('conflict')
      } else if ('mtime' in res) {
        toast.success('Saved (overwrote conflicting changes)')
        if (diskMtime !== null) safeRemove(draftKey(diskMtime))
        queryClient.invalidateQueries({ queryKey: ['experiment', runId] })
        queryClient.invalidateQueries({ queryKey: ['experiments'] })
        setDiskContent(content)
        setDiskMtime(res.mtime)
        setDiskHash(null)
        setConflict(null)
        if (containerKind === 'dialog') {
          onClose()
        } else {
          setPhase('editing')
        }
      }
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`)
      setPhase('conflict')
    }
  }

  const handleDiscardMine = () => {
    if (!conflict) return
    if (diskMtime !== null) safeRemove(draftKey(diskMtime))
    setContent(conflict.content)
    setDiskContent(conflict.content)
    setDiskMtime(conflict.mtime)
    setDiskHash(null)
    setConflict(null)
    setPhase('editing')
  }

  const handleCancelConflict = () => {
    setConflict(null)
    setPhase('editing')
  }

  const restoreDraft = () => {
    if (draftContent !== null) setContent(draftContent)
    setPhase('editing')
  }

  const discardDraftFromDisk = () => {
    if (diskMtime !== null) safeRemove(draftKey(diskMtime))
    setContent(diskContent)
    setPhase('editing')
  }

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content)
        toast.success('Copied · README markdown')
        return
      }
      throw new Error('clipboard unavailable')
    } catch {
      // Fallback: select text in the plain textarea (only works in plain mode)
      if (plain && plainTextareaRef.current) {
        plainTextareaRef.current.select()
      }
      toast.error('Clipboard blocked — please copy manually')
    }
  }

  const handleMonacoLoadError = useCallback(
    (_err: unknown) => {
      // Auto-fall back to plain. Do NOT persist the user's preference — this
      // is a transient failure, the next session should still try Monaco.
      setPlainState(true)
      toast.error('Editor failed to load — using plain text fallback')
    },
    [],
  )

  const dirty = phase === 'editing' && content !== diskContent
  const saving = phase === 'saving'

  // ---------- render branches ----------

  if (phase === 'loading') {
    return <div className="p-8 text-center text-sm text-muted-foreground">loading…</div>
  }

  if (phase === 'load-error') {
    return (
      <div className="p-8 text-center text-sm">
        <p className="text-destructive">Could not load README: {loadError}</p>
        <Button className="mt-4" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    )
  }

  if (phase === 'recovery-prompt' && draftContent) {
    return (
      <div className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">Unsaved draft found</h2>
        <p className="text-sm text-muted-foreground">
          A draft from a previous session ({draftContent.length.toLocaleString()} characters)
          is saved locally. The on-disk file has{' '}
          <span className="font-mono">{diskContent.length.toLocaleString()}</span> characters.
          What would you like to do?
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={restoreDraft}>Restore my draft</Button>
          <Button variant="outline" onClick={discardDraftFromDisk}>
            Discard draft, use disk
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  if (phase === 'conflict' && conflict) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <h2 className="text-sm font-semibold text-amber-700 dark:text-amber-400">
            Conflict — disk changed since you opened the editor
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleCancelConflict}>
              Back to editor
            </Button>
            <Button variant="outline" size="sm" onClick={handleDiscardMine}>
              Discard mine
            </Button>
            <Button size="sm" onClick={() => void handleKeepMine()}>
              Keep mine (overwrite)
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2 text-xs">
          <DiffViewer
            oldValue={conflict.content}
            newValue={content}
            splitView
            leftTitle="Disk (newer)"
            rightTitle="Your draft"
            styles={{
              contentText: { fontFamily: 'ui-monospace, monospace', fontSize: 12 },
            }}
          />
        </div>
      </div>
    )
  }

  // editing | saving
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ReadmeEditorToolbar
        path={path}
        dirty={dirty}
        saving={saving}
        plain={plain}
        onPlainChange={setPlain}
        onCopy={() => void handleCopy()}
        onSave={() => void handleSave()}
        onCancel={onClose}
        trailing={toolbarTrailing}
        closeAs={containerKind === 'panel' ? 'close' : 'cancel'}
      />
      <div className="min-h-0 flex-1 overflow-hidden bg-white">
        {plain ? (
          <ReadmePlain ref={plainTextareaRef} value={content} onChange={setContent} />
        ) : (
          <ReadmeMonaco
            value={content}
            onChange={setContent}
            onLoadError={handleMonacoLoadError}
          />
        )}
      </div>
    </div>
  )
}

/** Dialog-wrapped editor for mobile/tablet (and the legacy callsite). */
export function ReadmeEditor({
  path,
  runId,
  onClose,
}: {
  path: string
  runId: string
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="!max-w-5xl gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Edit README</DialogTitle>
        <DialogDescription className="sr-only">{path}</DialogDescription>
        <div className="flex h-[85vh] min-h-0 flex-col">
          <ReadmeEditorBody
            path={path}
            runId={runId}
            onClose={onClose}
            containerKind="dialog"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------- helpers ----------

function readDraft(key: string): string | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraftRecord
    return typeof parsed.content === 'string' ? parsed.content : null
  } catch {
    return null
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

// All localStorage prefixes that participate in the 7-day stale-draft sweep.
// `memon:draft:` is the canonical README editor draft; the `memon:warning-*-draft:`
// families belong to the Warnings card (Note edits + Add-warning form drafts).
// Any future draft type should be added here so it shares the cleanup cadence.
const STALE_DRAFT_PREFIXES = ['memon:draft:', 'memon:warning-note-draft:', 'memon:warning-add-draft:']

function cleanupStaleDrafts(): void {
  if (typeof localStorage === 'undefined') return
  const cutoff = Date.now() - STALE_DRAFT_MS
  const toRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) continue
    if (!STALE_DRAFT_PREFIXES.some((p) => key.startsWith(p))) continue
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as DraftRecord
      const savedAt = Date.parse(parsed.savedAt)
      if (Number.isFinite(savedAt) && savedAt < cutoff) {
        toRemove.push(key)
      }
    } catch {
      toRemove.push(key)
    }
  }
  for (const key of toRemove) safeRemove(key)
}
