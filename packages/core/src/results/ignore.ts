// Ignored result files: the `git check-ignore` probe and the smallest allow
// rules that make every declared Run's `result.csv` trackable.
//
// One function computes the rules for both the reviewed v8 -> v9 migration
// (which appends them) and the `RESULT_FILE_IGNORED` warning of commands that
// create a result file (which only prints them). Nothing here writes a file.
//
// For each ignored result file the deciding rule `<ignore file>:<line>:<pattern>`
// picks the target: that ignore file when it is a `.gitignore` inside the
// project, else the project root `.gitignore` (rules from `.git/info/exclude`,
// `core.excludesFile` or a `.gitignore` above the root lose to it). Rules are
// written per Run location (`logs/*`), anchored and relative to the target's
// directory:
//
//   no directory on the way excluded     !/logs/*/result.csv
//   directory `logs/` excluded           !/logs/   /logs/*   !/logs/*/   /logs/*/*   !/logs/*/result.csv
//
// Git cannot re-include a file below an excluded directory, so the second
// form re-includes only the directories leading to `result.csv` and keeps
// everything else beneath them ignored.
//
// Run paths are probed by their real path: `git check-ignore` aborts on a
// path that goes through a symbolic link, so a declared Run that is (or lies
// below) a symlink is resolved first. A target inside the project is probed
// and covered at its real location; a target outside the project root is
// reported in `outside` and never probed.

import { spawn } from 'node:child_process'
import { promises as nodeFs } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { matchesRunDirPatterns } from '../discovery/run-dirs.js'
import { type ResultsDiagnostic, resultsDiagnostic } from './diagnostics.js'
import { RESULT_FILE_NAME } from './result-file.js'

export const RESULT_FILE_IGNORED = 'RESULT_FILE_IGNORED'
export const RESULT_ALLOW_RULES_COMMENT = '# memon: track per-Run result files (FS v9)'

/** One `git check-ignore --verbose --non-matching` answer. */
export interface IgnoreDecision {
  /** The probed path as given (project-relative). */
  path: string
  /** Excluded by a non-negated pattern. */
  ignored: boolean
  /** Absolute path of the ignore file holding the matching pattern, or null. */
  source: string | null
  line: number | null
  pattern: string | null
}

export type CheckIgnore = (
  projectRoot: string,
  paths: readonly string[],
) => Promise<IgnoreDecision[]>

const GIT_TIMEOUT_MS = 60_000

function runGit(
  cwd: string,
  args: readonly string[],
  input?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', [...args], { cwd, windowsHide: true })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timer = setTimeout(() => child.kill('SIGKILL'), GIT_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(input ?? '')
  })
}

/** The Git work tree root containing `projectRoot` (real path), or null outside Git. */
export async function gitWorkTreeRoot(projectRoot: string): Promise<string | null> {
  try {
    const result = await runGit(projectRoot, ['rev-parse', '--show-toplevel'])
    if (result.code !== 0) return null
    const top = result.stdout.trim()
    return top ? await nodeFs.realpath(top) : null
  } catch {
    return null
  }
}

/** `git check-ignore --no-index --verbose --non-matching -z --stdin` over `paths`. */
export async function gitCheckIgnore(
  projectRoot: string,
  paths: readonly string[],
): Promise<IgnoreDecision[]> {
  if (paths.length === 0) return []
  const top = await gitWorkTreeRoot(projectRoot)
  if (top === null) throw new Error(`${projectRoot} is not inside a Git work tree`)
  const result = await runGit(
    projectRoot,
    ['check-ignore', '--no-index', '--verbose', '--non-matching', '-z', '--stdin'],
    `${paths.join('\u0000')}\u0000`,
  )
  if (result.code !== 0 && result.code !== 1)
    throw new Error(`git check-ignore failed: ${result.stderr.trim() || `exit ${result.code}`}`)
  const fields = result.stdout.split('\u0000')
  const decisions: IgnoreDecision[] = []
  for (let index = 0; index + 3 < fields.length; index += 4) {
    const [source, line, pattern, path] = fields.slice(index, index + 4) as [
      string,
      string,
      string,
      string,
    ]
    const matched = source !== ''
    decisions.push({
      path,
      ignored: matched && !pattern.startsWith('!'),
      source: matched ? (isAbsolute(source) ? source : join(top, source)) : null,
      line: matched ? Number(line) : null,
      pattern: matched ? pattern : null,
    })
  }
  return decisions
}

