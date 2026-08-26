'use client'

// Unified split-button for the project / exp / run "open an agent
// against this thing" action. Three call sites — AppBar header
// (scope='project'), experiment-page exp action bar (scope='exp'),
// experiment-page run-panel action bar (scope='run') — render this
// same component with different (scope, slug) props. Click main face
// → open default agent in the side drawer. Click chevron →
// DropdownMenu with enabled agents plus right-split and popup actions.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, ChevronDown, Columns2, Download, ExternalLink, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  ApiError,
  checkTerminal,
  fetchHosts,
  installTerminal,
  type ProjectTarget,
  projectHost,
  projectName,
  type TerminalAgentKind,
  type TerminalScopeKind,
} from '../lib/api'
import { useRuntimeConfig } from '../lib/runtime-config'
import { useSession } from './session-provider'
import { useTerminalDrawer } from './terminal-drawer-provider'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { ViewerGuard } from './viewer-guard'

const STORAGE_KEY = 'memon:terminal:default-agent'
const DEFAULT_AGENT: TerminalAgentKind = 'claude'
type OpenWithKind = TerminalAgentKind | 'herdr'

const AGENT_LABEL: Record<OpenWithKind, string> = {
  none: 'Terminal',
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  herdr: 'Herdr',
}

function readDefaultAgent(): OpenWithKind {
  if (typeof localStorage === 'undefined') return DEFAULT_AGENT
  const raw = localStorage.getItem(STORAGE_KEY)
  if (
    raw === 'none' ||
    raw === 'claude' ||
    raw === 'codex' ||
    raw === 'opencode' ||
    raw === 'herdr'
  ) {
    return raw
  }
  return DEFAULT_AGENT
}

function writeDefaultAgent(agent: OpenWithKind): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, agent)
  } catch {
    /* ignore */
  }
}

function popupTarget(input: {
  agent: OpenWithKind
  project: ProjectTarget
  scope: TerminalScopeKind
  slug: string
}): string {
  const host = projectHost(input.project)
  const hostSegment = host ? `${host}-` : ''
  if (input.agent === 'herdr') return `memon-popup-${hostSegment}memon-herdr-${input.slug}`
  const agentSeg = input.agent === 'none' ? 'terminal' : input.agent
  return `memon-popup-${hostSegment}memon-${agentSeg}-${projectName(input.project)}--${input.scope}--${input.slug}`
}

function popupUrl(input: {
  agent: OpenWithKind
  project: ProjectTarget
  scope: TerminalScopeKind
  slug: string
}): string {
  const params = new URLSearchParams({
    project: projectName(input.project),
    scope: input.scope,
    slug: input.slug,
  })
  const host = projectHost(input.project)
  if (host) params.set('host', host)
  if (input.agent === 'herdr') params.set('integration', 'herdr')
  else params.set('agent', input.agent)
  return `/terminal-popup?${params.toString()}`
}

export interface OpenWithButtonProps {
  project: ProjectTarget
  scope: TerminalScopeKind
  slug: string
}

