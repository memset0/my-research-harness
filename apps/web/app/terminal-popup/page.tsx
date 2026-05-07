// Chrome-less popup-window route: renders only the TerminalView,
// sized to the popup's full viewport. Opened via window.open from
// OpenWithButton's "Open in new window" action or from the Pop out
// button in the drawer header / from /manage/tmux row actions.
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
const VALID_SCOPES = ['exp', 'run'] as const

export default async function TerminalPopupPage({
  searchParams,
}: {
  searchParams: Promise<{
    project?: string
    scope?: string
    slug?: string
    agent?: string
  }>
}) {
  const sp = await searchParams
  const agent = (VALID_AGENTS as readonly string[]).includes(sp.agent ?? '')
    ? (sp.agent as (typeof VALID_AGENTS)[number])
    : 'claude'
  const scope = (VALID_SCOPES as readonly string[]).includes(sp.scope ?? '')
    ? (sp.scope as (typeof VALID_SCOPES)[number])
    : null
  if (!sp.project || !sp.slug || !scope) {
    return (
      <div className="flex h-svh w-svw items-center justify-center bg-zinc-950 p-4 text-center text-xs text-zinc-300">
        missing project / scope / slug query param
      </div>
    )
  }
  return (
    <TerminalPopupClient
      project={sp.project}
      scope={scope}
      slug={sp.slug}
      agent={agent}
    />
  )
}
