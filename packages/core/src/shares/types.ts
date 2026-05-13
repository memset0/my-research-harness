// On-disk schema for `<projectRoot>/.memon/shares.json`. Plaintext;
// consistent with the rest of memon's single-user threat model.

export interface ShareRecord {
  /** Stable identifier, shape `shr_<8 base64url chars>`. */
  id: string
  /** The credential — 24 base64url chars (144 bits). */
  token: string
  /** Optional human label. Max 64 chars at write time. */
  label?: string
  /** ISO8601 with timezone offset (e.g., `2026-05-13T10:00:00+08:00`). */
  created_at: string
  /** ISO8601+TZ, or `null` for never-expires. */
  expires_at: string | null
}

export interface SharesFile {
  version: 1
  shares: ShareRecord[]
}

export class ShareStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShareStoreError'
  }
}

export class AmbiguousShareError extends Error {
  constructor(
    message: string,
    public readonly matches: Array<{ id: string; project?: string }>,
  ) {
    super(message)
    this.name = 'AmbiguousShareError'
  }
}

export class ShareNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShareNotFoundError'
  }
}

/** Default empty file for a project with no shares yet. */
export function emptySharesFile(): SharesFile {
  return { version: 1, shares: [] }
}
