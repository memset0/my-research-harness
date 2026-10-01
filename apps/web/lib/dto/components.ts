// Response DTOs: Document component execution results (`/api/components/run`).
// Shared by the route handlers that build these bodies and the client
// fetchers in `lib/api.ts`. Types and pure helpers only — no server imports.

export interface ComponentRunResult {
  id: string
  status: 'updated' | 'unchanged' | 'failed'
  path: string
  durationMs: number
  error?: string
}
