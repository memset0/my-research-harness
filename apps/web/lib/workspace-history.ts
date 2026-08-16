export const WORKSPACE_HISTORY_EVENT = 'memon:workspace-history-change'

export function currentWorkspaceHref(fallback = '/'): string {
  if (typeof window === 'undefined') return fallback
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

/**
 * Replace same-document workspace state without invoking an App Router
 * navigation. Next patches the native History API so its navigation hooks
 * stay synchronized; the custom event also gives the workspace provider an
 * immediate, framework-independent update signal.
 */
export function replaceWorkspaceHistory(href: string): void {
  if (typeof window === 'undefined') return
  window.history.replaceState(window.history.state, '', href)
  window.dispatchEvent(new Event(WORKSPACE_HISTORY_EVENT))
}
