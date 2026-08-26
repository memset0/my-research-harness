// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { generateMetadata } from './page'

describe('tmux page metadata', () => {
  it('includes the selected Host and session in central mode', async () => {
    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ host: 'host-a', session: 'memon-manual-shared' }),
    })
    expect(metadata.title).toBe('memon-manual-shared · host-a · Tmux')
  })

  it('preserves the standalone title', async () => {
    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ session: 'memon-manual-shared' }),
    })
    expect(metadata.title).toBe('Tmux')
  })
})
