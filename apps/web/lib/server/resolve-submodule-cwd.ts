// Shared helper: given a project root + an optional `submodule` query
// param, resolve the effective cwd for git-side readers.
//
// - Missing / empty submodule → cwd = projectRoot (main repo).
// - Present submodule name → look up in `.gitmodules` via
//   `readGitSubmodules`; if it matches, resolve cwd to
//   `<projectRoot>/<submodule.path>`. Unknown name → 400 response
//   shape.
//
// Routes shape an error response from `{ ok: false, status, message }`
// uniformly via `NextResponse.json({ error: { message } }, { status })`.

import 'server-only'

import { readGitSubmodules } from '@memon/core'
import { resolve } from '@memon/file-protocol/paths'

export interface ResolveSubmoduleOk {
  ok: true
  cwd: string
  /** Resolved submodule name (empty string for main repo). */
  submodule: string
}

export interface ResolveSubmoduleFail {
  ok: false
  status: number
  message: string
}

export type ResolveSubmoduleResult = ResolveSubmoduleOk | ResolveSubmoduleFail

export async function resolveSubmoduleCwd(
  projectRoot: string,
  submodule: string | null | undefined,
): Promise<ResolveSubmoduleResult> {
  if (!submodule) {
    return { ok: true, cwd: projectRoot, submodule: '' }
  }

  const subs = await readGitSubmodules(projectRoot)
  if (!subs.enabled) {
    // The project itself isn't a git repo / git missing / etc. Surface
    // as a 400 because the caller asked for a submodule but the project
    // can't enumerate any.
    return {
      ok: false,
      status: 400,
      message: `cannot resolve submodule "${submodule}": ${subs.reason}`,
    }
  }
  const entry = subs.submodules.find((s) => s.name === submodule)
  if (!entry) {
    return {
      ok: false,
      status: 400,
      message: `unknown submodule "${submodule}"`,
    }
  }
  return {
    ok: true,
    cwd: resolve(projectRoot, entry.path),
    submodule: entry.name,
  }
}
