// Server-only: read the request's role + scope (set by middleware) and emit
// an inline script the client picks up during hydration.
//
// The client SessionProviderClient component reads the script's text via
// `document.getElementById('memon-session')?.textContent` once at mount and
// uses that as the initial context value.

import type { ProjectRef } from '@memon/core'
import { capabilitiesOf, hasAdminArea } from '@/lib/server/auth/capabilities'
import {
  type DocumentScope,
  readAccountFromHeaders,
  readIdentityFromHeaders,
} from '@/lib/server/auth/request-context'
import type { SessionAccount } from './session-provider'

export interface SerializedSession {
  role: 'owner' | 'viewer' | 'anon'
  scopeProjects: string[]
  scopeProjectRefs: ProjectRef[]
  scopeDocuments: DocumentScope[]
  /** This page's Project is visible only through a document-scoped share. */
  documentOnly: boolean
  /** The signed-in account (navigation only; routes enforce access themselves). */
  account: SessionAccount | null
}

export async function readSerializedSession(): Promise<SerializedSession> {
  const [{ role, scopeProjects, scopeProjectRefs, scopeDocuments, documentOnly }, account] =
    await Promise.all([readIdentityFromHeaders(), readAccountFromHeaders()])
  return {
    account: account
      ? {
          username: account.username,
          level: account.level,
          capabilities: [...capabilitiesOf(account.level)],
          adminArea: hasAdminArea(account.level),
        }
      : null,
    role,
    scopeProjects: Array.from(scopeProjects),
    scopeProjectRefs,
    scopeDocuments: scopeDocuments ?? [],
    documentOnly: documentOnly === true,
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
