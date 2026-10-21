// @vitest-environment node
//
// `/p/<project>/r/<run>` redirects to the exp-detail route with
// `?run=<run>`. The parent comes from the Run detail served by the shared
// standalone Project service (directory ownership in FS11); two Run
// directories sharing a base name are distinct resources addressed by their
// project-relative paths.
//
// The page is a server component; `permanentRedirect` (which throws a
// NEXT_REDIRECT error in real life), `getRuntime` and the standalone
// services are mocked.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  permanentRedirect: vi.fn((url: string) => {
    const err = new Error(`NEXT_REDIRECT: ${url}`)
    ;(err as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};308;`
    throw err
  }),
}))

vi.mock('../../lib/server/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('../../lib/server/standalone-services', () => ({ standaloneServices: vi.fn() }))
vi.mock('@memon/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@memon/core')>()),
  BackendRunResponseSchema: { parse: (value: unknown) => value },
}))

import { permanentRedirect } from 'next/navigation'
import LegacyRunRedirect from '../../app/p/[project]/r/[id]/page'
import { getRuntime } from '../../lib/server/runtime'
import { standaloneServices } from '../../lib/server/standalone-services'

const RUN_ID = 'train-260501-100000'
const getRun = vi.fn()

/** Run resource id → owning Experiment (null: the Run has no parent). */
function mockRuns(parents: Record<string, string | null>, project = 'project-a') {
  vi.mocked(getRuntime).mockResolvedValue({
    config: { projects: [{ name: project, root: '/srv/project-a' }] },
  } as never)
  vi.mocked(standaloneServices).mockReturnValue({ projects: { getRun } } as never)
  getRun.mockImplementation(async (name: string, id: string) => {
    if (name !== project || !(id in parents)) throw new Error('Run not found')
    const experiment = parents[id]
    return { id, project: name, frontMatter: experiment ? { experiment } : {} }
  })
}

async function redirectFor(id: string, project = 'project-a'): Promise<string> {
  await LegacyRunRedirect({ params: Promise.resolve({ project, id }) }).catch(() => undefined)
  return vi.mocked(permanentRedirect).mock.calls.at(-1)![0] as string
}

describe('LegacyRunRedirect — /r/<run> → /e/<exp>?run=<run>', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects a Run to its owning experiment', async () => {
    mockRuns({ [RUN_ID]: 'E0001-train' })
    expect(await redirectFor(RUN_ID)).toBe(`/p/project-a/e/E0001-train?run=${RUN_ID}`)
    expect(getRun).toHaveBeenCalledWith('project-a', RUN_ID)
  })

  it('redirects to the project list when the Run has no owning experiment', async () => {
    mockRuns({ [RUN_ID]: null })
    expect(await redirectFor(RUN_ID)).toBe('/p/project-a')
  })

  it('keeps same-basename runs under different paths distinct', async () => {
    mockRuns({
      [`logs/a/${RUN_ID}`]: 'E0001-alpha',
      [`outputs/b/${RUN_ID}`]: 'E0002-beta',
    })
    expect(await redirectFor(`logs/a/${RUN_ID}`)).toBe(
      `/p/project-a/e/E0001-alpha?run=${encodeURIComponent(`logs/a/${RUN_ID}`)}`,
    )
    expect(await redirectFor(`outputs/b/${RUN_ID}`)).toBe(
      `/p/project-a/e/E0002-beta?run=${encodeURIComponent(`outputs/b/${RUN_ID}`)}`,
    )
    // The bare, ambiguous base name never picks one of them.
    expect(await redirectFor(RUN_ID)).toBe('/p/project-a')
  })

  it('redirects to project list when the run is unknown', async () => {
    mockRuns({})
    expect(await redirectFor('nonexistent-260501-100000')).toBe('/p/project-a')
  })

  it('encodes special characters in the redirect URL', async () => {
    mockRuns({ [RUN_ID]: 'E0001-with-dash' }, 'proj/with/slash')
    expect(await redirectFor(RUN_ID, 'proj/with/slash')).toContain('proj%2Fwith%2Fslash')
  })
})
