// Response DTOs: Git status, diff, history and commit-mark bodies (`/api/projects/:project/git-*`,
// `commit-marks`).
// Shared by the route handlers that build these bodies and the client
// fetchers in `lib/api.ts`. Types and pure helpers only — no server imports.

/**
 * Why a Git endpoint answered `enabled: false`. Every Git route shares the
 * backend's disabled-reason enum, so any endpoint may report any of these.
 */
export type GitDisabledReason =
  | 'not-a-repo'
  | 'git-not-found'
  | 'timeout'
  | 'not-found'
  | 'no-gitmodules'
  | 'error'

export type GitStatus =
  | {
      enabled: false
      reason: GitDisabledReason
      message?: string
    }
  | {
      enabled: true
      branch: string | null
      detached: boolean
      sha: string
      upstream: string | null
      ahead: number
      behind: number
      staged: number
      unstaged: number
      untracked: number
      dirty: boolean
    }

export type GitFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflict'
  | 'typechange'

export interface GitFileEntry {
  path: string
  status: GitFileStatus
  origPath?: string
  /**
   * Set when this file is a submodule-pointer bump (a gitlink entry in
   * `git diff-tree --raw` with old mode `160000` and new mode `160000`).
   * Carries the two SHAs the submodule pointer is being changed between,
   * so the UI can expand this row into a `git-range` view of the
   * submodule's actual commits between `fromSha..toSha`.
   */
  submoduleBump?: { fromSha: string; toSha: string }
}

export type GitStatusFiles =
  | {
      enabled: false
      reason: GitDisabledReason
      message?: string
    }
  | {
      enabled: true
      branch: string | null
      detached: boolean
      sha: string
      upstream: string | null
      ahead: number
      behind: number
      staged: GitFileEntry[]
      unstaged: GitFileEntry[]
      untracked: GitFileEntry[]
    }

export type GitDiffSide = 'staged' | 'unstaged' | 'untracked' | 'commit' | 'range'

export type GitDiffResponse =
  | {
      ok: true
      filename: string
      status: GitFileStatus
      oldContent: string | null
      newContent: string | null
    }
  | {
      ok: false
      skipReason: 'too-large'
      sizeBytes: number
      maxBytes: number
      side: 'old' | 'new'
    }
  | { ok: false; skipReason: 'binary' }
  | { ok: false; error: { message: string } }

export type GitRangeResponse =
  | {
      enabled: false
      reason: GitDisabledReason
      message?: string
    }
  | {
      enabled: true
      from: string
      to: string
      commits: GitCommitSummary[]
      files: GitFileEntry[]
      submodule: string
    }

export interface GitBranchEntry {
  name: string
  sha: string
  isCurrent: boolean
}

export type GitBranches =
  | {
      enabled: false
      reason: GitDisabledReason
      message?: string
    }
  | {
      enabled: true
      current: string | null
      detached: boolean
      sha: string
      branches: GitBranchEntry[]
    }

export interface GitCommitSummary {
  sha: string
  shortSha: string
  subject: string
  authorName: string
  authorEmail: string
  authorDate: string
  parents: string[]
}

export type GitLog =
  | {
      enabled: false
      reason: GitDisabledReason
      message?: string
    }
  | { enabled: true; commits: GitCommitSummary[] }

export type GitCommitDetail =
  | {
      enabled: false
      reason: GitDisabledReason
      message?: string
    }
  | {
      enabled: true
      sha: string
      shortSha: string
      subject: string
      body: string
      authorName: string
      authorEmail: string
      authorDate: string
      parents: string[]
      files: GitFileEntry[]
    }

export interface GitSubmoduleEntry {
  name: string
  path: string
}

export type GitSubmodules =
  | {
      enabled: false
      reason: GitDisabledReason
      message?: string
    }
  | { enabled: true; submodules: GitSubmoduleEntry[] }

export type CommitMarkStatus = 'verified' | 'suspicious' | 'issue'

export interface CommitMark {
  sha: string
  status: CommitMarkStatus
  note: string
  updatedAt: string
  /** Empty string = main repo; otherwise the submodule name from `.gitmodules`. */
  submodule: string
}

export interface CommitMarksResponse {
  marks: CommitMark[]
  parseWarnings: string[]
}
