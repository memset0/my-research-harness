import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type BackendGitServiceError, FilesystemGitService } from './git-service.js'

const exec = promisify(execFile)
let root = ''
let firstSha = ''
let secondSha = ''
let service: FilesystemGitService

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

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-backend-git-'))
  await initializeRepo(root)
  await fs.writeFile(join(root, 'tracked.txt'), 'line one\nline two\n')
  await git(root, 'add', 'tracked.txt')
  await git(root, 'commit', '-m', 'initial')
  firstSha = await git(root, 'rev-parse', 'HEAD')
  await fs.writeFile(join(root, 'tracked.txt'), 'line one\nline two updated\n')
  await git(root, 'add', 'tracked.txt')
  await git(root, 'commit', '-m', 'update tracked')
  secondSha = await git(root, 'rev-parse', 'HEAD')
  await fs.writeFile(join(root, 'tracked.txt'), 'working change\n')
  await fs.writeFile(join(root, 'untracked.txt'), 'untracked\n')

  const submoduleRoot = join(root, 'vendor', 'sub')
  await initializeRepo(submoduleRoot)
  await fs.writeFile(join(submoduleRoot, 'sub.txt'), 'submodule\n')
  await git(submoduleRoot, 'add', 'sub.txt')
  await git(submoduleRoot, 'commit', '-m', 'submodule initial')
  await fs.writeFile(
    join(root, '.gitmodules'),
    '[submodule "sub"]\n  path = vendor/sub\n  url = https://example.test/sub.git\n',
  )

  const project = {
    name: 'research',
    root,
    include: [],
    exclude: [],
    github: [{ owner: 'acme', repo: 'demo', path: root }],
    // This host owns the fixture worktree, so git is allowed to run here.
    execution: { kind: 'local' },
  } satisfies ProjectConfig
  service = new FilesystemGitService([project])
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function expectNoAbsolutePath(value: unknown): void {
  expect(JSON.stringify(value)).not.toContain(root)
}

