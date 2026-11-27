// Wire shapes for `/api/tokens`. Times are epoch milliseconds.

export interface ApiTokenDto {
  id: number
  username: string
  name: string
  /** The first characters of the value, enough to recognise it. */
  prefix: string
  created_at: number
  expires_at: number | null
  last_used_at: number | null
}

export interface ApiTokenListResponse {
  tokens: ApiTokenDto[]
}

export interface CreateApiTokenRequest {
  name: string
  /** ISO 8601 with an offset, or omitted for no expiry. */
  expires_at?: string
}

export interface CreateApiTokenResponse {
  token: ApiTokenDto
  /** The secret value: shown in this response only. */
  value: string
}
