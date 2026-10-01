import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/** Run git in `cwd` and return its trimmed stdout. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await exec('git', args, { cwd })
  return result.stdout.trim()
}

export interface InitGitRepoOptions {
  branch?: string
  userName?: string
  userEmail?: string
}

/** `git init` with a fixed initial branch and a local commit identity. */
export async function initGitRepo(dir: string, options: InitGitRepoOptions = {}): Promise<void> {
  await git(dir, 'init', '-q', '-b', options.branch ?? 'main')
  await git(dir, 'config', 'user.email', options.userEmail ?? 'test@example.invalid')
  await git(dir, 'config', 'user.name', options.userName ?? 'memon test')
  await git(dir, 'config', 'commit.gpgsign', 'false')
}

/** Stage everything and commit; returns the new HEAD SHA. */
export async function commitAll(dir: string, message: string): Promise<string> {
  await git(dir, 'add', '-A')
  await git(dir, 'commit', '-q', '--allow-empty', '-m', message)
  return git(dir, 'rev-parse', 'HEAD')
}
