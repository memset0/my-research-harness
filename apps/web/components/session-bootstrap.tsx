// Server-only: read the request's role + scope (set by middleware) and emit
// an inline script the client picks up during hydration.
//
// The client SessionProviderClient component reads the script's text via
// `document.getElementById('memon-session')?.textContent` once at mount and
// uses that as the initial context value.

import { readIdentityFromHeaders } from '@/lib/auth/request-context'

export interface SerializedSession {
  role: 'owner' | 'viewer' | 'anon'
  scopeProjects: string[]
}

export async function readSerializedSession(): Promise<SerializedSession> {
  const { role, scopeProjects } = await readIdentityFromHeaders()
  return {
    role,
    scopeProjects: Array.from(scopeProjects),
  }
}

export function SessionBootstrap({ session }: { session: SerializedSession }) {
  // JSON.stringify — safe to inline (no </script> in the keys/values).
  return (
    <script
      id="memon-session"
      type="application/json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(session) }}
    />
  )
}
