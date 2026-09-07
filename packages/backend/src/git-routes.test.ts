import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  type ActorContext,
  ActorContextSchema,
  type BackendCapabilities,
  BackendCodePreviewResponseSchema,
  BackendCommitMarkDeleteResponseSchema,
  BackendCommitMarksResponseSchema,
  BackendCommitMarkWriteResponseSchema,
  BackendGitBranchesResponseSchema,
  BackendGitCommitResponseSchema,
  BackendGitDiffResponseSchema,
  BackendGitLogResponseSchema,
  BackendGitRangeResponseSchema,
  BackendGitStatusFilesResponseSchema,
  BackendGitStatusResponseSchema,
  BackendGitSubmodulesResponseSchema,
  type ProjectConfig,
} from '@memon/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import { FilesystemGitService } from './git-service.js'
import { createBackendServer } from './server.js'

const exec = promisify(execFile)
const SERVICE_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const CAPABILITIES = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  wikiAssets: true,
  git: true,
  shares: true,
  tmux: true,
  terminal: true,
  slurm: false,
  herdr: false,
} satisfies BackendCapabilities

let root = ''
let origin = ''
let firstSha = ''
let secondSha = ''
let server: ReturnType<typeof createBackendServer>

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await exec('git', args, { cwd })
  return result.stdout.trim()
}

async function initializeRepo(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true })
  await git(directory, 'init')
  await git(directory, 'config', 'user.email', 'backend@example.test')
  await git(directory, 'config', 'user.name', 'Backend Test')
}

beforeAll(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-backend-git-routes-'))
  await initializeRepo(root)
  await fs.writeFile(join(root, 'tracked.txt'), 'first\n')
  await git(root, 'add', 'tracked.txt')
  await git(root, 'commit', '-m', 'initial')
  firstSha = await git(root, 'rev-parse', 'HEAD')
  await fs.writeFile(join(root, 'tracked.txt'), 'second\n')
  await git(root, 'add', 'tracked.txt')
  await git(root, 'commit', '-m', 'second')
  secondSha = await git(root, 'rev-parse', 'HEAD')
  await fs.writeFile(join(root, 'untracked.txt'), 'untracked\n')

  const submoduleRoot = join(root, 'vendor', 'sub')
  await initializeRepo(submoduleRoot)
  await fs.writeFile(join(submoduleRoot, 'sub.txt'), 'sub\n')
  await git(submoduleRoot, 'add', 'sub.txt')
  await git(submoduleRoot, 'commit', '-m', 'sub initial')
  await fs.writeFile(
    join(root, '.gitmodules'),
    '[submodule "sub"]\n  path = vendor/sub\n  url = https://example.test/sub.git\n',
  )

  const projects = [
    {
      name: 'research',
      root,
      include: [],
      exclude: [],
      github: [{ owner: 'acme', repo: 'demo', path: root }],
    },
    {
      name: 'research-copy',
      root,
      include: [],
      exclude: [],
      github: [{ owner: 'acme', repo: 'demo', path: root }],
    },
  ] satisfies ProjectConfig[]
  server = createBackendServer({
    hostId: 'host-a',
    serviceTokens: { current: SERVICE_TOKEN },
    capabilities: CAPABILITIES,
    revision: '0123456789abcdef',
    gitService: new FilesystemGitService(projects),
  })
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolveListen()
    })
  })
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()))
  })
  await fs.rm(root, { recursive: true, force: true })
})

function actorHeader(actor: ActorContext): string {
  return Buffer.from(JSON.stringify(actor), 'utf8').toString('base64url')
}

