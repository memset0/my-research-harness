// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@memon/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memon/core')>()
  return {
    ...actual,
    readGitSubmodules: vi.fn(),
  }
})

import { readGitSubmodules } from '@memon/core'
import { resolveSubmoduleCwd } from './resolve-submodule-cwd'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveSubmoduleCwd', () => {
  it('returns cwd=projectRoot when submodule is empty / missing', async () => {
    expect(await resolveSubmoduleCwd('/tmp/proj', null)).toEqual({
      ok: true,
      cwd: '/tmp/proj',
      submodule: '',
    })
    expect(await resolveSubmoduleCwd('/tmp/proj', '')).toEqual({
      ok: true,
      cwd: '/tmp/proj',
      submodule: '',
    })
    expect(readGitSubmodules).not.toHaveBeenCalled()
  })

  it('resolves a known submodule to <projectRoot>/<path>', async () => {
    vi.mocked(readGitSubmodules).mockResolvedValue({
      enabled: true,
      submodules: [{ name: 'vendor/foo', path: 'vendor/foo' }],
    })
    const r = await resolveSubmoduleCwd('/tmp/proj', 'vendor/foo')
    expect(r).toEqual({
      ok: true,
      cwd: '/tmp/proj/vendor/foo',
      submodule: 'vendor/foo',
    })
  })

  it('returns 400 for an unknown submodule', async () => {
    vi.mocked(readGitSubmodules).mockResolvedValue({
      enabled: true,
      submodules: [{ name: 'vendor/foo', path: 'vendor/foo' }],
    })
    const r = await resolveSubmoduleCwd('/tmp/proj', 'does-not-exist')
    expect(r).toEqual({
      ok: false,
      status: 400,
      message: expect.stringContaining('unknown submodule'),
    })
  })

  it('returns 400 when the project itself is not a git repo', async () => {
    vi.mocked(readGitSubmodules).mockResolvedValue({
      enabled: false,
      reason: 'not-a-repo',
    })
    const r = await resolveSubmoduleCwd('/tmp/proj', 'vendor/foo')
    expect(r).toEqual({
      ok: false,
      status: 400,
      message: expect.stringContaining('not-a-repo'),
    })
  })

  it('honours name-vs-path divergence (name on the wire, path on disk)', async () => {
    vi.mocked(readGitSubmodules).mockResolvedValue({
      enabled: true,
      submodules: [{ name: 'external-lib', path: 'vendor/lib' }],
    })
    const r = await resolveSubmoduleCwd('/tmp/proj', 'external-lib')
    expect(r).toEqual({
      ok: true,
      cwd: '/tmp/proj/vendor/lib',
      submodule: 'external-lib',
    })
  })
})
