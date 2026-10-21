// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
vi.mock('../../../../../lib/server/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('../../../../../lib/server/standalone-services', () => ({ standaloneServices: vi.fn() }))
vi.mock('@memon/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@memon/core')>()),
  BackendRunResponseSchema: { parse: (value: unknown) => value },
}))
vi.mock('../../../../../components/experiment-detail', () => ({
  ExperimentDetail: () => null,
}))

import { BackendProjectServiceError } from '@memon/backend'
import { getRuntime } from '../../../../../lib/server/runtime'
import { standaloneServices } from '../../../../../lib/server/standalone-services'
import ExperimentPage, { generateMetadata } from './page'

const RUN_ID = 'secret-sweep-260101-120000'

/** A runtime whose only Run lives in `project`; every lookup is Project-scoped. */
function runtimeWith(project: string) {
  const run = {
    id: RUN_ID,
    project,
    resource: `logs/${RUN_ID}/run.json`,
    mtime: 1,
    readmeMtime: 1,
    hasReadme: true,
    frontMatter: { status: 'FINISHED' },
    sections: {},
    warnings: [],
    warningsRaw: null,
    body: 'confidential README body',
    parseErrors: [],
    parseWarnings: [],
  }
  vi.mocked(standaloneServices).mockReturnValue({
    projects: {
      getRun: vi.fn(async (name: string, id: string) => {
        if (name !== project || id !== RUN_ID)
          throw new BackendProjectServiceError('RESOURCE_NOT_FOUND', 'Run not found')
        return run
      }),
    },
  } as never)
  return {
    config: {
      projects: [
        { name: 'project-a', root: '/root/project-a' },
        { name: 'project-b', root: '/root/project-b' },
      ],
    },
  }
}

const params = (project: string, id = RUN_ID) => ({ params: Promise.resolve({ project, id }) })

describe('/p/[project]/experiments/[id] project scoping', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 404 for a Run that belongs to another project', async () => {
    vi.mocked(getRuntime).mockResolvedValue(runtimeWith('project-b') as never)
    await expect(ExperimentPage(params('project-a'))).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('does not reveal another project Run in the page title', async () => {
    vi.mocked(getRuntime).mockResolvedValue(runtimeWith('project-b') as never)
    const meta = await generateMetadata(params('project-a'))
    expect(JSON.stringify(meta)).not.toContain('secret-sweep')
    expect(meta).toEqual(await generateMetadata(params('project-a', 'missing-260101-120000')))
  })

  it('hydrates a matching Run under the key the client detail reads', async () => {
    vi.mocked(getRuntime).mockResolvedValue(runtimeWith('project-a') as never)
    const element = (await ExperimentPage(params('project-a'))) as {
      props: { state: { queries: { queryKey: unknown[]; state: { data: { body: string } } }[] } }
    }
    const queries = element.props.state.queries
    expect(queries).toHaveLength(1)
    expect(queries[0]!.queryKey).toEqual(['run', 'project-a', RUN_ID])
    expect(queries[0]!.state.data.body).toBe('confidential README body')
    const meta = await generateMetadata(params('project-a'))
    expect(meta.title).toBe(RUN_ID)
  })
})