async function request(
  path: string,
  options: {
    actor?: ActorContext
    service?: boolean
    method?: string
    body?: unknown
  } = {},
): Promise<Response> {
  const headers = new Headers()
  if (options.service !== false) headers.set('authorization', `Bearer ${SERVICE_TOKEN}`)
  if (options.actor) headers.set(BACKEND_ACTOR_CONTEXT_HEADER, actorHeader(options.actor))
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  return fetch(`${origin}${path}`, {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

function expectNoAbsolutePath(value: unknown): void {
  expect(JSON.stringify(value)).not.toContain(root)
}

describe('Backend Git routes', () => {
  const owner = ActorContextSchema.parse({ role: 'owner' })

  it('serves the complete fixed read family with runtime-validated, relative DTOs', async () => {
    const status = BackendGitStatusResponseSchema.parse(
      await (
        await request('/api/backend/v1/projects/research/git-status', { actor: owner })
      ).json(),
    )
    const files = BackendGitStatusFilesResponseSchema.parse(
      await (
        await request('/api/backend/v1/projects/research/git-status/files', { actor: owner })
      ).json(),
    )
    const branches = BackendGitBranchesResponseSchema.parse(
      await (
        await request('/api/backend/v1/projects/research/git-branches', { actor: owner })
      ).json(),
    )
    const log = BackendGitLogResponseSchema.parse(
      await (
        await request('/api/backend/v1/projects/research/git-log?ref=HEAD&limit=5', {
          actor: owner,
        })
      ).json(),
    )
    const commit = BackendGitCommitResponseSchema.parse(
      await (
        await request(`/api/backend/v1/projects/research/git-commit?sha=${secondSha}`, {
          actor: owner,
        })
      ).json(),
    )
    const range = BackendGitRangeResponseSchema.parse(
      await (
        await request(
          `/api/backend/v1/projects/research/git-range?from=${firstSha}&to=${secondSha}`,
          { actor: owner },
        )
      ).json(),
    )
    const diff = BackendGitDiffResponseSchema.parse(
      await (
        await request(
          `/api/backend/v1/projects/research/git-diff?path=tracked.txt&side=commit&sha=${secondSha}`,
          { actor: owner },
        )
      ).json(),
    )
    const submodules = BackendGitSubmodulesResponseSchema.parse(
      await (
        await request('/api/backend/v1/projects/research/submodules', { actor: owner })
      ).json(),
    )
    const previewUrl = encodeURIComponent(
      `https://github.com/acme/demo/blob/${secondSha}/tracked.txt#L1`,
    )
    const preview = BackendCodePreviewResponseSchema.parse(
      await (
        await request(`/api/backend/v1/code-preview?project=research&url=${previewUrl}`, {
          actor: owner,
        })
      ).json(),
    )
    const marks = BackendCommitMarksResponseSchema.parse(
      await (
        await request('/api/backend/v1/projects/research/commit-marks', { actor: owner })
      ).json(),
    )
    expect(status.enabled).toBe(true)
    expect(files.enabled).toBe(true)
    expect(branches.enabled).toBe(true)
    expect(log.enabled).toBe(true)
    expect(commit.enabled).toBe(true)
    expect(range.enabled).toBe(true)
    expect(diff.ok).toBe(true)
    expect(submodules.enabled).toBe(true)
    expect(preview.path).toBe('tracked.txt')
    for (const payload of [
      status,
      files,
      branches,
      log,
      commit,
      range,
      diff,
      submodules,
      preview,
      marks,
    ]) {
      expectNoAbsolutePath(payload)
    }
  })

  it('requires service auth and exact viewer Host/Project scope, then rejects unsafe selectors', async () => {
    const exactViewer = ActorContextSchema.parse({
      role: 'viewer',
      scopes: [{ host: 'host-a', project: 'research' }],
    })
    const wrongHost = ActorContextSchema.parse({
      role: 'viewer',
      scopes: [{ host: 'host-b', project: 'research' }],
    })
    expect(
      (
        await request('/api/backend/v1/projects/research/git-status', {
          actor: owner,
          service: false,
        })
      ).status,
    ).toBe(401)
    expect((await request('/api/backend/v1/projects/research/git-status')).status).toBe(400)
    expect(
      (await request('/api/backend/v1/projects/research/git-status', { actor: exactViewer }))
        .status,
    ).toBe(200)
    expect(
      (
        await request('/api/backend/v1/projects/research/git-status?project=research', {
          actor: owner,
        })
      ).status,
    ).toBe(200)
    expect(
      (await request('/api/backend/v1/projects/research/git-status', { actor: wrongHost })).status,
    ).toBe(403)
    expect(
      (
        await request('/api/backend/v1/projects/research-copy/git-status', {
          actor: exactViewer,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await request('/api/backend/v1/projects/research/git-status?project=other', {
          actor: owner,
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await request('/api/backend/v1/projects/research/git-commit?sha=--all', {
          actor: owner,
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(
          '/api/backend/v1/projects/research/git-diff?path=%2Fetc%2Fpasswd&side=untracked',
          {
            actor: owner,
          },
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await request('/api/backend/v1/projects/research/git-branches?submodule=missing', {
          actor: owner,
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await request('/api/backend/v1/projects/research/git-status?path=tracked.txt', {
          actor: owner,
        })
      ).status,
    ).toBe(404)
  })

  it('keeps commit-mark mutations owner-only, strict, scoped, upserting, and idempotent', async () => {
    const viewer = ActorContextSchema.parse({
      role: 'viewer',
      scopes: [{ host: 'host-a', project: 'research' }],
    })
    expect(
      (
        await request(`/api/backend/v1/projects/research/commit-marks/${secondSha}`, {
          actor: viewer,
          method: 'PUT',
        })
      ).status,
    ).toBe(403)
    const malformed = await request(`/api/backend/v1/projects/research/commit-marks/${secondSha}`, {
      actor: owner,
      method: 'PUT',
      body: { status: 'verified', root },
    })
    expect(malformed.status).toBe(400)
    expectNoAbsolutePath(await malformed.json())

    const first = BackendCommitMarkWriteResponseSchema.parse(
      await (
        await request(`/api/backend/v1/projects/research/commit-marks/${secondSha}`, {
          actor: owner,
          method: 'PUT',
          body: { status: 'verified', note: 'reviewed' },
        })
      ).json(),
    )
    expect(first.mark.status).toBe('verified')
    const updated = BackendCommitMarkWriteResponseSchema.parse(
      await (
        await request(`/api/backend/v1/projects/research/commit-marks/${secondSha}`, {
          actor: owner,
          method: 'PUT',
          body: { status: 'issue', note: 'follow up' },
        })
      ).json(),
    )
    expect(updated.mark).toMatchObject({ status: 'issue', note: 'follow up' })
    const marks = BackendCommitMarksResponseSchema.parse(
      await (
        await request('/api/backend/v1/projects/research/commit-marks', { actor: owner })
      ).json(),
    )
    expect(marks.marks.filter((mark) => mark.sha === secondSha)).toHaveLength(1)

    const deleted = BackendCommitMarkDeleteResponseSchema.parse(
      await (
        await request(`/api/backend/v1/projects/research/commit-marks/${secondSha}`, {
          actor: owner,
          method: 'DELETE',
        })
      ).json(),
    )
    expect(deleted).toEqual({ deleted: true })
    const repeated = BackendCommitMarkDeleteResponseSchema.parse(
      await (
        await request(`/api/backend/v1/projects/research/commit-marks/${secondSha}`, {
          actor: owner,
          method: 'DELETE',
        })
      ).json(),
    )
    expect(repeated).toEqual({ deleted: false })
  })

  it('fails closed before invoking a provider when the Git capability is disabled', async () => {
    const status = vi.fn(async () => ({ enabled: true }))
    const gatedServer = createBackendServer({
      hostId: 'host-a',
      serviceTokens: { current: SERVICE_TOKEN },
      capabilities: { ...CAPABILITIES, git: false },
      revision: '0123456789abcdef',
      gitService: { status } as unknown as FilesystemGitService,
    })
    await new Promise<void>((resolveListen, reject) => {
      gatedServer.once('error', reject)
      gatedServer.listen(0, '127.0.0.1', () => {
        gatedServer.off('error', reject)
        resolveListen()
      })
    })
    try {
      const gatedOrigin = `http://127.0.0.1:${(gatedServer.address() as AddressInfo).port}`
      const response = await fetch(`${gatedOrigin}/api/backend/v1/projects/research/git-status`, {
        headers: {
          authorization: `Bearer ${SERVICE_TOKEN}`,
          [BACKEND_ACTOR_CONTEXT_HEADER]: actorHeader(owner),
        },
      })
      expect(response.status).toBe(404)
      expect(status).not.toHaveBeenCalled()
    } finally {
      await new Promise<void>((resolveClose) => gatedServer.close(() => resolveClose()))
    }
  })
})
