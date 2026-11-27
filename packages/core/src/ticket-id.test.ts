import { expect, it } from 'vitest'
import { isTicketId, newTicketId, TICKET_ID_PATTERN } from './ticket-id.js'

it('issues distinct random ids that fit herdr terminal names', () => {
  const ids = new Set(Array.from({ length: 1000 }, newTicketId))
  expect(ids.size).toBe(1000)
  for (const id of ids) {
    expect(id).toMatch(TICKET_ID_PATTERN)
    expect(id).toMatch(/^[a-z0-9_-]{15}$/)
  }
})

it('accepts random ids only', () => {
  expect(isTicketId('tk_7h3q9m2xw4ra')).toBe(true)
  for (const id of ['T0003', 'tk_7h3q9m2xw4r', 'tk_7h3q9m2xw4rl', 'TK_7H3Q9M2XW4RA', 'T12', '3'])
    expect(isTicketId(id)).toBe(false)
})
