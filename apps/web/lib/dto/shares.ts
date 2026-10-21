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

export interface SharesResponse {
  shares: ShareRow[]
}

export interface CreatedShareResponse {
  share: CreatedShare
}

// ----- Central scoped shares (`/api/shares/**`) -----

export type ShareScopeDto =
  | { kind: 'project' }
  | { kind: 'experiment' | 'wiki' | 'report'; id: string }

export interface ScopedShareRow {
  id: string
  token: string
  label?: string
  host: string | null
  project: string
  scope: ShareScopeDto
  /** The page the link lands on. */
  path: string
  created_at: string
  expires_at: string | null
  share_url: string
}

export interface ScopedSharesResponse {
  shares: ScopedShareRow[]
}

export interface ScopedShareCreatedResponse {
  share: ScopedShareRow
}
