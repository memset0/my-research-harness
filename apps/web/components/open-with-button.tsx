'use client'

// Split-button replacement for the legacy <TerminalButton> +
// <OpenClaudeCodeButton> pair. Click main face → open default agent in
// the side drawer. Click chevron → DropdownMenu with all four agents
// + "Open in new window" (popup-window mode).

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Bot, ExternalLink, Loader2, Download } from 'lucide-react'
import { toast } from 'sonner'
import {
  ApiError,
  checkTerminal,
  installTerminal,
  type TerminalAgentKind,
  type TerminalScopeKind,
} from '../lib/api'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { useTerminalDrawer } from './terminal-drawer-provider'

const STORAGE_KEY = 'memon:terminal:default-agent'
const DEFAULT_AGENT: TerminalAgentKind = 'claude'

const AGENT_LABEL: Record<TerminalAgentKind, string> = {
  none: 'Terminal',
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
}

function readDefaultAgent(): TerminalAgentKind {
  if (typeof localStorage === 'undefined') return DEFAULT_AGENT
  const raw = localStorage.getItem(STORAGE_KEY)
  if (
    raw === 'none' ||
    raw === 'claude' ||
    raw === 'codex' ||
    raw === 'opencode'
  ) {
    return raw
  }
  return DEFAULT_AGENT
}

function writeDefaultAgent(agent: TerminalAgentKind): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, agent)
  } catch {
    /* ignore */
  }
}

function popupTarget(input: {
  agent: TerminalAgentKind
  project: string
  scope: TerminalScopeKind
  slug: string
}): string {
  const agentSeg = input.agent === 'none' ? 'terminal' : input.agent
  return `memon-popup-memon-${agentSeg}-${input.project}--${input.scope}--${input.slug}`
}

function popupUrl(input: {
  agent: TerminalAgentKind
  project: string
  scope: TerminalScopeKind
  slug: string
}): string {
  return (
    `/terminal-popup?project=${encodeURIComponent(input.project)}` +
    `&scope=${encodeURIComponent(input.scope)}` +
    `&slug=${encodeURIComponent(input.slug)}` +
    `&agent=${encodeURIComponent(input.agent)}`
  )
}

export interface OpenWithButtonProps {
  project: string
  scope: TerminalScopeKind
  slug: string
}

export function OpenWithButton({ project, scope, slug }: OpenWithButtonProps) {
  const drawer = useTerminalDrawer()
  const qc = useQueryClient()
  const [defaultAgent, setDefaultAgentState] = useState<TerminalAgentKind>(DEFAULT_AGENT)
  const [installing, setInstalling] = useState(false)

  // Read localStorage AFTER mount to avoid SSR/hydration mismatch.
  useEffect(() => {
    setDefaultAgentState(readDefaultAgent())
  }, [])

  const setDefaultAgent = (agent: TerminalAgentKind) => {
    setDefaultAgentState(agent)
    writeDefaultAgent(agent)
  }

  const { data: probe } = useQuery({
    queryKey: ['terminal', 'check'],
    queryFn: checkTerminal,
    staleTime: 10_000,
  })

  // ttyd unavailable but auto-installable: render a single Install button
  // with no picker. Once installed, the picker becomes available.
  if (probe && !probe.available && probe.downloadable) {
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

  // ttyd unavailable AND not downloadable (e.g. macOS): disabled button.
  if (probe && !probe.available) {
    return (
      <Button variant="outline" size="sm" disabled title={probe.suggestion ?? 'ttyd unavailable'}>
        <Bot className="size-3.5" />
        Open with…
      </Button>
    )
  }

  const launchInDrawer = (agent: TerminalAgentKind) => {
    setDefaultAgent(agent)
    drawer.open({ project, scope, slug, agent })
  }

  const launchInPopup = (agent: TerminalAgentKind) => {
    setDefaultAgent(agent)
    window.open(
      popupUrl({ agent, project, scope, slug }),
      popupTarget({ agent, project, scope, slug }),
      'popup,width=1200,height=800',
    )
  }

  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-md border bg-background">
      <Button
        variant="ghost"
        size="sm"
        className="rounded-none border-0"
        onClick={() => launchInDrawer(defaultAgent)}
      >
        <Bot className="size-3.5" />
        Open with {AGENT_LABEL[defaultAgent]}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-none border-0 border-l px-1.5"
            aria-label="Choose agent"
          >
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => launchInDrawer('none')}>
            {AGENT_LABEL.none}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => launchInDrawer('claude')}>
            {AGENT_LABEL.claude}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => launchInDrawer('codex')}>
            {AGENT_LABEL.codex}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => launchInDrawer('opencode')}>
            {AGENT_LABEL.opencode}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => launchInPopup(defaultAgent)}>
            <ExternalLink className="size-3.5" />
            Open in new window
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
