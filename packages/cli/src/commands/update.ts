// `memon update` — pull the configured trusted upstream into this installation's
// source checkout and reinstall the CLI plus the managed bundled skills.
//
// Scope is deliberately narrow, because this runs on user machines that have no
// central connection and no service to supervise:
//
//   * The trust anchor is the checkout's own git remote configuration. The
//     command never accepts a URL; `--remote` may only name a remote that is
//     already configured in the checkout.
//   * The pull is fast-forward only. A dirty tree or a diverged branch is an
//     actionable refusal — user work is never reset, stashed, or merged away.
//   * Only CLI-side work runs: dependency install, `@memon/core` +
//     `@memon/cli` builds, and the existing `install-skills` installer. No Web
//     build, no unit tests, no lint/typecheck suites, no service startup, and
//     no central revision comparison.
//   * If dependency install, build, or the new binary's self-check fails, the
//     previous revision and the previously built `dist/` trees are restored, so
//     the node keeps a usable `memon`.
//
// Managed-skill refresh runs through the freshly built CLI (`install-skills`),
// which is the single place that knows the managed `memon-*` boundary; skills
// authored outside that boundary are preserved by that command, not by this one.

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emitHuman, emitJson, type OutputFormat } from '../lib/output.js'

export interface UpdateOptions {
  cwd: string
  format: OutputFormat
  /** Source checkout to update; defaults to the checkout this CLI runs from. */
  source?: string
  /** Configured remote name (never a URL). Defaults to the branch's upstream. */
  remote?: string
  /** Upstream branch name. Defaults to the branch's configured merge ref. */
  branch?: string
  /** Project roots whose managed `memon-*` skills get refreshed. */
  skillsRoots: readonly string[]
  /** `--no-skills` turns the managed-skill refresh off entirely. */
  skills: boolean
  /** Report what a real run would do; performs no mutation. */
  dryRun: boolean
}

export type UpdateStepName =
  | 'preflight'
  | 'fetch'
  | 'fast-forward'
  | 'dependencies'
  | 'build'
  | 'verify'
  | 'skills'
  | 'rollback'

export interface UpdateStep {
  step: UpdateStepName
  outcome: 'ok' | 'skipped' | 'failed'
  detail?: string
}

export type UpdateOutcome =
  | 'updated'
  | 'up_to_date'
  | 'dry_run'
  /** Safe stop before any mutation: dirty tree, divergence, missing upstream. */
  | 'refused'
  /** A post-merge failure was undone; the previous installation is usable. */
  | 'rolled_back'
  /** Something failed and could not be undone automatically. */
  | 'failed'

export interface UpdateSkillsReport {
  projectRoot: string
  outcome: 'ok' | 'failed'
  report?: unknown
  detail?: string
}

export interface UpdateResult {
  outcome: UpdateOutcome
  /** Stable machine reason for `refused` / `failed` / `rolled_back`. */
  reason?: string
  message?: string
  source: string | null
  upstream: { remote: string; branch: string; url: string } | null
  branch: string | null
  previousRevision: string | null
  selectedRevision: string | null
  /** `memon --version` of the installation left in place. */
  installedRelease: string | null
  untrackedFiles: number
  /**
   * Retained copy of the previous build, set only when automatic restoration
   * failed and the installation needs manual repair.
   */
  backup: string | null
  steps: UpdateStep[]
  skills: UpdateSkillsReport[]
}

interface CommandResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

const MAX_DETAIL = 2000

function tail(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > MAX_DETAIL ? `…${trimmed.slice(-MAX_DETAIL)}` : trimmed
}

/**
 * Child environment without the npm/pnpm lifecycle variables of the current
 * process: `memon update` may itself be launched through a package script, and
 * inherited `npm_config_*` would silently redirect the nested pnpm run.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('npm_') || key === 'NODE_OPTIONS') continue
    env[key] = value
  }
  return env
}

// Every command of this flow — the git preflight, the fetch, the fast-forward
// and the rollback — runs uncached, and deliberately so: `updateInstallation`
// moves the checkout's own HEAD, and a refusal ("dirty source", "divergent
// history") or a rollback decided from a *saved* observation could discard the
// user's local work. It also needs `childEnv()` per invocation, which the
// shared git seam does not carry. Nothing else in this one-shot process reads
// git, so there is no cached observation left behind for it to invalidate.
//
// `Promise.withResolvers` is ES2024; this workspace compiles against
// `lib: ES2022`, so the executor form is the available construction here.
function run(command: string, args: readonly string[], cwd: string): Promise<CommandResult> {
  return new Promise<CommandResult>((settle) => {
    const child = spawn(command, [...args], {
      cwd,
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      settle({ ok: false, code: null, stdout, stderr: `${stderr}${error.message}` })
    })
    child.on('close', (code) => {
      settle({ ok: code === 0, code, stdout, stderr })
    })
  })
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate)
    return true
  } catch {
    return false
  }
}

/**
 * Locate the workspace checkout that hosts this CLI: walk up from the running
 * module, then from `cwd`, looking for a checkout that carries both the pnpm
 * workspace marker and `packages/cli`.
 */
