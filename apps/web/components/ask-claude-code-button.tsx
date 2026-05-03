'use client'

import { useQuery } from '@tanstack/react-query'
import { Bot, Copy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { type FullExperiment, fetchJournal, fetchProjects } from '../lib/api'
import { buildAgentPrompt, buildCdSnippet } from '../lib/agent-prompt'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Textarea } from './ui/textarea'

export function AskClaudeCodeButton({ experiment }: { experiment: FullExperiment }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Bot className="size-3.5" />
        Ask Claude Code
      </Button>
      {open && <AgentHandoffDialog experiment={experiment} onClose={() => setOpen(false)} />}
    </>
  )
}

function AgentHandoffDialog({
  experiment,
  onClose,
}: {
  experiment: FullExperiment
  onClose: () => void
}) {
  const projectName = experiment.frontMatter.project

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    staleTime: 60_000,
  })
  const projectRoot = projectsData?.projects.find((p) => p.name === projectName)?.root ?? ''

  const { data: journalData } = useQuery({
    queryKey: ['journal', projectName],
    queryFn: () => fetchJournal(projectName, { limit: 200 }),
  })
  const recentEvents = journalData?.events ?? []

  const prompt = useMemo(
    () =>
      projectRoot
        ? buildAgentPrompt({ experiment, recentJournalEvents: recentEvents, projectRoot })
        : '',
    [experiment, recentEvents, projectRoot],
  )
  const cdSnippet = useMemo(
    () => (projectRoot ? buildCdSnippet(projectRoot) : ''),
    [projectRoot],
  )

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`Copied ${label} · paste into Claude Code`)
    } catch {
      toast.error('Clipboard blocked — please copy manually')
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ask Claude Code</DialogTitle>
          <DialogDescription>
            memon does not embed an LLM. Copy the prompt below, run Claude Code in the project
            root, and paste it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Step 1 · open Claude Code in the project root
              </span>
              <Button size="sm" variant="ghost" onClick={() => void copy(cdSnippet, 'shell snippet')}>
                <Copy className="size-3.5" />
                Copy
              </Button>
            </div>
            <code className="block rounded-md border bg-muted px-3 py-2 font-mono text-xs">
              {cdSnippet || '—'}
            </code>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Step 2 · paste this prompt
              </span>
              <Button size="sm" variant="ghost" onClick={() => void copy(prompt, 'prompt')}>
                <Copy className="size-3.5" />
                Copy
              </Button>
            </div>
            <Textarea
              readOnly
              value={prompt}
              rows={14}
              className="resize-y font-mono text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void copy(prompt, 'prompt')}>
            <Copy className="size-3.5" />
            Copy prompt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