/** `<ignore file>:<line>:<pattern>` with the file relative to the project when inside it. */
export function formatIgnoreRule(projectRoot: string, decision: IgnoreDecision): string {
  if (decision.source === null) return ''
  const inside = relative(projectRoot, decision.source)
  const file =
    inside && !inside.startsWith('..') && !isAbsolute(inside)
      ? inside.split(sep).join('/')
      : decision.source
  return `${file}:${decision.line}:${decision.pattern}`
}

/** The Run location (`run_dirs` pattern) of a Run path, else its literal parent with `/*`. */
export function runLocationOf(run: string, runDirs: readonly string[] = []): string {
  const pattern = runDirs.find((candidate) => matchesRunDirPatterns(run, [candidate]))
  if (pattern !== undefined) return pattern
  const parent = run.split('/').slice(0, -1).join('/')
  return parent ? `${parent}/*` : '*'
}

/** Where a declared, project-relative Run path really points. */
export type RunRealPath =
  /** `real` is the project-relative real path (equal to `run` without symlinks). */
  | { kind: 'inside'; run: string; real: string }
  /** The real path leaves the project root (or cannot be resolved). */
  | { kind: 'outside'; run: string; target: string }
  | { kind: 'missing'; run: string }

/**
 * Resolve a project-relative Run path through every symbolic link on its way.
 * `projectRoot` must already be a real path.
 */
export async function resolveRunRealPath(projectRoot: string, run: string): Promise<RunRealPath> {
  let real: string
  try {
    real = await nodeFs.realpath(join(projectRoot, ...run.split('/')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing', run }
    return { kind: 'outside', run, target: `(unresolvable: ${(error as Error).message})` }
  }
  const inside = relative(projectRoot, real)
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside))
    return { kind: 'outside', run, target: real }
  return { kind: 'inside', run, real: inside.split(sep).join('/') }
}

export interface IgnoredResultFile {
  /** Project-relative Run directory (its real path). */
  run: string
  /** Declared Run paths that resolve to `run` through a symbolic link. */
  declaredAs?: string[]
  /** Project-relative result file. */
  file: string
  /** Deciding rule `<ignore file>:<line>:<pattern>`. */
  rule: string
  /** Shallowest excluded directory on the way (project-relative), or null. */
  excludedDirectory: string | null
  location: string
  /** Project-relative ignore file the allow rules go to. */
  target: string
}

export interface AllowRuleTarget {
  /** Project-relative ignore file (created when absent). */
  file: string
  /** Lines to append, the comment line first. */
  lines: string[]
  /** Deciding rules the appended lines override. */
  overrides: string[]
  /** Run locations the rules cover. */
  locations: string[]
  /** Run directories whose result files the rules re-include. */
  runs: string[]
  /** Copyable shell command appending `lines` to `file` (run from the project root). */
  command: string
}

export interface ResultAllowRulePlan {
  /** Project root (real path). */
  projectRoot: string
  /** Git work tree root (real path). */
  workTree: string
  ignored: IgnoredResultFile[]
  targets: AllowRuleTarget[]
  /** Declared Runs whose real path leaves the project root (never probed). */
  outside: { run: string; target: string }[]
}

