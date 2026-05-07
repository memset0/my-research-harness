// Chrome-less popup-window route: renders only the TerminalView,
// sized to the popup's full viewport. Opened via window.open from
// OpenWithButton's "Open in new window" action.
//
// Inherits the root app/layout.tsx (which sets html/body + Toaster +
// global font) but NOT the per-project layout that provides AppBar +
// Sidebar — which is exactly what we want for an undecorated terminal.
//
// Auth: same-origin; the basic-auth credentials are already cached in
// the browser, so the popup loads under the same auth realm without
// re-prompting the user.

import { TerminalPopupClient } from './terminal-popup-client'

const VALID_AGENTS = ['none', 'claude', 'codex', 'opencode'] as const

export default async function TerminalPopupPage({
  searchParams,
}: {
  searchParams: Promise<{ runId?: string; projectName?: string; agent?: string }>
}) {
  const sp = await searchParams
  const agent = (VALID_AGENTS as readonly string[]).includes(sp.agent ?? '')
    ? (sp.agent as (typeof VALID_AGENTS)[number])
    : 'claude'
  if (!sp.runId || !sp.projectName) {
    return (
      <div className="flex h-svh w-svw items-center justify-center bg-zinc-950 text-xs text-zinc-300">
        missing runId or projectName query param
      </div>
    )
  }
  return (
    <TerminalPopupClient
      runId={sp.runId}
      projectName={sp.projectName}
      agent={agent}
    />
  )
}
