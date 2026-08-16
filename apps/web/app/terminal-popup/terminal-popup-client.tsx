'use client'

import { StaleBanner, type StaleReason } from '../../components/stale-banner'
import { TerminalView } from '../../components/terminal-view'
import type { TerminalAgentKind, TerminalScopeKind } from '../../lib/api'

export type TerminalPopupClientProps =
  | {
      mode: 'standard'
      project: string
      scope: TerminalScopeKind
      slug: string
      agent: TerminalAgentKind
    }
  | {
      mode: 'raw'
      sessionName: string
      staleReason?: StaleReason | null
    }
  | {
      mode: 'herdr'
      project?: string
      scope?: TerminalScopeKind
      slug?: string
    }

export function TerminalPopupClient(props: TerminalPopupClientProps) {
  if (props.mode === 'herdr') {
    return (
      <TerminalView
        mode="herdr"
        {...(props.project && props.scope && props.slug
          ? { project: props.project, scope: props.scope, slug: props.slug }
          : {})}
        fullscreen
        source="popup"
      />
    )
  }
  if (props.mode === 'raw') {
    if (props.staleReason) {
      // Banner above the iframe — wrap in a flex column so the banner
      // takes its content height and TerminalView fills the rest.
      // Drop `fullscreen` here since the wrapper provides the viewport
      // sizing; TerminalView falls back to `h-full w-full`.
      return (
        <div className="flex h-svh w-svw flex-col bg-zinc-950">
          <StaleBanner reason={props.staleReason} sessionName={props.sessionName} />
          <div className="flex min-h-0 flex-1 flex-col">
            <TerminalView mode="raw" sessionName={props.sessionName} source="popup" />
          </div>
        </div>
      )
    }
    return <TerminalView mode="raw" sessionName={props.sessionName} fullscreen source="popup" />
  }
  return (
    <TerminalView
      mode="standard"
      project={props.project}
      scope={props.scope}
      slug={props.slug}
      agent={props.agent}
      fullscreen
      source="popup"
    />
  )
}
