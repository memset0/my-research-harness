'use client'

import { TerminalView } from '../../components/terminal-view'
import type { TerminalAgentKind, TerminalScopeKind } from '../../lib/api'

export function TerminalPopupClient({
  project,
  scope,
  slug,
  agent,
}: {
  project: string
  scope: TerminalScopeKind
  slug: string
  agent: TerminalAgentKind
}) {
  return (
    <TerminalView
      project={project}
      scope={scope}
      slug={slug}
      agent={agent}
      fullscreen
    />
  )
}
