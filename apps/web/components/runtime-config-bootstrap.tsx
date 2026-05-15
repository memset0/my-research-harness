// Server-only: read the resolved runtime config (the bits the client
// needs at mount-time) and emit an inline JSON script that the client
// reads during hydration. Mirrors `session-bootstrap.tsx`.
//
// Currently exposes only the git-status polling cadence; future fields
// (other client-relevant config knobs) can extend `RuntimeConfigPayload`.

import { getRuntime } from '../lib/runtime'

export interface RuntimeConfigPayload {
  gitStatus: {
    intervalMs: number
  }
}

export async function readSerializedRuntimeConfig(): Promise<RuntimeConfigPayload> {
  const rt = await getRuntime()
  return {
    gitStatus: { intervalMs: rt.config.gitStatus.intervalMs },
  }
}

export function RuntimeConfigBootstrap({ config }: { config: RuntimeConfigPayload }) {
  return (
    <script
      id="memon-runtime-config"
      type="application/json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(config) }}
    />
  )
}
