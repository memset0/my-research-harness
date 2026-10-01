// Server-only: read the resolved runtime config (the bits the client
// needs at mount-time) and emit an inline JSON script that the client
// reads during hydration. Mirrors `session-bootstrap.tsx`.
//
// The payload shape lives in `lib/runtime-config.ts` next to its reader.

import { DEFAULT_FILE_ACCESS_OPTIONS } from '@memon/core'
import type { RuntimeConfigPayload } from '../lib/runtime-config'
import { getRuntime } from '../lib/server/runtime'

export type { RuntimeConfigPayload }

export async function readSerializedRuntimeConfig(): Promise<RuntimeConfigPayload> {
  const rt = await getRuntime()
  const heartbeatMs = rt.config.fileAccess?.heartbeatMs
  return {
    role: rt.config.central ? 'central' : 'standalone',
    gitStatus: { intervalMs: rt.config.gitStatus.intervalMs },
    // Absent config keys fall back to the store's own default cadence.
    fileAccess: { heartbeatMs: heartbeatMs ?? DEFAULT_FILE_ACCESS_OPTIONS.heartbeatMs },
  }
}

export function RuntimeConfigBootstrap({ config }: { config: RuntimeConfigPayload }) {
  return (
    <script
      id="memon-runtime-config"
      type="application/json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: payload is a closed set of booleans, numbers, and role literals.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(config) }}
    />
  )
}
