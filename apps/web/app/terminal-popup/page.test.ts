// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { generateMetadata } from './page'

describe('terminal popup metadata', () => {
  it('includes Host and Project for equal-name central terminal targets', async () => {
    const titleA = await generateMetadata({
      searchParams: Promise.resolve({
        host: 'host-a',
        project: 'shared',
        scope: 'exp',
        slug: 'E0001-demo',
      }),
    })
    const titleB = await generateMetadata({
      searchParams: Promise.resolve({
        host: 'host-b',
        project: 'shared',
        scope: 'exp',
        slug: 'E0001-demo',
      }),
    })
    expect(titleA.title).toBe('host-a/shared · exp:E0001-demo')
    expect(titleB.title).toBe('host-b/shared · exp:E0001-demo')
  })

  it('preserves the standalone title shape', async () => {
    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ project: 'shared', scope: 'run', slug: 'run-a' }),
    })
    expect(metadata.title).toBe('run:run-a')
  })
})
