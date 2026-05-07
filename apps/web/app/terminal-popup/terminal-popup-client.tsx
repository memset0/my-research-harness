'use client'

import { TerminalView } from '../../components/terminal-view'
import type { TerminalAgentKind } from '../../lib/api'

export function TerminalPopupClient({
  runId,
  projectName,
  agent,
}: {
  runId: string
  projectName: string
  agent: TerminalAgentKind
}) {
  return (
    <TerminalView
      runId={runId}
      projectName={projectName}
      agent={agent}
      fullscreen
    />
  )
}
