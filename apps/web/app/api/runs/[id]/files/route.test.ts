// @vitest-environment node

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BackendRunFilesResponseSchema } from '@memon/core'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../lib/server/runtime', () => ({ getRuntime: vi.fn() }))

import { getRuntime } from '../../../../../lib/server/runtime'
import { GET } from './route'

let root = ''
let runRoot = ''
const RUN_ID = 'foo-260501-100000'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memon-run-files-route-'))
  runRoot = join(root, 'logs', RUN_ID)
  await mkdir(join(runRoot, 'logs'), { recursive: true })
  await Promise.all([
    writeFile(
      join(runRoot, 'README.md'),
      `---
id: ${RUN_ID}
name: foo
project: ''
status: FINISHED
archived: false
created_at: 2026-08-23T00:00:00Z
updated_at: 2026-08-23T00:00:00Z
finished_at: 2026-08-23T01:00:00Z
host: null
pid: null
gpus: []
entry: ./run.sh
command: ./run.sh
wandb: null
hypotheses: []
tags: []
---
`,
    ),
    writeFile(join(runRoot, 'logs', 'stdout.log'), 'safe\n'),
    writeFile(join(runRoot, '.secret'), 'hidden\n'),
    writeFile(join(root, 'outside-secret'), 'private\n'),
  ])
  await symlink(join(root, 'outside-secret'), join(runRoot, 'logs', 'escape'))
  vi.mocked(getRuntime).mockResolvedValue({
    config: {
      projects: [{ name: 'research', root, include: [], exclude: [] }],
    },
    // Direct mode: the legacy Run index is empty and must not gate the read.
    index: { get: () => null },
    projectFor: () => ({ name: 'research', root }),
  } as never)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function request(query = 'project=research&depth=3') {
  return GET(new NextRequest(`http://localhost/api/runs/${RUN_ID}/files?${query}`), {
    params: Promise.resolve({ id: RUN_ID }),
  })
}

describe('GET /api/runs/:id/files', () => {
  it('returns a strict portable tree and ignores hidden files and symlinks', async () => {
    const response = await request()
    expect(response.status).toBe(200)
    const raw = await response.json()
    const { runPath, ...portableResponse } = raw
    const payload = BackendRunFilesResponseSchema.parse({
      ...portableResponse,
      tree: portableTree(raw.tree),
    })
    const serialized = JSON.stringify(payload)
    expect(payload.resource).toBe(`logs/${RUN_ID}`)
    expect(serialized).toContain('logs/stdout.log')
    expect(serialized).not.toContain('.secret')
    expect(serialized).not.toContain('escape')
    expect(serialized).not.toContain(root)
    expect(serialized).not.toMatch(/"(?:path|root|cwd|absolutePath)"\s*:/)
    // No absolute Run path crosses the boundary.
    expect(runPath).toBeUndefined()
    expect(raw.tree.path).toBe('.')
  })

  it('resolves a project-relative Run path and reports an unknown Run as 404', async () => {
    const byPath = await GET(
      new NextRequest(`http://localhost/api/runs/logs%2F${RUN_ID}/files?project=research`),
      { params: Promise.resolve({ id: `logs/${RUN_ID}` }) },
    )
    expect(byPath.status).toBe(200)
    expect((await byPath.json()).resource).toBe(`logs/${RUN_ID}`)
    const missing = await GET(
      new NextRequest('http://localhost/api/runs/logs%2Fnone-260501-100000/files?project=research'),
      { params: Promise.resolve({ id: 'logs/none-260501-100000' }) },
    )
    expect(missing.status).toBe(404)
  })

  it('requires an exact Project and bounded depth', async () => {
    expect((await request('project=other&depth=3')).status).toBe(404)
    expect((await request('project=research&depth=7')).status).toBe(400)
    expect((await request('depth=3')).status).toBe(400)
  })
})

function portableTree(node: Record<string, unknown>): Record<string, unknown> {
  const { path: _path, children, ...portable } = node
  return {
    ...portable,
    ...(Array.isArray(children)
      ? { children: children.map((child) => portableTree(child as Record<string, unknown>)) }
      : {}),
  }
}