export function OpenWithButton({ project, scope, slug }: OpenWithButtonProps) {
  const drawer = useTerminalDrawer()
  const qc = useQueryClient()
  const { role } = useSession()
  const { terminal, role: runtimeRole } = useRuntimeConfig()
  const host = projectHost(project)
  const hostTarget = host ? { host } : undefined
  const { data: hostsData } = useQuery({
    queryKey: ['hosts'],
    queryFn: fetchHosts,
    enabled: runtimeRole === 'central' && host !== null,
    retry: false,
  })
  const availability = host
    ? hostsData?.hosts.find((candidate) => candidate.host === host)
    : undefined
  const hostUsable = availability?.state === 'online' || availability?.state === 'update_available'
  const tmuxEnabled =
    runtimeRole === 'central'
      ? hostUsable && availability?.capabilities?.tmux === true
      : terminal.tmuxEnabled
  const herdrEnabled =
    runtimeRole === 'central'
      ? hostUsable && availability?.capabilities?.herdr === true
      : terminal.herdrEnabled
  const isViewer = role !== 'owner'
  const [defaultAgent, setDefaultAgentState] = useState<OpenWithKind>(DEFAULT_AGENT)
  const [installing, setInstalling] = useState(false)

  // Read localStorage AFTER mount to avoid SSR/hydration mismatch.
  useEffect(() => {
    const stored = readDefaultAgent()
    const enabled = stored === 'herdr' ? herdrEnabled : tmuxEnabled
    setDefaultAgentState(enabled ? stored : tmuxEnabled ? DEFAULT_AGENT : 'herdr')
  }, [herdrEnabled, tmuxEnabled])

  const setDefaultAgent = (agent: OpenWithKind) => {
    setDefaultAgentState(agent)
    writeDefaultAgent(agent)
  }

  // Viewers can't use the terminal (the API is shell-classed = owner-only).
  // Skip the probe entirely so we don't trigger `401 + WWW-Authenticate`,
  // which would pop the browser's native Basic-auth dialog.
  const { data: probe, isError: probeFailed } = useQuery({
    queryKey: ['terminal', 'check', host ?? 'standalone'],
    queryFn: () => checkTerminal(hostTarget),
    staleTime: 10_000,
    enabled: role === 'owner' && (tmuxEnabled || herdrEnabled),
  })

  if (!tmuxEnabled && !herdrEnabled) return null

  if (role === 'owner' && !probe) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        title={probeFailed ? 'Selected Host terminal is unavailable' : 'Checking terminal'}
      >
        {probeFailed ? <Bot className="size-3.5" /> : <Loader2 className="size-3.5 animate-spin" />}
        Open with…
      </Button>
    )
  }

  // ttyd unavailable but auto-installable: render a single Install button
  // with no picker. Once installed, the picker becomes available.
  if (probe && !probe.available && probe.downloadable) {
    const onInstall = async () => {
      setInstalling(true)
      try {
        const res = await installTerminal(hostTarget)
        toast.success(
          res.alreadyPresent
            ? 'ttyd already cached'
            : `ttyd ${res.version} installed (${(res.durationMs / 1000).toFixed(1)}s)`,
        )
        await qc.invalidateQueries({ queryKey: ['terminal', 'check', host ?? 'standalone'] })
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : (err as Error).message
        toast.error(`ttyd install failed: ${msg}`)
      } finally {
        setInstalling(false)
      }
    }
    return (
      <ViewerGuard reason="Open with…">
        <Button variant="outline" size="sm" onClick={() => void onInstall()} disabled={installing}>
          {installing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          {installing ? 'Installing…' : 'Install ttyd (~5MB)'}
        </Button>
      </ViewerGuard>
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

  const launchInDrawer = (agent: OpenWithKind) => {
    if (isViewer) return
    setDefaultAgent(agent)
    if (agent === 'herdr') drawer.openHerdr({ project, scope, slug })
    else drawer.open({ project, scope, slug, agent })
  }

  const launchInPopup = (agent: OpenWithKind) => {
    if (isViewer) return
    setDefaultAgent(agent)
    window.open(
      popupUrl({ agent, project, scope, slug }),
      popupTarget({ agent, project, scope, slug }),
      'popup,width=1200,height=800',
    )
  }

  const launchInSplit = (agent: OpenWithKind) => {
    if (isViewer) return
    setDefaultAgent(agent)
    if (agent === 'herdr') drawer.openHerdrSplit({ project, scope, slug })
    else drawer.openSplit({ project, scope, slug, agent })
  }

  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-md border bg-card">
      <ViewerGuard reason="Open with…">
        <Button
          variant="ghost"
          size="sm"
          className="rounded-none border-0"
          onClick={() => launchInDrawer(defaultAgent)}
        >
          <Bot className="size-3.5" />
          Open with {AGENT_LABEL[defaultAgent]}
        </Button>
      </ViewerGuard>
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
          {tmuxEnabled && (
            <>
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
            </>
          )}
          {herdrEnabled && (
            <DropdownMenuItem onClick={() => launchInDrawer('herdr')}>
              {AGENT_LABEL.herdr}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => launchInSplit(defaultAgent)}>
            <Columns2 className="size-3.5" />
            Open in split view
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => launchInPopup(defaultAgent)}>
            <ExternalLink className="size-3.5" />
            Open in new window
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
