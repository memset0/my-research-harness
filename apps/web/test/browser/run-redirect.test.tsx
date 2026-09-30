// @vitest-environment node
//
// `/p/<project>/r/<run>` redirects to the exp-detail route with
// `?run=<run>`. FS v7: the parent comes from Experiment `runs[]`
// declarations only, and two Run directories sharing a base name are
// distinct resources addressed by their project-relative paths.
//
// The page is a server component; `permanentRedirect` (which throws a
// NEXT_REDIRECT error in real life) and `getRuntime` are mocked. The mocked
// runtime delegates parent derivation to the real
// `declaredParentExperimentId` helper.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  permanentRedirect: vi.fn((url: string) => {
    const err = new Error(`NEXT_REDIRECT: ${url}`)
    ;(err as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};308;`
    throw err
  }),
}))

vi.mock('../../app/p/[project]/r/[id]/../../../../../lib/runtime', async (importActual) => {
  const actual = await importActual<typeof import('../../lib/runtime')>()
  return { declaredParentExperimentId: actual.declaredParentExperimentId, getRuntime: vi.fn() }
})

import type { Experiment, Run } from '@memon/core'
import { permanentRedirect } from 'next/navigation'
import LegacyRunRedirect from '../../app/p/[project]/r/[id]/page'
import { declaredParentExperimentId, getRuntime } from '../../lib/runtime'

const ROOT = '/srv/project-a'
const RUN_ID = 'train-260501-100000'

function run(path: string, project = 'project-a'): Run {
  return {
    id: path.split('/').at(-1)!,
    path: `${ROOT}/${path}`,
    project,
    frontMatter: { experiment: 'E0009-stale-legacy-field' },
  } as unknown as Run
}

function experiment(id: string, runs: string[]): Experiment {
  return { id, project: 'project-a', frontMatter: { runs } } as unknown as Experiment
}

function mockRuntime(runs: Run[], experiments: Experiment[], project = 'project-a') {
  vi.mocked(getRuntime).mockResolvedValue({
    config: { projects: [{ name: project, root: ROOT }] },
    index: {
      list: vi.fn(({ project: name }: { project: string }) =>
        runs.filter((candidate) => candidate.project === name),
      ),
    },
    withDeclaredParent: (target: Run) =>
      declaredParentExperimentId(experiments, ROOT, target, runs),
  } as never)
}

async function redirectFor(id: string, project = 'project-a'): Promise<string> {
  await LegacyRunRedirect({ params: Promise.resolve({ project, id }) }).catch(() => undefined)
  return vi.mocked(permanentRedirect).mock.calls.at(-1)![0] as string
}

describe('LegacyRunRedirect — /r/<run> → /e/<exp>?run=<run>', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects a declared run to its declaring experiment', async () => {
    mockRuntime([run(`logs/${RUN_ID}`)], [experiment('E0001-train', [`logs/${RUN_ID}`])])
    expect(await redirectFor(RUN_ID)).toBe(`/p/project-a/e/E0001-train?run=${RUN_ID}`)
  })

  it('ignores a legacy Run-side experiment field when nothing declares the run', async () => {
    mockRuntime([run(`logs/${RUN_ID}`)], [experiment('E0001-train', [])])
    expect(await redirectFor(RUN_ID)).toBe('/p/project-a')
  })

  it('keeps same-basename runs under different paths distinct', async () => {
    const runs = [run(`logs/a/${RUN_ID}`), run(`outputs/b/${RUN_ID}`)]
    const experiments = [
      experiment('E0001-alpha', [`logs/a/${RUN_ID}`]),
      experiment('E0002-beta', [`outputs/b/${RUN_ID}`]),
    ]
    mockRuntime(runs, experiments)
    expect(await redirectFor(`logs/a/${RUN_ID}`)).toBe(
      `/p/project-a/e/E0001-alpha?run=${encodeURIComponent(`logs/a/${RUN_ID}`)}`,
    )
    expect(await redirectFor(`outputs/b/${RUN_ID}`)).toBe(
      `/p/project-a/e/E0002-beta?run=${encodeURIComponent(`outputs/b/${RUN_ID}`)}`,
    )
    // The bare, ambiguous base name never picks one of them.
    expect(await redirectFor(RUN_ID)).toBe('/p/project-a')
  })

  it('does not resolve a legacy bare-id declaration when the base name is ambiguous', async () => {
    mockRuntime(
      [run(`logs/a/${RUN_ID}`), run(`outputs/b/${RUN_ID}`)],
      [experiment('E0001-alpha', [RUN_ID])],
    )
    expect(await redirectFor(`logs/a/${RUN_ID}`)).toBe('/p/project-a')
  })

  it('redirects to project list when the run is unknown', async () => {
    mockRuntime([], [])
    expect(await redirectFor('nonexistent-260501-100000')).toBe('/p/project-a')
  })

  it('encodes special characters in the redirect URL', async () => {
    mockRuntime(
      [run(`logs/${RUN_ID}`, 'proj/with/slash')],
      [experiment('E0001-with-dash', [`logs/${RUN_ID}`])],
      'proj/with/slash',
    )
    expect(await redirectFor(RUN_ID, 'proj/with/slash')).toContain('proj%2Fwith%2Fslash')
  })
})
