import { describe, expect, it } from 'vitest'
import { FileMutationRequestSchema } from './index.js'

const append = (line = '{}\n') => ({
  operation: 'append',
  project: 'project-a',
  path: 'docs/discussions/D0001-design/responses.jsonl',
  requestId: 'r1',
  lockVersion: 1,
  expectedSize: 0,
  content: Buffer.from(line).toString('base64'),
})
describe('bounded append protocol', () => {
  it('accepts one UTF-8 JSON line with an explicit expected size', () => {
    expect(FileMutationRequestSchema.parse(append('{"comment":"同意🙂"}\n'))).toMatchObject({
      operation: 'append',
      expectedSize: 0,
    })
  })
  it('rejects multiline, incomplete, oversized and malformed data', () => {
    for (const line of ['{}', '{}\n{}\n', 'bad\n', '{}\r\n', `{"x":"${'x'.repeat(4096)}"}\n`])
      expect(FileMutationRequestSchema.safeParse(append(line)).success).toBe(false)
    expect(
      FileMutationRequestSchema.safeParse({
        ...append(),
        content: Buffer.from([0xff, 10]).toString('base64'),
      }).success,
    ).toBe(false)
  })
  it('rejects missing/negative sizes and replacement-only fields', () => {
    for (const patch of [
      { expectedSize: undefined },
      { expectedSize: -1 },
      { expectedSize: 1.5 },
      { precondition: { kind: 'absent' } },
      { mode: 0o600 },
    ])
      expect(FileMutationRequestSchema.safeParse({ ...append(), ...patch }).success).toBe(false)
  })
})
