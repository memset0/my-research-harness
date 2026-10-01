// Response DTOs: Log file listings (`/api/log-files`).
// Shared by the route handlers that build these bodies and the client
// fetchers in `lib/api.ts`. Types and pure helpers only — no server imports.

export interface LogFileEntry {
  name: string
  path?: string
  resource?: string
  size: number
  mtime: number
}
