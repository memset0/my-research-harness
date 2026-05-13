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

import { TerminalPopupClient } from './terminal-popup-client'

const VALID_AGENTS = ['none', 'claude', 'codex', 'opencode'] as const
const VALID_SCOPES = ['exp', 'run', 'project'] as const
const RAW_SESSION_NAME_RE = /^memon-[A-Za-z0-9._-]+$/

export default async function TerminalPopupPage({
  searchParams,
}: {
  searchParams: Promise<{
    project?: string
    scope?: string
    slug?: string
    agent?: string
    sessionName?: string
  }>
}) {
  const sp = await searchParams

  // Raw mode takes precedence when a valid sessionName is supplied.
  if (sp.sessionName && RAW_SESSION_NAME_RE.test(sp.sessionName)) {
    return <TerminalPopupClient mode="raw" sessionName={sp.sessionName} />
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
      project={sp.project}
      scope={scope}
      slug={sp.slug}
      agent={agent}
    />
  )
}
