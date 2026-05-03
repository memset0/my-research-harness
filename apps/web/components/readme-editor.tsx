'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { fetchReadme, putReadme, type PutReadmeConflict } from '../lib/api'
import { Button } from './ui'

// @uiw/react-md-editor and react-diff-viewer-continued are client-only.
const MDEditor = dynamic(() => import('@uiw/react-md-editor').then((m) => m.default), {
  ssr: false,
  loading: () => <div className="p-6 text-sm text-slate-500">loading editor…</div>,
})

const DiffViewer = dynamic(
  () => import('react-diff-viewer-continued').then((m) => m.default),
  { ssr: false, loading: () => <div className="p-6 text-sm text-slate-500">loading diff…</div> },
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

export function ReadmeEditor({
  path,
  experimentId,
  onClose,
}: {
  path: string
  experimentId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<Phase>('loading')
  const [content, setContent] = useState('')
  const [diskContent, setDiskContent] = useState('')
  const [diskMtime, setDiskMtime] = useState<number | null>(null)
  const [diskHash, setDiskHash] = useState<string | null>(null)
  const [draftContent, setDraftContent] = useState<string | null>(null)
  const [conflict, setConflict] = useState<PutReadmeConflict | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const draftKey = useCallback((mtime: number) => `${DRAFT_PREFIX}${path}:${mtime}`, [path])

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
        queryClient.invalidateQueries({ queryKey: ['experiment', experimentId] })
        queryClient.invalidateQueries({ queryKey: ['experiments'] })
        onClose()
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
        expectedMtime: conflict.mtime, // accept the new mtime
        // skip hash check — user explicitly chose to overwrite
      })
      if ('error' in res && res.error?.code === 'CONFLICT') {
        setConflict(res)
        setPhase('conflict')
      } else if ('mtime' in res) {
        toast.success('Saved (overwrote conflicting changes)')
        if (diskMtime !== null) safeRemove(draftKey(diskMtime))
        queryClient.invalidateQueries({ queryKey: ['experiment', experimentId] })
        queryClient.invalidateQueries({ queryKey: ['experiments'] })
        onClose()
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

  return (
    <Modal onClose={onClose}>
      {phase === 'loading' && (
        <div className="p-8 text-center text-sm text-slate-500">loading…</div>
      )}

      {phase === 'load-error' && (
        <div className="p-8 text-center text-sm">
          <p className="text-red-700">Could not load README: {loadError}</p>
          <Button className="mt-4" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      )}

      {phase === 'recovery-prompt' && draftContent && (
        <div className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">Unsaved draft found</h2>
          <p className="text-sm text-slate-600">
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
      )}

      {(phase === 'editing' || phase === 'saving') && diskMtime !== null && (
        <div className="flex h-full max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 p-3">
            <h2 className="text-sm font-semibold">
              Edit README ·{' '}
              <span className="font-mono text-xs text-slate-500">{path}</span>
            </h2>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={phase === 'saving'}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void handleSave()} disabled={phase === 'saving'}>
                {phase === 'saving' ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-2 [&_.w-md-editor]:!h-[calc(85vh-3.5rem)]">
            <MDEditor
              value={content}
              onChange={(v) => setContent(v ?? '')}
              height={`calc(85vh - 4rem)` as unknown as number}
              preview="live"
              data-color-mode="light"
            />
          </div>
        </div>
      )}

      {phase === 'conflict' && conflict && (
        <div className="flex h-full max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 p-3">
            <h2 className="text-sm font-semibold text-amber-800">
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
          <div className="flex-1 overflow-auto p-2 text-xs">
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
      )}
    </Modal>
  )
}

// ---------- helpers ----------

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-5xl rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden">
        {children}
      </div>
    </div>
  )
}

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

function cleanupStaleDrafts(): void {
  if (typeof localStorage === 'undefined') return
  const cutoff = Date.now() - STALE_DRAFT_MS
  const toRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(DRAFT_PREFIX)) continue
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as DraftRecord
      const savedAt = Date.parse(parsed.savedAt)
      if (Number.isFinite(savedAt) && savedAt < cutoff) {
        toRemove.push(key)
      }
    } catch {
      // Malformed entries are best treated as stale
      toRemove.push(key)
    }
  }
  for (const key of toRemove) safeRemove(key)
}
