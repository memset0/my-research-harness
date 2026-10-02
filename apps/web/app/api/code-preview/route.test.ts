// @vitest-environment node

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/server/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('../../../lib/server/path-safety', () => ({
  assertWithinProjectRoots: vi.fn(),
  PathSafetyError: class PathSafetyError extends Error {},
}))
// Real parseGithubPermalink + sliceContext; only the git read is mocked.
vi.mock('@memon/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memon/core')>()
  return { ...actual, readGitFileContents: vi.fn() }
})

import { readGitFileContents } from '@memon/core'
import { assertWithinProjectRoots, PathSafetyError } from '../../../lib/server/path-safety'
import { getRuntime } from '../../../lib/server/runtime'
import { GET } from './route'

const FILE = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')

function rt() {
  return {
    config: {
      projects: [
        {
          name: 'p',
          execution: { kind: 'local' },
          root: '/proj/p',
          include: [],
          exclude: [],
          github: [{ owner: 'acme', repo: 'demo', path: '/proj/p' }],
        },
      ],
    },
  }
}
const enc = (u: string) => encodeURIComponent(u)
const req = (qs: string) => new NextRequest(`http://x/api/code-preview?${qs}`)

describe('GET /api/code-preview', () => {
  beforeEach(() => vi.clearAllMocks())

  it('200 single-line preview, reads at sha with repo-relative path, flags target', async () => {
    vi.mocked(getRuntime).mockResolvedValue(rt() as never)
    vi.mocked(readGitFileContents).mockResolvedValue({ ok: true, content: FILE } as never)
    const url = 'https://github.com/acme/demo/blob/abc123/src/foo.ts#L10'
    const res = await GET(req(`project=p&url=${enc(url)}`))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j).toMatchObject({
      owner: 'acme',
      repo: 'demo',
      sha: 'abc123',
      path: 'src/foo.ts',
      startLine: 10,
      endLine: 10,
    })
    expect(j.lines.find((l: { n: number }) => l.n === 10).target).toBe(true)
    expect(j.lines.find((l: { n: number }) => l.n === 9).target).toBe(false)
    expect(vi.mocked(readGitFileContents)).toHaveBeenCalledWith('/proj/p', 'abc123', 'src/foo.ts', {
      exec: undefined,
    })
  })

  it('200 range preview marks the whole range as target', async () => {
    vi.mocked(getRuntime).mockResolvedValue(rt() as never)
    vi.mocked(readGitFileContents).mockResolvedValue({ ok: true, content: FILE } as never)
    const res = await GET(
      req(`project=p&url=${enc('https://github.com/acme/demo/blob/s/a.ts#L5-L8')}`),
    )
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.startLine).toBe(5)
    expect(j.endLine).toBe(8)
    expect(
      j.lines.filter((l: { target: boolean }) => l.target).map((l: { n: number }) => l.n),
    ).toEqual([5, 6, 7, 8])
  })

  it('400 when url is missing', async () => {
    vi.mocked(getRuntime).mockResolvedValue(rt() as never)
    expect((await GET(req('project=p'))).status).toBe(400)
  })

  it('400 when url is not a github blob permalink', async () => {
    vi.mocked(getRuntime).mockResolvedValue(rt() as never)
    const res = await GET(req(`project=p&url=${enc('https://example.com/a/b/blob/s/x.ts#L1')}`))
    expect(res.status).toBe(400)
  })

  it('404 for an unknown project', async () => {
    vi.mocked(getRuntime).mockResolvedValue(rt() as never)
    const res = await GET(
      req(`project=zzz&url=${enc('https://github.com/acme/demo/blob/s/x.ts#L1')}`),
    )
    expect(res.status).toBe(404)
  })

  it('404 for an unmapped owner/repo', async () => {
    vi.mocked(getRuntime).mockResolvedValue(rt() as never)
    const res = await GET(
      req(`project=p&url=${enc('https://github.com/other/repo/blob/s/x.ts#L1')}`),
    )
    expect(res.status).toBe(404)
  })

  it('404 when the file/sha is not found locally', async () => {
    vi.mocked(getRuntime).mockResolvedValue(rt() as never)
    vi.mocked(readGitFileContents).mockResolvedValue({ ok: false, reason: 'not-found' } as never)
    const res = await GET(
      req(`project=p&url=${enc('https://github.com/acme/demo/blob/s/x.ts#L1')}`),
    )
    expect(res.status).toBe(404)
  })

  it('graceful 200 with reason for a too-large/binary file', async () => {
    vi.mocked(getRuntime).mockResolvedValue(rt() as never)
    vi.mocked(readGitFileContents).mockResolvedValue({ ok: false, reason: 'binary' } as never)
    const res = await GET(
      req(`project=p&url=${enc('https://github.com/acme/demo/blob/s/x.bin#L1')}`),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).reason).toBe('binary')
  })

  it('403 on a path that escapes the project roots', async () => {
    vi.mocked(getRuntime).mockResolvedValue(rt() as never)
    vi.mocked(assertWithinProjectRoots).mockImplementationOnce(() => {
      throw new PathSafetyError('escape')
    })
    const res = await GET(
      req(`project=p&url=${enc('https://github.com/acme/demo/blob/s/x.ts#L1')}`),
    )
    expect(res.status).toBe(403)
  })

  it('uses the github mapping declared in .memon/project.yml', async () => {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'memon-code-preview-')))
    try {
      await fs.mkdir(join(root, '.memon'))
      await fs.writeFile(
        join(root, '.memon/project.yml'),
        'schema_version: 1\ngithub: [{ owner: acme, repo: demo, path: . }]\n',
      )
      const runtime = rt()
      runtime.config.projects[0] = { ...runtime.config.projects[0]!, root, github: [] }
      vi.mocked(getRuntime).mockResolvedValue(runtime as never)
      vi.mocked(readGitFileContents).mockResolvedValue({ ok: true, content: FILE } as never)
      const url = 'https://github.com/acme/demo/blob/abc123/src/foo.ts#L10'
      const res = await GET(req(`project=p&url=${enc(url)}`))
      expect(res.status).toBe(200)
      expect(vi.mocked(readGitFileContents)).toHaveBeenCalledWith(root, 'abc123', 'src/foo.ts', {
        exec: undefined,
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
