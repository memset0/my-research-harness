// Server-only: read the request's role + scope (set by middleware) and emit
// an inline script the client picks up during hydration.
//
// The client SessionProviderClient component reads the script's text via
// `document.getElementById('memon-session')?.textContent` once at mount and
// uses that as the initial context value.

import type { ProjectRef } from '@memon/core'
import { readIdentityFromHeaders } from '@/lib/auth/request-context'

export interface SerializedSession {
  role: 'owner' | 'viewer' | 'anon'
  scopeProjects: string[]
  scopeProjectRefs: ProjectRef[]
}

export async function readSerializedSession(): Promise<SerializedSession> {
  const { role, scopeProjects, scopeProjectRefs } = await readIdentityFromHeaders()
  return {
    role,
    scopeProjects: Array.from(scopeProjects),
    scopeProjectRefs,
  }
}

export function SessionBootstrap({ session }: { session: SerializedSession }) {
  // Escape `<` so user-controlled labels can never terminate the raw-text
  // script element. JSON.parse restores the escaped code point on hydration.
  const serialized = JSON.stringify(session).replaceAll('<', '\\u003c')
  return (
    <script id="memon-session" type="application/json">
      {serialized}
    </script>
  )
}
