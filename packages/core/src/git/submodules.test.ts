import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readGitSubmodules } from './submodules.js'

const execFileP = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileP('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  })
}

async function initRepo(dir: string): Promise<void> {
  await git(dir, ['init', '--initial-branch=main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Test'])
  await git(dir, ['commit', '--allow-empty', '-m', 'initial'])
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memon-submodules-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('readGitSubmodules', () => {
  it('returns empty list when `.gitmodules` is absent', async () => {
    await initRepo(root)
    const r = await readGitSubmodules(root)
    expect(r).toEqual({ enabled: true, submodules: [] })
  })

  it('parses one submodule whose name equals its path', async () => {
    await initRepo(root)
    await writeFile(
      join(root, '.gitmodules'),
      `[submodule "vendor/foo"]\n\tpath = vendor/foo\n\turl = https://example.com/foo.git\n`,
      'utf8',
    )
    const r = await readGitSubmodules(root)
    if (!r.enabled) throw new Error('expected enabled')
    expect(r.submodules).toEqual([{ name: 'vendor/foo', path: 'vendor/foo' }])
  })

  it('parses multiple submodules in `.gitmodules` declaration order', async () => {
    await initRepo(root)
    await writeFile(
      join(root, '.gitmodules'),
      [
        '[submodule "vendor/foo"]',
        '\tpath = vendor/foo',
        '\turl = https://example.com/foo.git',
        '[submodule "themes/dark"]',
        '\tpath = themes/dark',
        '\turl = https://example.com/dark.git',
        '',
      ].join('\n'),
      'utf8',
    )
    const r = await readGitSubmodules(root)
    if (!r.enabled) throw new Error('expected enabled')
    expect(r.submodules).toEqual([
      { name: 'vendor/foo', path: 'vendor/foo' },
      { name: 'themes/dark', path: 'themes/dark' },
    ])
  })

  it('handles a submodule whose name differs from its path', async () => {
    await initRepo(root)
    await writeFile(
      join(root, '.gitmodules'),
      `[submodule "external-lib"]\n\tpath = vendor/lib\n\turl = https://example.com/lib.git\n`,
      'utf8',
    )
    const r = await readGitSubmodules(root)
    if (!r.enabled) throw new Error('expected enabled')
    expect(r.submodules).toEqual([{ name: 'external-lib', path: 'vendor/lib' }])
  })

  it('returns enabled:false / not-a-repo for a non-repo cwd', async () => {
    const isolated = await mkdtemp(join(tmpdir(), 'memon-nogit-sub-'))
    try {
      const r = await readGitSubmodules(isolated)
      expect(r).toEqual({ enabled: false, reason: 'not-a-repo' })
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })

  it('survives a `.gitmodules` with no submodule entries', async () => {
    await initRepo(root)
    // File exists but contains no `[submodule]` sections — `git config
    // --get-regexp` exits 1 with empty stderr. Treated as "no submodules".
    await writeFile(join(root, '.gitmodules'), '# placeholder\n', 'utf8')
    const r = await readGitSubmodules(root)
    expect(r).toEqual({ enabled: true, submodules: [] })
  })
})
