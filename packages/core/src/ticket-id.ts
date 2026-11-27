import { randomBytes } from 'node:crypto'

// Ticket ids are random so that no caller can reach another caller's ticket by
// counting. They also name herdr terminals and Slurm steps, so they stay within
// herdr's `[a-z0-9_-]` alphabet and short enough to leave room for a task name
// in a 32-character terminal name.

/** Crockford base32, lowercase: no i, l, o or u. */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const TOKEN_LENGTH = 12

export const TICKET_ID_PATTERN = /^tk_[0-9abcdefghjkmnpqrstvwxyz]{12}$/

export function newTicketId(): string {
  // 256 is a multiple of 32, so masking 5 bits keeps every character uniform.
  const bytes = randomBytes(TOKEN_LENGTH)
  let token = ''
  for (const byte of bytes) token += ALPHABET[byte & 31]
  return `tk_${token}`
}

export function isTicketId(id: string): boolean {
  return TICKET_ID_PATTERN.test(id)
}
