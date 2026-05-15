import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  MAX_DIFF_BYTES,
  parsePorcelainV2WithFiles,
  readGitFileContents,
  readGitStatusFiles,
} from './files.js'

const execFileP = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileP('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
}

async function initRepoWithCommit(dir: string): Promise<void> {
  await git(dir, ['init', '--initial-branch=main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Test'])
  await git(dir, ['commit', '--allow-empty', '-m', 'initial'])
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memon-git-files-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('parsePorcelainV2WithFiles — synthetic stdout', () => {
  it('parses staged + unstaged + untracked into separate buckets', () => {
    const stdout = [
      '# branch.oid abc1234deadbeef',
      '# branch.head main',
      '1 A. N... 100644 100644 100644 hashA hashB staged-a.txt',
      '1 M. N... 100644 100644 100644 hashA hashB staged-b.txt',
      '1 .M N... 100644 100644 100644 hashA hashB unstaged.txt',
      '? untracked.txt',
      '',
    ].join('\n')
    const r = parsePorcelainV2WithFiles(stdout)
    if (!r.enabled) throw new Error('expected enabled')
    expect(r.staged.map((e) => e.path)).toEqual(['staged-a.txt', 'staged-b.txt'])
    expect(r.unstaged.map((e) => e.path)).toEqual(['unstaged.txt'])
    expect(r.untracked.map((e) => e.path)).toEqual(['untracked.txt'])
    expect(r.staged[0]!.status).toBe('added')
    expect(r.staged[1]!.status).toBe('modified')
    expect(r.unstaged[0]!.status).toBe('modified')
    expect(r.untracked[0]!.status).toBe('untracked')
  })

  it('places a mixed staged+unstaged file in BOTH lists', () => {
    const stdout = [
      '# branch.oid 0000001000000000000000000000000000000000',
      '# branch.head main',
      '1 MM N... 100644 100644 100644 hashA hashB partial.txt',
      '',
    ].join('\n')
    const r = parsePorcelainV2WithFiles(stdout)
    if (!r.enabled) throw new Error('expected enabled')
    expect(r.staged.map((e) => e.path)).toEqual(['partial.txt'])
    expect(r.unstaged.map((e) => e.path)).toEqual(['partial.txt'])
  })

  it('renamed entry (`2 R..`) surfaces origPath', () => {
    const stdout = [
      '# branch.oid 0000000000000000000000000000000000000004',
      '# branch.head main',
      '2 R. N... 100644 100644 100644 hashA hashB R100 new\told',
      '',
    ].join('\n')
    const r = parsePorcelainV2WithFiles(stdout)
    if (!r.enabled) throw new Error('expected enabled')
    expect(r.staged).toHaveLength(1)
    expect(r.staged[0]).toEqual({
      path: 'new',
      origPath: 'old',
      status: 'renamed',
    })
  })

  it('unmerged (`u`) goes into unstaged with status conflict', () => {
    const stdout = [
      '# branch.oid 0000000000000000000000000000000000000003',
      '# branch.head main',
      'u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict.txt',
      '',
    ].join('\n')
    const r = parsePorcelainV2WithFiles(stdout)
    if (!r.enabled) throw new Error('expected enabled')
    expect(r.unstaged).toEqual([{ path: 'conflict.txt', status: 'conflict' }])
    expect(r.staged).toEqual([])
  })

  it('ignores `! ...` (ignored) lines', () => {
    const stdout = [
      '# branch.oid 0000000000000000000000000000000000000005',
      '# branch.head main',
      '! .DS_Store',
      '? real-untracked.txt',
      '',
    ].join('\n')
    const r = parsePorcelainV2WithFiles(stdout)
    if (!r.enabled) throw new Error('expected enabled')
    expect(r.untracked).toEqual([{ path: 'real-untracked.txt', status: 'untracked' }])
  })

  it('parses paths containing spaces', () => {
    const stdout = [
      '# branch.oid abc1234deadbeef',
      '# branch.head main',
      '1 .M N... 100644 100644 100644 hashA hashB folder/a name with spaces.txt',
      '',
    ].join('\n')
    const r = parsePorcelainV2WithFiles(stdout)
    if (!r.enabled) throw new Error('expected enabled')
    expect(r.unstaged.map((e) => e.path)).toEqual([
      'folder/a name with spaces.txt',
    ])
  })
})

describe('readGitStatusFiles — end-to-end against real git', () => {
  it('returns bucketed entries for staged + unstaged + untracked', async () => {
    await initRepoWithCommit(root)
    await writeFile(join(root, 'tracked.txt'), 'v1\n', 'utf8')
    await git(root, ['add', 'tracked.txt'])
    await git(root, ['commit', '-m', 'add tracked'])

    await writeFile(join(root, 'new-staged.txt'), 'x\n', 'utf8')
    await git(root, ['add', 'new-staged.txt'])
    await writeFile(join(root, 'tracked.txt'), 'v2\n', 'utf8')
    await writeFile(join(root, 'untracked.txt'), 'z\n', 'utf8')

    const r = await readGitStatusFiles(root)
    if (!r.enabled) throw new Error(`expected enabled; got ${JSON.stringify(r)}`)
    expect(r.staged.map((e) => e.path).sort()).toEqual(['new-staged.txt'])
    expect(r.unstaged.map((e) => e.path).sort()).toEqual(['tracked.txt'])
    expect(r.untracked.map((e) => e.path).sort()).toEqual(['untracked.txt'])
  })

  it('returns {enabled:false, reason:not-a-repo} for a non-git dir', async () => {
    const isolated = await mkdtemp(join(tmpdir(), 'memon-no-git-'))
    try {
      const r = await readGitStatusFiles(isolated)
      expect(r).toEqual({ enabled: false, reason: 'not-a-repo' })
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })
})

describe('readGitFileContents — working tree', () => {
  it('reads a small UTF-8 file', async () => {
    await initRepoWithCommit(root)
    await writeFile(join(root, 'app.ts'), 'hello\nworld\n', 'utf8')
    const r = await readGitFileContents(root, 'working', 'app.ts')
    expect(r).toEqual({ ok: true, content: 'hello\nworld\n' })
  })

  it('rejects an oversize working-tree file', async () => {
    await initRepoWithCommit(root)
    // Write 2 MB of `a`s
    const buf = Buffer.alloc(2 * 1024 * 1024, 0x61)
    await writeFile(join(root, 'big.txt'), buf)
    const r = await readGitFileContents(root, 'working', 'big.txt')
    expect(r).toMatchObject({
      ok: false,
      reason: 'too-large',
      maxBytes: MAX_DIFF_BYTES,
      sizeBytes: 2 * 1024 * 1024,
    })
  })

  it('honors a smaller maxBytes override', async () => {
    await initRepoWithCommit(root)
    await writeFile(join(root, 'small.txt'), 'abcdefgh', 'utf8')
    const r = await readGitFileContents(root, 'working', 'small.txt', {
      maxBytes: 4,
    })
    expect(r).toEqual({ ok: false, reason: 'too-large', sizeBytes: 8, maxBytes: 4 })
  })

  it('detects binary via null byte', async () => {
    await initRepoWithCommit(root)
    const buf = Buffer.from([0x66, 0x00, 0x6f, 0x6f])
    await writeFile(join(root, 'binary.bin'), buf)
    const r = await readGitFileContents(root, 'working', 'binary.bin')
    expect(r).toEqual({ ok: false, reason: 'binary' })
  })

  it('detects invalid UTF-8 as binary', async () => {
    await initRepoWithCommit(root)
    // 0xC0 is never legal as the leading byte of a UTF-8 sequence.
    const buf = Buffer.from([0xc0, 0x41, 0x42, 0x43])
    await writeFile(join(root, 'latin.txt'), buf)
    const r = await readGitFileContents(root, 'working', 'latin.txt')
    expect(r).toEqual({ ok: false, reason: 'binary' })
  })

  it('returns not-found for a missing working-tree file', async () => {
    await initRepoWithCommit(root)
    const r = await readGitFileContents(root, 'working', 'does-not-exist.txt')
    expect(r).toEqual({ ok: false, reason: 'not-found' })
  })

  it('rejects path-escape (..) attempts', async () => {
    await initRepoWithCommit(root)
    const r = await readGitFileContents(root, 'working', '../../../etc/passwd')
    expect(r).toMatchObject({ ok: false, reason: 'error' })
    if (r.ok === false && r.reason === 'error') {
      expect(r.message).toMatch(/path escapes/i)
    }
  })
})

describe('readGitFileContents — git refs (HEAD / index)', () => {
  it('reads HEAD:<path> content', async () => {
    await initRepoWithCommit(root)
    await writeFile(join(root, 'committed.txt'), 'in HEAD\n', 'utf8')
    await git(root, ['add', 'committed.txt'])
    await git(root, ['commit', '-m', 'add'])
    const r = await readGitFileContents(root, 'HEAD', 'committed.txt')
    expect(r).toEqual({ ok: true, content: 'in HEAD\n' })
  })

  it('reads index:<path> after staging an edit', async () => {
    await initRepoWithCommit(root)
    await writeFile(join(root, 'staged.txt'), 'committed\n', 'utf8')
    await git(root, ['add', 'staged.txt'])
    await git(root, ['commit', '-m', 'add'])
    await writeFile(join(root, 'staged.txt'), 'modified-in-index\n', 'utf8')
    await git(root, ['add', 'staged.txt'])
    // Working tree now also differs from index, but index has the edit.
    await writeFile(join(root, 'staged.txt'), 'further-modified-in-working\n', 'utf8')

    const r = await readGitFileContents(root, 'index', 'staged.txt')
    expect(r).toEqual({ ok: true, content: 'modified-in-index\n' })
  })

  it('returns not-found for a path not in HEAD', async () => {
    await initRepoWithCommit(root)
    const r = await readGitFileContents(root, 'HEAD', 'never-existed.txt')
    expect(r).toEqual({ ok: false, reason: 'not-found' })
  })

  it('caps over-size git blobs without buffering full content', async () => {
    await initRepoWithCommit(root)
    const buf = Buffer.alloc(2 * 1024 * 1024, 0x61)
    await writeFile(join(root, 'big.txt'), buf)
    await git(root, ['add', 'big.txt'])
    await git(root, ['commit', '-m', 'add big'])
    const r = await readGitFileContents(root, 'HEAD', 'big.txt')
    expect(r).toMatchObject({
      ok: false,
      reason: 'too-large',
      sizeBytes: 2 * 1024 * 1024,
      maxBytes: MAX_DIFF_BYTES,
    })
  })
})

describe('readGitFileContents — arbitrary git refs', () => {
  it('reads bytes at a specific SHA', async () => {
    await initRepoWithCommit(root)
    await writeFile(join(root, 'app.ts'), 'v1\n', 'utf8')
    await git(root, ['add', 'app.ts'])
    await git(root, ['commit', '-m', 'v1'])
    const shaV1 = (
      await execFileP('git', ['rev-parse', 'HEAD'], { cwd: root })
    ).stdout.trim()
    await writeFile(join(root, 'app.ts'), 'v2\n', 'utf8')
    await git(root, ['add', 'app.ts'])
    await git(root, ['commit', '-m', 'v2'])

    const r = await readGitFileContents(root, shaV1, 'app.ts')
    expect(r).toEqual({ ok: true, content: 'v1\n' })
  })

  it('reads bytes at <sha>^ (parent commit)', async () => {
    await initRepoWithCommit(root)
    await writeFile(join(root, 'app.ts'), 'parent\n', 'utf8')
    await git(root, ['add', 'app.ts'])
    await git(root, ['commit', '-m', 'parent'])
    await writeFile(join(root, 'app.ts'), 'child\n', 'utf8')
    await git(root, ['add', 'app.ts'])
    await git(root, ['commit', '-m', 'child'])
    const headSha = (
      await execFileP('git', ['rev-parse', 'HEAD'], { cwd: root })
    ).stdout.trim()

    const r = await readGitFileContents(root, `${headSha}^`, 'app.ts')
    expect(r).toEqual({ ok: true, content: 'parent\n' })
  })

  it('returns not-found for <root-sha>^ (root commit has no parent)', async () => {
    await initRepoWithCommit(root)
    await writeFile(join(root, 'app.ts'), 'first\n', 'utf8')
    await git(root, ['add', 'app.ts'])
    await git(root, ['commit', '-m', 'first'])
    // The previous `--allow-empty -m initial` commit is the root.
    const rootSha = (
      await execFileP('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: root })
    ).stdout.trim()

    const r = await readGitFileContents(root, `${rootSha}^`, 'app.ts')
    expect(r).toEqual({ ok: false, reason: 'not-found' })
  })

  it('reads bytes at a branch name', async () => {
    await initRepoWithCommit(root)
    await writeFile(join(root, 'on-main.ts'), 'main\n', 'utf8')
    await git(root, ['add', 'on-main.ts'])
    await git(root, ['commit', '-m', 'main commit'])
    await git(root, ['checkout', '-b', 'feature/x'])
    await writeFile(join(root, 'on-main.ts'), 'feature\n', 'utf8')
    await git(root, ['add', 'on-main.ts'])
    await git(root, ['commit', '-m', 'feature commit'])

    const r = await readGitFileContents(root, 'main', 'on-main.ts')
    expect(r).toEqual({ ok: true, content: 'main\n' })
  })
})
