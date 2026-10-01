// @vitest-environment node

// Run route ids are shape-checked at the Next entry: an id that is neither a
// Run directory name nor a project-relative Run path answers 400
// INVALID_RESOURCE before any runtime/project/filesystem lookup (it used to
// surface as a 500 from the lookup).

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../lib/server/runtime', () => ({
  getRuntime: vi.fn(),
}))

import { getRuntime } from '../../../../lib/server/runtime'
import { PATCH as patchArchive } from './archive/route'
import { GET as getFiles } from './files/route'
import { GET as getReadme, PUT as putReadme } from './readme/route'
import { GET as getRun } from './route'
import { PATCH as patchStatus } from './status/route'
import { DELETE as deleteWarning, PATCH as patchWarning } from './warnings/[rowId]/route'
import { GET as getWarnings, POST as postWarning } from './warnings/route'

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const rowCtx = (id: string) => ({ params: Promise.resolve({ id, rowId: 'r1' }) })
const req = (method = 'GET') =>
  new NextRequest('http://localhost/api/runs/x', {
    method,
    ...(method === 'GET' ? {} : { body: '{}' }),
  })

beforeEach(() => {
  vi.mocked(getRuntime).mockReset()
  vi.mocked(getRuntime).mockRejectedValue(new Error('runtime must not be reached'))
})

describe('Run route id validation', () => {
  it.each([
    '../etc',
    '..',
    'logs/../etc',
    'foo',
    'a/b',
    '/etc/passwd',
    'logs\\x-260101-000000',
  ])('rejects %j with 400 INVALID_RESOURCE on every Run route before any lookup', async (id) => {
    const responses = await Promise.all([
      getRun(req(), ctx(id)),
      getReadme(req(), ctx(id)),
      putReadme(req('PUT'), ctx(id)),
      patchStatus(req('PATCH'), ctx(id)),
      patchArchive(req('PATCH'), ctx(id)),
      getFiles(req(), ctx(id)),
      getWarnings(req(), ctx(id)),
      postWarning(req('POST'), ctx(id)),
      patchWarning(req('PATCH'), rowCtx(id)),
      deleteWarning(req('DELETE'), rowCtx(id)),
    ])
    for (const response of responses) {
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'INVALID_RESOURCE' } })
    }
    expect(getRuntime).not.toHaveBeenCalled()
  })

  it('lets Run directory names and project-relative Run paths through to the lookup', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      config: { projects: [] },
      index: { get: () => undefined },
    } as never)
    for (const id of ['foo-260501-100000', 'logs/foo-260501-100000']) {
      const response = await getRun(req(), ctx(id))
      expect(response.status).toBe(404)
    }
    expect(getRuntime).toHaveBeenCalled()
  })
})