export interface PlanResultAllowRulesInput {
  projectRoot: string
  /** Project-relative Run directories (declared members). */
  runs: readonly string[]
  /** Effective `run_dirs` patterns (default: the literal parent of each Run). */
  runDirs?: readonly string[]
  checkIgnore?: CheckIgnore
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** The append command for `lines` and a project-relative ignore file. */
export function allowRulesCommand(file: string, lines: readonly string[]): string {
  return `printf '%s\\n' ${lines.map(shellQuote).join(' ')} >> ${shellQuote(file)}`
}

interface LadderRule {
  depth: number
  kind: 'include-dir' | 'exclude-contents' | 'file'
  text: string
}

function ladder(location: string[], excludedDepth: number | null): LadderRule[] {
  const rules: LadderRule[] = []
  const file = [...location, RESULT_FILE_NAME].join('/')
  if (excludedDepth !== null) {
    for (let depth = excludedDepth; depth <= location.length; depth += 1) {
      const prefix = location.slice(0, depth).join('/')
      rules.push({ depth, kind: 'include-dir', text: `!/${prefix}/` })
      rules.push({ depth, kind: 'exclude-contents', text: `/${prefix}/*` })
    }
  }
  rules.push({ depth: Number.POSITIVE_INFINITY, kind: 'file', text: `!/${file}` })
  return rules
}

/**
 * Order merged ladders so no later rule undoes an earlier re-inclusion: by
 * depth, re-included directories before the exclusion of their contents,
 * file re-inclusions last. Duplicates are dropped.
 */
function orderRules(rules: readonly LadderRule[]): string[] {
  const rank = { 'include-dir': 0, 'exclude-contents': 1, file: 2 } as const
  const sorted = [...rules].sort(
    (left, right) => left.depth - right.depth || rank[left.kind] - rank[right.kind],
  )
  return [...new Set(sorted.map((rule) => rule.text))]
}

async function isDirectory(path: string): Promise<boolean> {
  return nodeFs.stat(path).then(
    (stat) => stat.isDirectory(),
    () => false,
  )
}

/**
 * Probe every Run's `result.csv` and the directories leading to it, and
 * compute the allow rules per target ignore file. Null outside a Git work
 * tree (no check is made there). Missing Run directories are skipped.
 */
export async function planResultAllowRules(
  input: PlanResultAllowRulesInput,
): Promise<ResultAllowRulePlan | null> {
  const projectRoot = await nodeFs.realpath(input.projectRoot)
  const workTree = await gitWorkTreeRoot(projectRoot)
  if (workTree === null) return null
  const checkIgnore = input.checkIgnore ?? gitCheckIgnore
  const runs: string[] = []
  const aliases = new Map<string, string[]>()
  const outside: { run: string; target: string }[] = []
  for (const run of [...new Set(input.runs)].sort()) {
    const resolved = await resolveRunRealPath(projectRoot, run)
    if (resolved.kind === 'missing') continue
    if (resolved.kind === 'outside') {
      outside.push({ run, target: resolved.target })
      continue
    }
    if (!(await isDirectory(join(projectRoot, ...resolved.real.split('/'))))) continue
    if (!aliases.has(resolved.real)) {
      aliases.set(resolved.real, [])
      runs.push(resolved.real)
    }
    if (resolved.real !== run) aliases.get(resolved.real)!.push(run)
  }
  runs.sort()
  const probes = new Set<string>()
  for (const run of runs) {
    const segments = run.split('/')
    for (let depth = 1; depth <= segments.length; depth += 1)
      probes.add(segments.slice(0, depth).join('/'))
    probes.add(`${run}/${RESULT_FILE_NAME}`)
  }
  const decisions = new Map<string, IgnoreDecision>()
  const list = [...probes]
  for (let index = 0; index < list.length; index += 512)
    for (const decision of await checkIgnore(projectRoot, list.slice(index, index + 512)))
      decisions.set(decision.path, decision)

  const ignored: IgnoredResultFile[] = []
  const byTarget = new Map<
    string,
    { rules: LadderRule[]; overrides: Set<string>; locations: Set<string>; runs: Set<string> }
  >()
  for (const run of runs) {
    const file = `${run}/${RESULT_FILE_NAME}`
    const decision = decisions.get(file)
    if (!decision?.ignored || decision.source === null) continue
    const segments = run.split('/')
    let excluded: number | null = null
    for (let depth = 1; depth <= segments.length; depth += 1) {
      if (decisions.get(segments.slice(0, depth).join('/'))?.ignored) {
        excluded = depth
        break
      }
    }
    const sourceInside = relative(projectRoot, decision.source)
    const targetAbs =
      basename(decision.source) === '.gitignore' &&
      sourceInside !== '' &&
      !sourceInside.startsWith('..') &&
      !isAbsolute(sourceInside)
        ? decision.source
        : join(projectRoot, '.gitignore')
    const target = relative(projectRoot, targetAbs).split(sep).join('/')
    const targetDirDepth = target.split('/').length - 1
    const location = runLocationOf(run, input.runDirs)
    const locationSegments = location.split('/')
    const relativeLocation = locationSegments.slice(
      Math.min(targetDirDepth, locationSegments.length),
    )
    const relativeExcluded = excluded === null ? null : Math.max(1, excluded - targetDirDepth)
    const rules = ladder(
      relativeLocation,
      relativeExcluded !== null && relativeExcluded <= relativeLocation.length
        ? relativeExcluded
        : null,
    )
    const rule = formatIgnoreRule(projectRoot, decision)
    const declaredAs = aliases.get(run) ?? []
    ignored.push({
      run,
      ...(declaredAs.length > 0 ? { declaredAs } : {}),
      file,
      rule,
      excludedDirectory: excluded === null ? null : segments.slice(0, excluded).join('/'),
      location,
      target,
    })
    const entry = byTarget.get(target) ?? {
      rules: [],
      overrides: new Set<string>(),
      locations: new Set<string>(),
      runs: new Set<string>(),
    }
    entry.rules.push(...rules)
    entry.overrides.add(rule)
    entry.locations.add(location)
    entry.runs.add(run)
    byTarget.set(target, entry)
  }
  const targets: AllowRuleTarget[] = [...byTarget.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([file, entry]) => {
      const lines = [RESULT_ALLOW_RULES_COMMENT, ...orderRules(entry.rules)]
      return {
        file,
        lines,
        overrides: [...entry.overrides].sort(),
        locations: [...entry.locations].sort(),
        runs: [...entry.runs].sort(),
        command: allowRulesCommand(file, lines),
      }
    })
  return { projectRoot, workTree, ignored, targets, outside }
}

/**
 * The `RESULT_FILE_IGNORED` warning for one Run's result file, or null when
 * the file is not ignored or the project is outside a Git work tree.
 */
export async function resultFileIgnoredWarning(input: {
  projectRoot: string
  /** Project-relative Run directory. */
  run: string
  runDirs?: readonly string[]
  checkIgnore?: CheckIgnore
}): Promise<(ResultsDiagnostic & { details: ResultFileIgnoredDetails }) | null> {
  const plan = await planResultAllowRules({
    projectRoot: input.projectRoot,
    runs: [input.run],
    ...(input.runDirs ? { runDirs: input.runDirs } : {}),
    ...(input.checkIgnore ? { checkIgnore: input.checkIgnore } : {}),
  })
  const ignored = plan?.ignored[0]
  const target = plan?.targets[0]
  if (!ignored || !target) return null
  return {
    ...resultsDiagnostic(
      RESULT_FILE_IGNORED,
      'warning',
      ignored.file,
      `${ignored.file} is ignored by ${ignored.rule}; it is written but Git will not track it. To track per-Run result files at ${ignored.location}, append the allow rules to ${target.file} and commit: ${target.command}`,
    ),
    details: {
      file: ignored.file,
      rule: ignored.rule,
      target: target.file,
      lines: target.lines,
      command: target.command,
    },
  }
}

export interface ResultFileIgnoredDetails {
  file: string
  rule: string
  target: string
  lines: string[]
  command: string
}

/** Project-relative directory of a project-relative ignore file (`''` for the root). */
export function ignoreFileDirectory(file: string): string {
  const directory = dirname(file)
  return directory === '.' ? '' : directory
}

/** Resolve a project-relative ignore file against the root. */
export function resolveIgnoreFile(projectRoot: string, file: string): string {
  return resolve(projectRoot, ...file.split('/'))
}
