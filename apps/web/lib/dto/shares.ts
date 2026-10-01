// Response DTOs: Project share links (`/api/projects/:project/shares/**`).
// Shared by the route handlers that build these bodies and the client
// fetchers. Types and pure helpers only — no server imports.

export interface ShareRow {
  id: string
  label?: string
  created_at: string
  expires_at: string | null
  /** Present when the GET was made with `?reveal=true` (owner-only). */
  token?: string
}

export interface CreatedShare extends ShareRow {
  token: string
  share_url: string
}
