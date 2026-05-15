import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  parseDiffTreeNameStatus,
  readGitBranches,
  readGitCommit,
  readGitLog,
} from './history.js'

const execFileP = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileP('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      // Pin author/committer to deterministic values so assertions on
      // authorName / authorEmail don't depend on the developer's global
      // git config.
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  })
}

async function initRepoWithCommit(dir: string): Promise<void> {
  await git(dir, ['init', '--initial-branch=main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Test'])
  await git(dir, ['commit', '--allow-empty', '-m', 'initial'])
}

async function headSha(dir: string): Promise<string> {
  const r = await execFileP('git', ['rev-parse', 'HEAD'], { cwd: dir })
  return r.stdout.trim()
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memon-git-history-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('readGitBranches', () => {
  it('lists local branches and identifies the current one', async () => {
    await initRepoWithCommit(root)
    await git(root, ['checkout', '-b', 'feature/x'])
    await git(root, ['commit', '--allow-empty', '-m', 'on feature'])
    await git(root, ['checkout', 'main'])

    const r = await readGitBranches(root)
    if (!r.enabled) throw new Error(`expected enabled; got ${JSON.stringify(r)}`)
    expect(r.current).toBe('main')
    expect(r.detached).toBe(false)
    const names = r.branches.map((b) => b.name).sort()
    expect(names).toEqual(['feature/x', 'main'])
    const main = r.branches.find((b) => b.name === 'main')!
    expect(main.isCurrent).toBe(true)
    expect(main.sha).toMatch(/^[0-9a-f]{7,}$/)
    expect(r.branches.find((b) => b.name === 'feature/x')!.isCurrent).toBe(false)
  })

  it('flags detached HEAD', async () => {
    await initRepoWithCommit(root)
    await writeFile(join(root, 'a.txt'), 'a\n', 'utf8')
    await git(root, ['add', 'a.txt'])
    await git(root, ['commit', '-m', 'second'])
    const sha = await headSha(root)
    await git(root, ['checkout', '--detach', sha])

    const r = await readGitBranches(root)
    if (!r.enabled) throw new Error('expected enabled')
    expect(r.detached).toBe(true)
    expect(r.current).toBeNull()
    expect(r.sha).toMatch(/^[0-9a-f]{7}$/)
  })

  it('returns enabled:false / not-a-repo for non-repo cwd', async () => {
    const isolated = await mkdtemp(join(tmpdir(), 'memon-nogit-'))
    try {
      const r = await readGitBranches(isolated)
      expect(r).toEqual({ enabled: false, reason: 'not-a-repo' })
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })
})

describe('readGitLog', () => {
  it('returns commits newest-first', async () => {
    await initRepoWithCommit(root)
    for (const msg of ['a', 'b', 'c']) {
      await writeFile(join(root, `${msg}.txt`), 'x\n', 'utf8')
      await git(root, ['add', `${msg}.txt`])
      await git(root, ['commit', '-m', msg])
    }

    const r = await readGitLog(root, { ref: 'main', limit: 100 })
    if (!r.enabled) throw new Error('expected enabled')
    // initial + a + b + c = 4 commits
    expect(r.commits).toHaveLength(4)
    expect(r.commits[0]!.subject).toBe('c')
    expect(r.commits[1]!.subject).toBe('b')
    expect(r.commits[2]!.subject).toBe('a')
    expect(r.commits[3]!.subject).toBe('initial')
    // Sanity: each commit has the expected metadata fields.
    expect(r.commits[0]!.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(r.commits[0]!.shortSha).toMatch(/^[0-9a-f]{7}$/)
    expect(r.commits[0]!.authorName).toBe('Test')
    expect(r.commits[0]!.authorEmail).toBe('test@example.com')
    expect(r.commits[0]!.authorDate).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(r.commits[0]!.parents).toHaveLength(1)
    expect(r.commits[3]!.parents).toHaveLength(0) // root commit
  })

  it('caps at limit', async () => {
    await initRepoWithCommit(root)
    for (let i = 0; i < 5; i += 1) {
      await git(root, ['commit', '--allow-empty', '-m', `c${i}`])
    }
    const r = await readGitLog(root, { ref: 'main', limit: 3 })
    if (!r.enabled) throw new Error('expected enabled')
    expect(r.commits).toHaveLength(3)
  })

  it('returns enabled:false on unknown ref', async () => {
    await initRepoWithCommit(root)
    const r = await readGitLog(root, { ref: 'no-such-branch', limit: 10 })
    expect(r.enabled).toBe(false)
  })
})

describe('readGitCommit', () => {
  it('returns metadata + file list for a normal commit', async () => {
    await initRepoWithCommit(root)
    await writeFile(join(root, 'a.txt'), 'a\n', 'utf8')
    await writeFile(join(root, 'b.txt'), 'b\n', 'utf8')
    await git(root, ['add', '.'])
    await git(root, ['commit', '-m', 'two files'])
    const sha = await headSha(root)

    const r = await readGitCommit(root, sha)
    if (!r.enabled) throw new Error('expected enabled')
    expect(r.sha).toBe(sha)
    expect(r.shortSha).toBe(sha.slice(0, 7))
    expect(r.subject).toBe('two files')
    expect(r.parents).toHaveLength(1)
    expect(r.files.map((f) => f.path).sort()).toEqual(['a.txt', 'b.txt'])
    expect(r.files.every((f) => f.status === 'added')).toBe(true)
  })

  it('returns parents:[] for the root commit (all files = added)', async () => {
    await initRepoWithCommit(root)
    // Commit a real file as the first non-empty commit.
    await writeFile(join(root, 'a.txt'), 'a\n', 'utf8')
    await git(root, ['add', 'a.txt'])
    await git(root, ['commit', '-m', 'first real'])
    // Get the root commit (which was the initial `--allow-empty`).
    const rootSha = (
      await execFileP('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: root })
    ).stdout.trim()

    const r = await readGitCommit(root, rootSha)
    if (!r.enabled) throw new Error('expected enabled')
    expect(r.parents).toEqual([])
    // The initial `--allow-empty` commit has no files.
    expect(r.files).toEqual([])
  })

  it('surfaces renamed files with origPath', async () => {
    await initRepoWithCommit(root)
    await writeFile(join(root, 'old.ts'), 'x\n', 'utf8')
    await git(root, ['add', 'old.ts'])
    await git(root, ['commit', '-m', 'add old'])
    // Rename + commit. Use `git mv` so the index records a rename.
    await git(root, ['mv', 'old.ts', 'new.ts'])
    await git(root, ['commit', '-m', 'rename'])
    const sha = await headSha(root)

    const r = await readGitCommit(root, sha)
    if (!r.enabled) throw new Error('expected enabled')
    expect(r.files).toHaveLength(1)
    expect(r.files[0]).toEqual({
      path: 'new.ts',
      origPath: 'old.ts',
      status: 'renamed',
    })
  })

  it('returns enabled:false / not-found for an unknown SHA', async () => {
    await initRepoWithCommit(root)
    const r = await readGitCommit(root, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
    expect(r).toEqual({ enabled: false, reason: 'not-found' })
  })
})

describe('parseDiffTreeNameStatus — pure parser', () => {
  it('parses A/M/D/R/C/T lines', () => {
    const stdout = [
      'abc1234567890abcdef', // leading commit SHA — should be ignored
      'A\tadded.txt',
      'M\tmodified.txt',
      'D\tdeleted.txt',
      'T\ttypechange.txt',
      'R100\told.txt\tnew.txt',
      'C90\tsource.txt\tcopy.txt',
      '',
    ].join('\n')
    const r = parseDiffTreeNameStatus(stdout)
    expect(r).toEqual([
      { path: 'added.txt', status: 'added' },
      { path: 'modified.txt', status: 'modified' },
      { path: 'deleted.txt', status: 'deleted' },
      { path: 'typechange.txt', status: 'typechange' },
      { path: 'new.txt', origPath: 'old.txt', status: 'renamed' },
      { path: 'copy.txt', origPath: 'source.txt', status: 'copied' },
    ])
  })
})
