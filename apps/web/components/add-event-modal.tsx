'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError, appendJournalEvent } from '../lib/api'
import { Button } from './ui'

interface BaseProps {
  project: string
  open: boolean
  onClose: () => void
}

interface AddNoteProps extends BaseProps {
  /** When set, the note body is auto-prefixed with `\`<experimentId>\`` */
  experimentId: string
  mode: 'note'
}

interface AddJournalEntryProps extends BaseProps {
  /** Optional pre-fill for experiment id (free choice, not enforced) */
  experimentId?: string
  mode: 'note' | 'request'
  /** When mode is 'select', user picks the tag in the modal */
  allowTagSelect?: boolean
}

export type AddEventModalProps = AddNoteProps | AddJournalEntryProps

export function AddEventModal(props: AddEventModalProps) {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [tag, setTag] = useState<'NOTE' | 'REQUEST'>(props.mode === 'request' ? 'REQUEST' : 'NOTE')
  const [busy, setBusy] = useState(false)

  // Reset on open
  useEffect(() => {
    if (props.open) {
      setText('')
      setTag(props.mode === 'request' ? 'REQUEST' : 'NOTE')
    }
  }, [props.open, props.mode])

  if (!props.open) return null

  const onSubmit = async () => {
    const body = text.trim()
    if (!body) return
    setBusy(true)
    try {
      const expId = 'experimentId' in props ? props.experimentId : undefined
      const finalBody = expId ? `\`${expId}\` ${body}` : body
      await appendJournalEvent({ project: props.project, tag, body: finalBody })
      toast.success(`Appended [${tag}] event`)
      queryClient.invalidateQueries({ queryKey: ['journal', props.project] })
      props.onClose()
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message
      toast.error(`Append failed: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  const showTagSelect =
    'allowTagSelect' in props && props.allowTagSelect === true && props.mode !== 'note'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-100 p-3 text-sm font-semibold">
          {showTagSelect ? 'Add journal entry' : props.mode === 'request' ? 'Add request' : 'Add note'}
        </div>
        <div className="space-y-3 p-4">
          {showTagSelect && (
            <div>
              <label className="text-[10px] uppercase tracking-wide text-slate-500" htmlFor="tag">
                Tag
              </label>
              <select
                id="tag"
                value={tag}
                onChange={(e) => setTag(e.target.value as 'NOTE' | 'REQUEST')}
                className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm"
              >
                <option value="NOTE">NOTE</option>
                <option value="REQUEST">REQUEST</option>
              </select>
            </div>
          )}
          <div>
            <label className="text-[10px] uppercase tracking-wide text-slate-500" htmlFor="body">
              Body
            </label>
            <textarea
              id="body"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              autoFocus
              placeholder={
                props.mode === 'request'
                  ? 'e.g. please summarize experiments related to H7'
                  : 'e.g. converged faster than expected'
              }
              className="mt-1 w-full resize-y rounded border border-slate-300 bg-white p-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>
          {'experimentId' in props && props.experimentId && (
            <p className="text-xs text-slate-500">
              Will be appended as <code className="font-mono">[{tag}] `{props.experimentId}` …</code>
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 p-3">
          <Button variant="ghost" size="sm" onClick={props.onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void onSubmit()} disabled={busy || !text.trim()}>
            {busy ? 'Appending…' : 'Append'}
          </Button>
        </div>
      </div>
    </div>
  )
}
