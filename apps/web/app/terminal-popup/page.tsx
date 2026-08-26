// Chrome-less popup-window route: renders only the TerminalView,
// sized to the popup's full viewport. Opened via window.open from
// OpenWithButton's "Open in new window" action, the Pop out button in
// the drawer header, or the /manage/tmux row Popup actions.
//
// Two query-param shapes:
//   - Standard: ?project=...&scope=...&slug=...&agent=...
//   - Raw:      ?sessionName=memon-...
// When `sessionName` is present, raw mode takes precedence.
//
// Inherits the root app/layout.tsx (which sets html/body + Toaster +
// global font) but NOT the per-project layout that provides AppBar +
// Sidebar — which is exactly what we want for an undecorated terminal.

import { ProjectRefSchema } from '@memon/core'
import type { Metadata } from 'next'
import { TerminalPopupClient } from './terminal-popup-client'

const VALID_AGENTS = ['none', 'claude', 'codex', 'opencode'] as const
const VALID_SCOPES = ['exp', 'run', 'project'] as const
const VALID_STALE_REASONS = ['unknown-project', 'unknown-target'] as const
const RAW_SESSION_NAME_RE = /^memon-[A-Za-z0-9._-]+$/
const HOST_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{
    project?: string
    host?: string
    scope?: string
    slug?: string
    agent?: string
    sessionName?: string
    stale?: string
    integration?: string
  }>
}): Promise<Metadata> {
  try {
    const sp = await searchParams
    const host = sp.host && HOST_RE.test(sp.host) ? sp.host : null
    const projectIdentity =
      host && sp.project
        ? ProjectRefSchema.safeParse({ host, project: sp.project }).success
          ? `${host}/${sp.project}`
          : host
        : host
    if (sp.integration === 'herdr') {
      return { title: `${projectIdentity ? `${projectIdentity} · ` : ''}Herdr` }
    }
    if (sp.sessionName && RAW_SESSION_NAME_RE.test(sp.sessionName)) {
      return { title: `${host ? `${host} · ` : ''}${sp.sessionName}` }
    }
    const scope = (VALID_SCOPES as readonly string[]).includes(sp.scope ?? '')
      ? (sp.scope as (typeof VALID_SCOPES)[number])
      : null
    if (scope && sp.slug) {
      return { title: `${projectIdentity ? `${projectIdentity} · ` : ''}${scope}:${sp.slug}` }
    }
    return { title: 'Terminal' }
  } catch {
    return { title: 'Terminal' }
  }
}

export default async function TerminalPopupPage({
  searchParams,
}: {
  searchParams: Promise<{
    project?: string
    host?: string
    scope?: string
    slug?: string
    agent?: string
    sessionName?: string
    stale?: string
    integration?: string
  }>
}) {
  const sp = await searchParams
  const host = sp.host && HOST_RE.test(sp.host) ? sp.host : undefined
  if (sp.host && !host) {
    return (
      <div className="flex h-svh w-svw items-center justify-center bg-zinc-950 p-4 text-center text-xs text-zinc-300">
        invalid Host query param
      </div>
    )
  }
  const centralProject =
    host && sp.project ? ProjectRefSchema.safeParse({ host, project: sp.project }) : null
  if (centralProject && !centralProject.success) {
    return (
      <div className="flex h-svh w-svw items-center justify-center bg-zinc-950 p-4 text-center text-xs text-zinc-300">
        invalid Project query param
      </div>
    )
  }

  if (sp.integration === 'herdr') {
    const scope = (VALID_SCOPES as readonly string[]).includes(sp.scope ?? '')
      ? (sp.scope as (typeof VALID_SCOPES)[number])
      : undefined
    const hasCompleteTarget = Boolean(sp.project && sp.slug && scope)
    const hasPartialTarget = Boolean(sp.project || sp.slug || sp.scope) && !hasCompleteTarget
    const project = hasCompleteTarget
      ? centralProject?.success
        ? centralProject.data
        : sp.project!
      : undefined
    if (hasPartialTarget) {
      return (
        <div className="flex h-svh w-svw items-center justify-center bg-zinc-950 p-4 text-center text-xs text-zinc-300">
          Herdr target requires project / scope / slug together
        </div>
      )
    }
    return (
      <TerminalPopupClient
        mode="herdr"
        {...(hasCompleteTarget ? { project: project!, scope: scope!, slug: sp.slug! } : {})}
      />
    )
  }

  // Raw mode takes precedence when a valid sessionName is supplied.
  if (sp.sessionName && RAW_SESSION_NAME_RE.test(sp.sessionName)) {
    const staleReason = (VALID_STALE_REASONS as readonly string[]).includes(sp.stale ?? '')
      ? (sp.stale as (typeof VALID_STALE_REASONS)[number])
      : null
    return (
      <TerminalPopupClient
        mode="raw"
        {...(host ? { host } : {})}
        sessionName={sp.sessionName}
        staleReason={staleReason}
      />
    )
  }

  const agent = (VALID_AGENTS as readonly string[]).includes(sp.agent ?? '')
    ? (sp.agent as (typeof VALID_AGENTS)[number])
    : 'claude'
  const scope = (VALID_SCOPES as readonly string[]).includes(sp.scope ?? '')
    ? (sp.scope as (typeof VALID_SCOPES)[number])
    : null
  if (!sp.project || !sp.slug || !scope) {
    return (
      <div className="flex h-svh w-svw items-center justify-center bg-zinc-950 p-4 text-center text-xs text-zinc-300">
        missing project / scope / slug query param (or supply sessionName=memon-...)
      </div>
    )
  }
  return (
    <TerminalPopupClient
      mode="standard"
      project={centralProject?.success ? centralProject.data : sp.project}
      scope={scope}
      slug={sp.slug}
      agent={agent}
    />
  )
}
