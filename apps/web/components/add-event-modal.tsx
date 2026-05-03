'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError, appendJournalEvent } from '../lib/api'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'

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
  /** When set, user picks the tag in the modal */
  allowTagSelect?: boolean
}

export type AddEventModalProps = AddNoteProps | AddJournalEntryProps

export function AddEventModal(props: AddEventModalProps) {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [tag, setTag] = useState<'NOTE' | 'REQUEST'>(props.mode === 'request' ? 'REQUEST' : 'NOTE')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (props.open) {
      setText('')
      setTag(props.mode === 'request' ? 'REQUEST' : 'NOTE')
    }
  }, [props.open, props.mode])

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

  const showTagSelect = 'allowTagSelect' in props && props.allowTagSelect === true

  const title = showTagSelect
    ? 'Add journal entry'
    : props.mode === 'request'
      ? 'Add request'
      : 'Add note'

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {'experimentId' in props && props.experimentId && (
            <DialogDescription>
              Will be appended as <code className="font-mono text-xs">[{tag}] `{props.experimentId}` …</code>
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-4 py-2">
          {showTagSelect && (
            <div className="space-y-1.5">
              <Label htmlFor="tag">Tag</Label>
              <Select
                value={tag}
                onValueChange={(v) => setTag(v as 'NOTE' | 'REQUEST')}
              >
                <SelectTrigger id="tag">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NOTE">NOTE</SelectItem>
                  <SelectItem value="REQUEST">REQUEST</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="body">Body</Label>
            <Textarea
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
              className="resize-y"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void onSubmit()} disabled={busy || !text.trim()}>
            {busy ? 'Appending…' : 'Append'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