describe('FilesystemGitService', () => {
  it('serves status, file, branch, log, commit, range, and diff DTOs without absolute paths', async () => {
    const status = BackendGitStatusResponseSchema.parse(await service.status('research'))
    expect(status).toMatchObject({ enabled: true, dirty: true })
    const files = BackendGitStatusFilesResponseSchema.parse(
      await service.statusFiles('research', {}),
    )
    expect(files.enabled && files.untracked.some((entry) => entry.path === 'untracked.txt')).toBe(
      true,
    )
    const branches = BackendGitBranchesResponseSchema.parse(await service.branches('research', {}))
    expect(branches.enabled).toBe(true)
    const log = BackendGitLogResponseSchema.parse(
      await service.log('research', { ref: 'HEAD', limit: 10 }),
    )
    expect(log.enabled && log.commits[0]?.sha).toBe(secondSha)
    const commit = BackendGitCommitResponseSchema.parse(
      await service.commit('research', secondSha, {}),
    )
    expect(commit.enabled && commit.files[0]?.path).toBe('tracked.txt')
    const range = BackendGitRangeResponseSchema.parse(
      await service.range('research', { from: firstSha, to: secondSha }),
    )
    expect(range).toMatchObject({ enabled: true, from: firstSha, to: secondSha, submodule: '' })
    const diff = BackendGitDiffResponseSchema.parse(
      await service.diff('research', {
        path: 'tracked.txt',
        side: 'commit',
        sha: secondSha,
      }),
    )
    expect(diff).toMatchObject({ ok: true, filename: 'tracked.txt', status: 'modified' })
    for (const payload of [status, files, branches, log, commit, range, diff]) {
      expectNoAbsolutePath(payload)
    }
  })

  it('resolves only declared, contained submodules and rejects working-tree symlink escape', async () => {
    const submodules = BackendGitSubmodulesResponseSchema.parse(
      await service.submodules('research'),
    )
    expect(submodules).toMatchObject({
      enabled: true,
      submodules: [{ name: 'sub', path: 'vendor/sub' }],
    })
    const branches = BackendGitBranchesResponseSchema.parse(
      await service.branches('research', { submodule: 'sub' }),
    )
    expect(branches.enabled).toBe(true)
    await expect(service.branches('research', { submodule: 'missing' })).rejects.toMatchObject({
      code: 'INVALID_RESOURCE',
    } satisfies Partial<BackendGitServiceError>)

    await fs.symlink('/etc/hostname', join(root, 'escape.txt'))
    await expect(
      service.diff('research', { path: 'escape.txt', side: 'untracked' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESOURCE' } satisfies Partial<BackendGitServiceError>)
  })

  it('diffs working-tree paths that are absent and still rejects escapes through absent leaves', async () => {
    await fs.rm(join(root, 'tracked.txt'))
    expect(
      BackendGitDiffResponseSchema.parse(
        await service.diff('research', { path: 'tracked.txt', side: 'unstaged' }),
      ),
    ).toEqual({
      ok: true,
      filename: 'tracked.txt',
      status: 'deleted',
      oldContent: 'line one\nline two updated\n',
      newContent: '',
    })
    // Absent file under absent directories: containment passes, readers decide.
    await expect(
      service.diff('research', { path: 'nested/missing/new.txt', side: 'untracked' }),
    ).resolves.toMatchObject({ filename: 'nested/missing/new.txt' })

    const outside = await fs.mkdtemp(join(tmpdir(), 'memon-backend-git-outside-'))
    try {
      await fs.symlink(outside, join(root, 'out'))
      for (const side of ['untracked', 'unstaged'] as const) {
        await expect(service.diff('research', { path: 'out/new.txt', side })).rejects.toMatchObject(
          { code: 'INVALID_RESOURCE' } satisfies Partial<BackendGitServiceError>,
        )
      }
      await expect(
        service.diff('research', { path: '../outside.txt', side: 'untracked' }),
      ).rejects.toMatchObject({
        code: 'INVALID_RESOURCE',
      } satisfies Partial<BackendGitServiceError>)
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('does not fail the working-tree containment check when the Project root is absent', async () => {
    const absent = join(root, 'not-created-yet')
    const absentService = new FilesystemGitService([
      {
        name: 'absent',
        root: absent,
        include: [],
        exclude: [],
        execution: { kind: 'local' },
      } satisfies ProjectConfig,
    ])
    // The containment check passes; the Git readers report the missing worktree.
    await expect(
      absentService.diff('absent', { path: 'app.ts', side: 'unstaged' }),
    ).resolves.toBeDefined()
  })

  it('resolves GitHub permalinks through configured local mappings only', async () => {
    const preview = BackendCodePreviewResponseSchema.parse(
      await service.codePreview(
        'research',
        `https://github.com/acme/demo/blob/${secondSha}/tracked.txt#L1-L2`,
      ),
    )
    expect(preview).toMatchObject({
      owner: 'acme',
      repo: 'demo',
      sha: secondSha,
      path: 'tracked.txt',
    })
    expect(preview.lines.filter((line) => line.target)).toHaveLength(2)
    expectNoAbsolutePath(preview)
    await expect(
      service.codePreview(
        'research',
        `https://github.com/other/demo/blob/${secondSha}/tracked.txt#L1`,
      ),
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    } satisfies Partial<BackendGitServiceError>)
  })

  it('preserves commit-mark upsert, submodule selection, and idempotent delete semantics', async () => {
    const first = BackendCommitMarkWriteResponseSchema.parse(
      await service.setCommitMark('research', secondSha, {
        status: 'verified',
        note: 'first',
      }),
    )
    expect(first.mark).toMatchObject({ sha: secondSha, status: 'verified', submodule: '' })
    const updated = BackendCommitMarkWriteResponseSchema.parse(
      await service.setCommitMark('research', secondSha, {
        status: 'issue',
        note: 'updated',
      }),
    )
    expect(updated.mark).toMatchObject({ status: 'issue', note: 'updated' })
    await service.setCommitMark('research', secondSha, {
      status: 'suspicious',
      submodule: 'sub',
    })
    const marks = BackendCommitMarksResponseSchema.parse(await service.commitMarks('research'))
    expect(marks.marks).toHaveLength(2)
    expectNoAbsolutePath(marks)
    expect(
      BackendCommitMarkDeleteResponseSchema.parse(
        await service.deleteCommitMark('research', secondSha, { submodule: 'sub' }),
      ),
    ).toEqual({ deleted: true })
    expect(
      BackendCommitMarkDeleteResponseSchema.parse(
        await service.deleteCommitMark('research', secondSha, { submodule: 'sub' }),
      ),
    ).toEqual({ deleted: false })
  })

  it('rejects unknown Projects, unsafe refs, and absolute identifiers before Git execution', async () => {
    await expect(service.status('missing')).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' })
    await expect(service.commit('research', '--all', {})).rejects.toMatchObject({
      code: 'INVALID_RESOURCE',
    })
    await expect(
      service.diff('research', { path: '/etc/passwd', side: 'untracked' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESOURCE' })
  })
})
