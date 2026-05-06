'use client'

// v3 `Open Claude Code` action-bar button. Calls /api/open-claude-code to
// resolve the working directory for an exp doc / run, copies the suggested
// `cd <dir> && claude` command to the clipboard, and shows a toast.
//
// Distinct from `TerminalButton` (which spawns ttyd+tmux+claude in the
// browser via /api/terminal/start). This one is for users who prefer to
// run Claude Code locally — typing `cmd+v` in their existing terminal is
// faster than booting an in-browser tmux session.

import { useState } from 'react'
import { Loader2, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { ApiError, openClaudeCode } from '../lib/api'

interface Props {
  kind: 'exp' | 'run'
  id: string
  projectName: string
  variant?: 'default' | 'outline' | 'secondary' | 'ghost'
  size?: 'sm' | 'default'
  label?: string
}

export function OpenClaudeCodeButton({
  kind,
  id,
  projectName,
  variant = 'outline',
  size = 'sm',
  label,
}: Props) {
  const [loading, setLoading] = useState(false)
  const text = label ?? 'Open Claude Code'
  const onClick = async () => {
    setLoading(true)
    try {
      const res = await openClaudeCode({ kind, id, projectName })
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(res.command)
          toast.success('Copied · paste into your terminal', {
            description: res.hint,
          })
        } else {
          throw new Error('clipboard unavailable')
        }
      } catch {
        toast.message('Run this in your terminal', { description: res.command })
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message
      toast.error(`Could not resolve: ${msg}`)
    } finally {
      setLoading(false)
    }
  }
  return (
    <Button variant={variant} size={size} onClick={() => void onClick()} disabled={loading}>
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Terminal className="size-3.5" />}
      {text}
    </Button>
  )
}
