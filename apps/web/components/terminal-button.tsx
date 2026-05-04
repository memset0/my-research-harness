'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bot, Download, Loader2 } from 'lucide-react'
import { ApiError, checkTerminal, installTerminal } from '../lib/api'
import { Button } from './ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip'
import { TerminalSheet } from './terminal-sheet'

export function TerminalButton({
  experimentId,
  projectName,
}: {
  experimentId: string
  projectName: string
}) {
  const qc = useQueryClient()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [installing, setInstalling] = useState(false)

  const { data: probe } = useQuery({
    queryKey: ['terminal', 'check'],
    queryFn: checkTerminal,
    staleTime: 10_000,
  })

  if (!probe) {
    // Loading or first paint — render a quiet placeholder button so layout
    // doesn't flicker.
    return (
      <Button variant="outline" size="sm" disabled>
        <Bot className="size-3.5" />
        Open in browser
      </Button>
    )
  }

  // State A — ready to go
  if (probe.available) {
    return (
      <>
        <Button variant="outline" size="sm" onClick={() => setSheetOpen(true)}>
          <Bot className="size-3.5" />
          Open in browser
        </Button>
        <TerminalSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          experimentId={experimentId}
          projectName={projectName}
        />
      </>
    )
  }

  // State B — auto-installable
  if (probe.downloadable) {
    const onInstall = async () => {
      setInstalling(true)
      try {
        const res = await installTerminal()
        toast.success(
          res.alreadyPresent
            ? 'ttyd already cached'
            : `ttyd ${res.version} installed (${(res.durationMs / 1000).toFixed(1)}s)`,
        )
        await qc.invalidateQueries({ queryKey: ['terminal', 'check'] })
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : (err as Error).message
        toast.error(`ttyd install failed: ${msg}`)
      } finally {
        setInstalling(false)
      }
    }
    return (
      <Button variant="outline" size="sm" onClick={() => void onInstall()} disabled={installing}>
        {installing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
        {installing ? 'Installing…' : 'Install ttyd (~5MB)'}
      </Button>
    )
  }

  // State C — manual install required (e.g. macOS)
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span wraps the disabled button so the tooltip still triggers */}
          <span tabIndex={0}>
            <Button variant="outline" size="sm" disabled>
              <Bot className="size-3.5" />
              Open in browser
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <span className="font-mono text-[11px]">
            {probe.suggestion ?? 'ttyd unavailable'}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
