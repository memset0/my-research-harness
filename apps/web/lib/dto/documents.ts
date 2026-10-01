// Response DTOs: README read/write bodies (`/api/readme`, `/api/runs/:id/readme`,
// `/api/experiments/:id/readme`).
// Shared by the route handlers that build these bodies and the client
// fetchers in `lib/api.ts`. Types and pure helpers only — no server imports.

export interface PutReadmeResponse {
  mtime: number
  hash?: string
  /**
   * The canonical on-disk content after the server bumped `updated_at`
   * and re-serialized via the pretty-printer. Editors should rebaseline
   * their buffer to this exact string so dirty-state clears.
   */
  finalContent?: string
}

export interface PutReadmeConflict {
  error: { code: 'CONFLICT'; message: string }
  mtime: number
  content: string
}

export interface FetchedReadme {
  resource: string
  content: string
  mtime: number
  hash: string
}
