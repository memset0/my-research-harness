// @vitest-environment node
//
// v3-spec-sync task 2.3.6 — `/p/<project>/r/<run-id>` redirects to the
// new exp-detail route with `?run=<run-id>`.
//
// Decision: vitest + node env. The page is a server component that
// resolves `params`, looks up the run via the runtime, and calls
// `permanentRedirect`. We mock `permanentRedirect` (which throws a
// Next.js redirect error in real life) and the runtime, and assert
// the redirect target string.

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('next/navigation', () => ({
  permanentRedirect: vi.fn((url: string) => {
    // Real `permanentRedirect` throws a NEXT_REDIRECT error. Match that
    // contract so the test exercises the same control-flow assumptions
    // the production code makes (the comment on the page warns that
    // permanentRedirect must NOT be inside try/catch).
    const err = new Error(`NEXT_REDIRECT: ${url}`)
    ;(err as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};308;`
    throw err
  }),
}))

vi.mock('../../app/p/[project]/r/[id]/../../../../../lib/runtime', () => ({
  getRuntime: vi.fn(),
}))

import { permanentRedirect } from 'next/navigation'
// Page imports `getRuntime` from a relative path five levels up.
// The mock above shadows that exact resolved path.
import LegacyRunRedirect from '../../app/p/[project]/r/[id]/page'
import { getRuntime } from '../../lib/runtime'

const RUN_ID = 'foo-260501-100000'
const EXP_ID = 'E0001-foo'

function mockRuntime(experiment: string | null) {
  vi.mocked(getRuntime).mockResolvedValue({
    index: {
      get: vi.fn((id: string) =>
        id === RUN_ID
          ? {
              id: RUN_ID,
              frontMatter: { experiment },
            }
          : undefined,
      ),
    },
  } as never)
}

describe('LegacyRunRedirect — /r/<run> → /e/<exp>?run=<run>', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to /e/<exp>?run=<run> when the run is bound', async () => {
    mockRuntime(EXP_ID)

    let caught: Error | null = null
    try {
      await LegacyRunRedirect({
        params: Promise.resolve({ project: 'project-a', id: RUN_ID }),
      })
    } catch (err) {
      caught = err as Error
    }

    expect(caught?.message).toContain('NEXT_REDIRECT')
    expect(permanentRedirect).toHaveBeenCalledWith(
      `/p/project-a/e/${EXP_ID}?run=${RUN_ID}`,
    )
  })

  it('redirects to project list when the run is orphan (experiment=null)', async () => {
    mockRuntime(null)

    let caught: Error | null = null
    try {
      await LegacyRunRedirect({
        params: Promise.resolve({ project: 'project-a', id: RUN_ID }),
      })
    } catch (err) {
      caught = err as Error
    }

    expect(caught?.message).toContain('NEXT_REDIRECT')
    expect(permanentRedirect).toHaveBeenCalledWith('/p/project-a')
    expect(permanentRedirect).not.toHaveBeenCalledWith(
      expect.stringContaining(`?run=${RUN_ID}`),
    )
  })

  it('redirects to project list when the run is unknown', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      index: { get: vi.fn(() => undefined) },
    } as never)

    let caught: Error | null = null
    try {
      await LegacyRunRedirect({
        params: Promise.resolve({ project: 'project-a', id: 'nonexistent' }),
      })
    } catch (err) {
      caught = err as Error
    }

    expect(caught?.message).toContain('NEXT_REDIRECT')
    expect(permanentRedirect).toHaveBeenCalledWith('/p/project-a')
  })

  it('encodes special characters in the redirect URL', async () => {
    mockRuntime('E0001-with-dash')

    try {
      await LegacyRunRedirect({
        params: Promise.resolve({ project: 'proj/with/slash', id: RUN_ID }),
      })
    } catch {
      // expected redirect throw
    }

    const calls = vi.mocked(permanentRedirect).mock.calls
    const url = calls[0]![0] as string
    // path components are URL-encoded
    expect(url).toContain('proj%2Fwith%2Fslash')
  })
})
