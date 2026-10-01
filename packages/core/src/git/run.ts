// One `runGit` for the git readers: run a command through a (cached)
// `GitCommandRunner` and translate the result into the ok / failure shape
// the readers' classifiers branch on.

import {
  type GitCommandRunner,
  gitCommandStdoutText,
  isGitCommandFailure,
  toGitExecFailure,
} from './command.js'

export interface GitExecOk {
  ok: true
  stdout: string
  stderr: string
}

export interface GitExecFail {
  ok: false
  err: { code?: string | number; killed?: boolean; message: string }
  stderr: string
}

export async function runGit(
  exec: GitCommandRunner,
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  maxBuffer: number,
): Promise<GitExecOk | GitExecFail> {
  const result = await exec(bin, args, { cwd, timeoutMs, maxBuffer })
  if (isGitCommandFailure(result)) {
    return { ok: false, ...toGitExecFailure(result) }
  }
  return { ok: true, stdout: gitCommandStdoutText(result), stderr: result.stderr }
}
