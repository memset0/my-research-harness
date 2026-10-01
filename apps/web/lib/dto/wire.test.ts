import { describe, expect, it } from 'vitest'
import type { Wire } from './wire'

// `tsc` checks the @ts-expect-error lines: Wire<T> relaxes enum precision but
// still rejects missing, extra and differently shaped fields.
interface Sample {
  status: 'OPEN' | 'RESOLVED'
  nested: { kind: 'a'; count: number }[]
  optional?: string | null
}

describe('Wire<T>', () => {
  it('widens string-literal unions but keeps the structure', () => {
    const widened = { status: 'ANY', nested: [{ kind: 'b', count: 1 }] } satisfies Wire<Sample>
    // @ts-expect-error a required field is missing
    const missing = { nested: [] } satisfies Wire<Sample>
    // @ts-expect-error an undeclared field is present
    const extra = { status: 'OPEN', nested: [], more: true } satisfies Wire<Sample>
    // @ts-expect-error a nested field has the wrong type
    const wrong = { status: 'OPEN', nested: [{ kind: 'a', count: '1' }] } satisfies Wire<Sample>
    expect([widened, missing, extra, wrong]).toHaveLength(4)
  })
})