async function findSourceCheckout(cwd: string): Promise<string | null> {
  const starts = [dirname(fileURLToPath(import.meta.url)), resolve(cwd)]
  for (const start of starts) {
    let dir = start
    while (true) {
      if (
        (await pathExists(join(dir, 'pnpm-workspace.yaml'))) &&
        (await pathExists(join(dir, 'packages', 'cli', 'package.json')))
      ) {
        return dir
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return null
}

const DIST_PATHS = [join('packages', 'core', 'dist'), join('packages', 'cli', 'dist')] as const

/**
 * Only the CLI's own dependency closure is installed: `@memon/cli` plus the
 * workspace packages it depends on. The Web app's dependencies are not part of
 * a CLI node's installation and must not be fetched or linked there.
 */
const DEPENDENCY_INSTALL_ARGS = [
  'install',
  '--frozen-lockfile',
  '--filter',
  '@memon/cli...',
] as const

function emptyResult(): UpdateResult {
  return {
    outcome: 'failed',
    source: null,
    upstream: null,
    branch: null,
    previousRevision: null,
    selectedRevision: null,
    installedRelease: null,
    untrackedFiles: 0,
    backup: null,
    steps: [],
    skills: [],
  }
}

function refuse(result: UpdateResult, reason: string, message: string): UpdateResult {
  result.outcome = 'refused'
  result.reason = reason
  result.message = message
  result.steps.push({ step: 'preflight', outcome: 'failed', detail: message })
  return result
}

function fail(
  result: UpdateResult,
  step: UpdateStepName,
  reason: string,
  message: string,
): UpdateResult {
  result.outcome = 'failed'
  result.reason = reason
  result.message = message
  result.steps.push({ step, outcome: 'failed', detail: message })
  return result
}

/** Run the update and return its structured result; never throws for expected refusals. */
export async function updateInstallation(options: UpdateOptions): Promise<UpdateResult> {
  const result = emptyResult()

  // ---------- preflight ----------
  const sourceInput = options.source
    ? resolve(options.cwd, options.source)
    : await findSourceCheckout(options.cwd)
  if (!sourceInput) {
    return refuse(
      result,
      'no_source_checkout',
      'cannot locate the memon source checkout; pass --source <path>',
    )
  }
  if (
    !(await pathExists(join(sourceInput, 'pnpm-workspace.yaml'))) ||
    !(await pathExists(join(sourceInput, 'packages', 'cli', 'package.json')))
  ) {
    return refuse(
      result,
      'not_a_source_checkout',
      `${sourceInput} is not a memon source checkout (needs pnpm-workspace.yaml and packages/cli)`,
    )
  }

  const topLevel = await run('git', ['rev-parse', '--show-toplevel'], sourceInput)
  if (!topLevel.ok) {
    return refuse(
      result,
      'not_a_git_source',
      `${sourceInput} is not a git checkout; memon update needs the published git source`,
    )
  }
  const source = topLevel.stdout.trim()
  result.source = source

  const head = await run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], source)
  if (!head.ok) {
    return refuse(
      result,
      'detached_head',
      `${source} has a detached HEAD; check out the published branch before updating`,
    )
  }
  const branch = head.stdout.trim()
  result.branch = branch

  const status = await run('git', ['status', '--porcelain=v1', '--untracked-files=normal'], source)
  if (!status.ok) {
    return refuse(result, 'git_status_failed', tail(status.stderr) || 'git status failed')
  }
  const statusLines = status.stdout.split('\n').filter((line) => line.trim().length > 0)
  const untracked = statusLines.filter((line) => line.startsWith('??'))
  const modified = statusLines.filter((line) => !line.startsWith('??'))
  result.untrackedFiles = untracked.length
  if (modified.length > 0) {
    const sample = modified.slice(0, 10).join('; ')
    return refuse(
      result,
      'dirty_source',
      `${source} has ${modified.length} uncommitted tracked change(s); memon update never resets or stashes local work: ${sample}`,
    )
  }

  let remote = options.remote
  let upstreamBranch = options.branch
  if (remote && /:\/\/|@|^\.{0,2}\//.test(remote)) {
    return refuse(
      result,
      'untrusted_remote',
      '--remote takes a remote name configured in the checkout, not a URL or path',
    )
  }
  if (!remote || !upstreamBranch) {
    const configuredRemote = await run(
      'git',
      ['config', '--get', `branch.${branch}.remote`],
      source,
    )
    const configuredMerge = await run('git', ['config', '--get', `branch.${branch}.merge`], source)
    if (!configuredRemote.ok || !configuredMerge.ok) {
      return refuse(
        result,
        'no_upstream',
        `branch ${branch} has no configured upstream in ${source}; configure the trusted publication remote or pass --remote/--branch`,
      )
    }
    remote = remote ?? configuredRemote.stdout.trim()
    upstreamBranch =
      upstreamBranch ?? (configuredMerge.stdout.trim().replace(/^refs\/heads\//, '') || branch)
  }

  const remoteUrl = await run('git', ['remote', 'get-url', remote], source)
  if (!remoteUrl.ok) {
    return refuse(
      result,
      'unknown_remote',
      `remote ${remote} is not configured in ${source}; memon update only pulls from a configured trusted remote`,
    )
  }
  result.upstream = { remote, branch: upstreamBranch, url: remoteUrl.stdout.trim() }

  const previous = await run('git', ['rev-parse', 'HEAD'], source)
  if (!previous.ok) {
    return refuse(result, 'git_head_failed', tail(previous.stderr) || 'git rev-parse HEAD failed')
  }
  result.previousRevision = previous.stdout.trim()
  result.steps.push({
    step: 'preflight',
    outcome: 'ok',
    detail: `clean checkout at ${result.previousRevision.slice(0, 12)} on ${branch} (${untracked.length} untracked path(s) preserved)`,
  })

  // ---------- fetch ----------
  const fetched = await run('git', ['fetch', '--quiet', remote, upstreamBranch], source)
  if (!fetched.ok) {
    return fail(
      result,
      'fetch',
      'fetch_failed',
      tail(fetched.stderr) || `git fetch ${remote} ${upstreamBranch} failed`,
    )
  }
  const target = await run('git', ['rev-parse', 'FETCH_HEAD'], source)
  if (!target.ok) {
    return fail(result, 'fetch', 'fetch_failed', tail(target.stderr) || 'FETCH_HEAD is unreadable')
  }
  result.selectedRevision = target.stdout.trim()
  result.steps.push({
    step: 'fetch',
    outcome: 'ok',
    detail: `${remote}/${upstreamBranch} at ${result.selectedRevision.slice(0, 12)}`,
  })

  const alreadyCurrent = result.selectedRevision === result.previousRevision
  if (!alreadyCurrent) {
    const ancestor = await run(
      'git',
      ['merge-base', '--is-ancestor', result.previousRevision, result.selectedRevision],
      source,
    )
    if (!ancestor.ok) {
      result.outcome = 'refused'
      result.reason = 'divergent'
      result.message = `local ${branch} has commits that ${remote}/${upstreamBranch} does not contain; memon update is fast-forward only and will not rewrite local history`
      result.steps.push({ step: 'fast-forward', outcome: 'failed', detail: result.message })
      return result
    }
  }

  const cliEntry = join(source, 'packages', 'cli', 'dist', 'index.js')
  const builtCliPresent = await pathExists(cliEntry)
  const installNeeded = !alreadyCurrent || !builtCliPresent

  if (options.dryRun) {
    result.outcome = 'dry_run'
    result.message = alreadyCurrent
      ? `already at ${remote}/${upstreamBranch}`
      : `would fast-forward ${result.previousRevision.slice(0, 12)} → ${result.selectedRevision.slice(0, 12)} and reinstall CLI${options.skills ? ' + managed skills' : ''}`
    for (const step of ['fast-forward', 'dependencies', 'build', 'verify', 'skills'] as const) {
      result.steps.push({ step, outcome: 'skipped', detail: 'dry run' })
    }
    return result
  }

  // ---------- fast-forward + install (rollback-protected) ----------
  if (!installNeeded) {
    for (const step of ['fast-forward', 'dependencies', 'build', 'verify'] as const) {
      result.steps.push({ step, outcome: 'skipped', detail: 'already at the selected revision' })
    }
    result.outcome = 'up_to_date'
  } else {
    const backupDir = await fs.mkdtemp(join(tmpdir(), 'memon-update-backup-'))
    const backups: Array<{ relative: string; backup: string }> = []
    for (const relative of DIST_PATHS) {
      const absolute = join(source, relative)
      if (!(await pathExists(absolute))) continue
      const backup = join(backupDir, relative.replaceAll(/[\\/]/g, '__'))
      await fs.cp(absolute, backup, { recursive: true })
      backups.push({ relative, backup })
    }
    /** Set once pnpm has been allowed to change node_modules. */
    let dependenciesTouched = false

    // The rollback must never become a second way to lose work. It touches
    // git only while HEAD is still exactly the revision this run
    // fast-forwarded to, and it moves the ref with `reset --keep`, which
    // aborts rather than overwrite a file edited while pnpm/tsc were running.
    // Dependencies are reinstalled against the restored lockfile, because a
    // node_modules tree left from the newer revision is not the previous
    // installation.
    const restore = async (): Promise<string[]> => {
      const problems: string[] = []
      const current = await run('git', ['rev-parse', 'HEAD'], source)
      if (!current.ok) {
        problems.push(`cannot read HEAD to verify a safe rollback: ${tail(current.stderr)}`)
        return problems
      }
      if (current.stdout.trim() !== result.selectedRevision) {
        problems.push(
          `HEAD is ${current.stdout.trim().slice(0, 12)}, not the ${(result.selectedRevision as string).slice(0, 12)} this run installed; leaving the checkout untouched`,
        )
        return problems
      }
      const reset = await run('git', ['reset', '--keep', result.previousRevision as string], source)
      if (!reset.ok) {
        problems.push(
          `git reset --keep to ${(result.previousRevision as string).slice(0, 12)} refused, so nothing was moved (local changes would have been discarded): ${tail(reset.stderr)}`,
        )
        return problems
      }
      for (const entry of backups) {
        const absolute = join(source, entry.relative)
        try {
          await fs.rm(absolute, { recursive: true, force: true })
          await fs.cp(entry.backup, absolute, { recursive: true })
        } catch (error) {
          problems.push(`restoring ${entry.relative} failed: ${(error as Error).message}`)
        }
      }
      if (dependenciesTouched) {
        const reinstalled = await run('pnpm', DEPENDENCY_INSTALL_ARGS, source)
        if (!reinstalled.ok) {
          problems.push(
            `reinstalling the previous revision's dependencies failed: ${tail(reinstalled.stderr) || tail(reinstalled.stdout)}`,
          )
        }
      }
      if (problems.length === 0) {
        const restored = await readInstalledRelease(cliEntry, source)
        if (restored === null) {
          problems.push('the restored memon binary does not run')
        } else {
          result.installedRelease = restored
        }
      }
      return problems
    }

    const rollback = async (
      step: UpdateStepName,
      reason: string,
      message: string,
    ): Promise<UpdateResult> => {
      result.steps.push({ step, outcome: 'failed', detail: message })
      const problems = await restore()
      if (problems.length > 0) {
        result.outcome = 'failed'
        result.reason = 'rollback_failed'
        result.backup = backupDir
        result.message = `${message} — the previous installation could not be restored automatically and this installation needs manual repair: ${problems.join('; ')}. The previous build is kept at ${backupDir}`
        result.steps.push({ step: 'rollback', outcome: 'failed', detail: problems.join('; ') })
        return result
      }
      result.outcome = 'rolled_back'
      result.reason = reason
      result.message = message
      result.steps.push({
        step: 'rollback',
        outcome: 'ok',
        detail: `restored ${(result.previousRevision as string).slice(0, 12)}, its dependencies and its built CLI`,
      })
      await fs.rm(backupDir, { recursive: true, force: true })
      return result
    }

    if (!alreadyCurrent) {
      const merged = await run('git', ['merge', '--ff-only', result.selectedRevision], source)
      if (!merged.ok) {
        // Nothing moved: the previous revision and its build are untouched.
        return fail(
          result,
          'fast-forward',
          'fast_forward_failed',
          tail(merged.stderr) || 'git merge --ff-only failed',
        )
      }
      result.steps.push({
        step: 'fast-forward',
        outcome: 'ok',
        detail: `${(result.previousRevision as string).slice(0, 12)} → ${result.selectedRevision.slice(0, 12)}`,
      })
    } else {
      result.steps.push({
        step: 'fast-forward',
        outcome: 'skipped',
        detail: 'already at the selected revision; rebuilding the missing CLI',
      })
    }

    dependenciesTouched = true
    const dependencies = await run('pnpm', DEPENDENCY_INSTALL_ARGS, source)
    if (!dependencies.ok) {
      return rollback(
        'dependencies',
        'dependencies_failed',
        tail(dependencies.stderr) || tail(dependencies.stdout) || 'pnpm install failed',
      )
    }
    result.steps.push({
      step: 'dependencies',
      outcome: 'ok',
      detail: 'installed the @memon/cli dependency closure only (no Web dependencies)',
    })

    for (const pkg of ['@memon/core', '@memon/cli'] as const) {
      const built = await run('pnpm', ['--filter', pkg, 'build'], source)
      if (!built.ok) {
        return rollback(
          'build',
          'build_failed',
          `${pkg} build failed: ${tail(built.stderr) || tail(built.stdout)}`,
        )
      }
    }
    result.steps.push({ step: 'build', outcome: 'ok', detail: 'built @memon/core and @memon/cli' })

    const version = await run(process.execPath, [cliEntry, '--version'], source)
    if (!version.ok) {
      return rollback(
        'verify',
        'verify_failed',
        `the newly built memon binary does not run: ${tail(version.stderr) || tail(version.stdout)}`,
      )
    }
    result.installedRelease = version.stdout.trim() || null
    result.steps.push({
      step: 'verify',
      outcome: 'ok',
      detail: `memon ${result.installedRelease ?? 'unknown'} runs from the new build`,
    })
    result.outcome = 'updated'
    await fs.rm(backupDir, { recursive: true, force: true })
  }

  if (result.installedRelease === null) {
    result.installedRelease = await readInstalledRelease(cliEntry, source)
  }

  // ---------- managed skills ----------
  if (!options.skills) {
    result.steps.push({ step: 'skills', outcome: 'skipped', detail: '--no-skills' })
    return result
  }
  const roots = options.skillsRoots.map((root) => resolve(options.cwd, root))
  const targets = roots.length > 0 ? roots : [resolve(options.cwd)]
  let skillsFailed = false
  for (const projectRoot of targets) {
    const installed = await run(
      process.execPath,
      [cliEntry, '--format', 'json', 'install-skills', '--project-root', projectRoot],
      source,
    )
    if (!installed.ok) {
      skillsFailed = true
      result.skills.push({
        projectRoot,
        outcome: 'failed',
        detail: tail(installed.stderr) || tail(installed.stdout) || 'install-skills failed',
      })
      continue
    }
    let report: unknown
    try {
      report = JSON.parse(installed.stdout)
    } catch {
      report = undefined
    }
    result.skills.push({
      projectRoot,
      outcome: 'ok',
      ...(report === undefined ? { detail: tail(installed.stdout) } : { report }),
    })
  }
  result.steps.push({
    step: 'skills',
    outcome: skillsFailed ? 'failed' : 'ok',
    detail: `${targets.length} project root(s) refreshed through install-skills`,
  })
  return result
}

async function readInstalledRelease(cliEntry: string, cwd: string): Promise<string | null> {
  if (!(await pathExists(cliEntry))) return null
  const version = await run(process.execPath, [cliEntry, '--version'], cwd)
  return version.ok ? version.stdout.trim() || null : null
}

/** True when the caller should exit non-zero. */
export function updateFailed(result: UpdateResult): boolean {
  if (
    result.outcome === 'refused' ||
    result.outcome === 'failed' ||
    result.outcome === 'rolled_back'
  ) {
    return true
  }
  return result.steps.some((step) => step.outcome === 'failed')
}

export async function runUpdate(options: UpdateOptions): Promise<UpdateResult> {
  const result = await updateInstallation(options)
  if (options.format === 'json') {
    emitJson(result)
    return result
  }
  emitHuman(`memon update: ${result.outcome}${result.message ? ` — ${result.message}` : ''}`)
  if (result.source) emitHuman(`  source    ${result.source}`)
  if (result.upstream) {
    emitHuman(`  upstream  ${result.upstream.remote}/${result.upstream.branch}`)
  }
  if (result.previousRevision) {
    emitHuman(
      `  revision  ${result.previousRevision.slice(0, 12)} → ${(result.selectedRevision ?? result.previousRevision).slice(0, 12)}`,
    )
  }
  if (result.installedRelease) emitHuman(`  installed memon ${result.installedRelease}`)
  if (result.backup) emitHuman(`  previous build kept at ${result.backup}`)
  for (const step of result.steps) {
    emitHuman(`  ${step.outcome.padEnd(7)} ${step.step}${step.detail ? ` — ${step.detail}` : ''}`)
  }
  for (const skill of result.skills) {
    emitHuman(
      `  skills    ${skill.outcome} ${skill.projectRoot}${skill.detail ? ` — ${skill.detail}` : ''}`,
    )
  }
  return result
}
