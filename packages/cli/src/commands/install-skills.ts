// memon install-skills — sync bundled SKILL.md trees into a project's per-agent
// skills directories. By default writes to `.claude/skills/`, `.codex/skills/`,
// and `.opencode/skills/` under <projectRoot>; opt out via `--agent <list>`.
// Every `memon-*` directory the current bundle still ships is replaced, so its
// stale files disappear cleanly. Skills not starting with `memon-` are left
// untouched.
//
// A `memon-*` directory the bundle no longer ships is NOT wiped blindly. It is
// deleted only when its name is in `RETIRED_SKILLS` (a bundled name this
// harness intentionally stopped shipping) AND the directory's exact file tree
// matches a deposit this harness released under that name. A retired name whose
// tree was edited, extended, or replaced locally is preserved and reported as
// `kept-modified`; an unrecognized `memon-*` directory is preserved and
// reported as `kept-unmanaged`. Both classifications are computed in `--dry-run`
// too, so an operator can see what a real run would retire before syncing.
//
// After the copy loop, the command optionally offers to symlink
// AGENTS.md → CLAUDE.md so non-Claude agent CLIs pick up the same project
// guidance. Prompt only fires on a TTY in `--format human` non-dry-run runs;
// every other path reports a `skipped-*` action without blocking.

import { createHash } from 'node:crypto'
import { promises as fs, existsSync as fsExistsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  computeFsVersionStatus,
  FS_CONVENTION_VERSION,
  type FsVersionStatus,
  formatIsoLocal,
  readFsVersion,
  writeFsVersion,
} from '@memon/core'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitJson, type OutputFormat } from '../lib/output.js'

export const AGENT_TARGETS = {
  claude: '.claude/skills',
  codex: '.codex/skills',
  opencode: '.opencode/skills',
} as const

export type AgentName = keyof typeof AGENT_TARGETS

const ALL_AGENTS: readonly AgentName[] = ['claude', 'codex', 'opencode']

/**
 * Retirement registry shipped beside the skill dirs in the source tree, read
 * the same way `PREFLIGHT.md` is. Kept as a literal here (not imported) so a
 * hand-curated `MEMON_SKILLS_DIR` only has to carry the file, not a matching
 * build of `@memon/skills`.
 */
export const RETIRED_SKILLS_FILE = 'retired-skills.json'

export interface InstallSkillsInput {
  /** When set, target = `<projectRoot>/<agent-subpath>` for each requested agent. Mutually exclusive with `target`. */
  projectRoot?: string
  /** Direct override; bypasses the projectRoot derivation entirely. Mutually exclusive with `agents`. */
  target?: string
  /** Subset of agents to install for. `undefined` = all agents. Mutually exclusive with `target`. */
  agents?: AgentName[]
  cwd: string
  dryRun?: boolean
  format: OutputFormat
}

/**
 * What happened to a `memon-*` directory whose name the current bundle does
 * not ship:
 * - `retired` — the name is in the retirement registry and the installed tree
 *   is byte-identical to a tree this harness released, so it was deleted
 *   (reported without deleting under `--dry-run`).
 * - `kept-modified` — registered retired name, but the installed tree differs
 *   from every released tree (edited, extended, or replaced locally).
 * - `kept-unmanaged` — the bundle never shipped this name; it is somebody
 *   else's skill living in the same namespace.
 */
export type UnshippedAction = 'retired' | 'kept-modified' | 'kept-unmanaged'

export interface UnshippedDir {
  name: string
  action: UnshippedAction
  /** Tree digest observed on disk; `null` when the directory holds no files. */
  depositDigest: string | null
}

export interface InstalledTarget {
  agent: AgentName | null
  path: string
  /** Bundled skill dirs replaced from source, plus retired dirs deleted. */
  removed: string[]
  installed: string[]
  /** Every `memon-*` dir in the target that the current bundle does not ship. */
  unshipped: UnshippedDir[]
}

export interface RetirementRegistryReport {
  /** Absolute path of the registry read from the resolved source tree. */
  path: string
  /** False when the source tree carries no registry; nothing is then retired. */
  available: boolean
  names: string[]
}

export interface FsVersionReport {
  current: number | null
  available: number
  status: FsVersionStatus
  upgradeRequired: boolean
  /** ISO8601 with offset; non-null iff this run wrote the marker (first install). */
  writtenAt: string | null
}

type AgentsLinkAction =
  | 'none'
  | 'created'
  | 'declined'
  | 'skipped-non-tty'
  | 'skipped-dry-run'
  | 'skipped-no-input'
  | 'failed'

export interface AgentsLinkReport {
  checked: boolean
  claudeMdExists: boolean
  agentsMdExists: boolean
  action: AgentsLinkAction
  error?: string
}

/**
 * Parse the `--agent <list>` raw value into a validated, deduplicated
 * `AgentName[]`. Returns the canonical "all three" list when the input is
 * undefined or the literal `all`. Exits 2 with `BAD_REQUEST` for unknown
 * names or for `all` mixed with explicit names.
 */
export function parseAgentList(raw: string | undefined): AgentName[] {
  if (raw === undefined) return [...ALL_AGENTS]
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (parts.length === 0) {
    emitErrorAndExit(
      'BAD_REQUEST',
      '--agent: empty list; expected one of claude,codex,opencode or "all"',
    )
  }
  const hasAll = parts.includes('all')
  if (hasAll) {
    if (parts.length > 1) {
      emitErrorAndExit('BAD_REQUEST', '--agent: "all" cannot be combined with explicit agent names')
    }
    return [...ALL_AGENTS]
  }
  const seen = new Set<AgentName>()
  for (const part of parts) {
    if (!(part in AGENT_TARGETS)) {
      emitErrorAndExit(
        'BAD_REQUEST',
        `--agent: unknown agent "${part}"; expected one of claude,codex,opencode or "all"`,
      )
    }
    seen.add(part as AgentName)
  }
  // Preserve canonical order so JSON output is deterministic.
  return ALL_AGENTS.filter((a) => seen.has(a))
}

/** Resolve the bundled skills source dir. */
async function resolveSkillsDir(): Promise<string> {
  // 1. Env var override (handy for local hacking)
  const envDir = process.env.MEMON_SKILLS_DIR
  if (envDir && fsExistsSync(envDir)) return envDir

  // 2. Resolved @memon/skills package
  try {
    const mod = (await import('@memon/skills')) as { SKILLS_DIR?: string }
    if (mod.SKILLS_DIR && fsExistsSync(mod.SKILLS_DIR)) return mod.SKILLS_DIR
  } catch {
    /* fall through to dev fallback */
  }

  // 3. Dev fallback: walk up from this compiled file to find packages/skills
  const here = fileURLToPath(import.meta.url)
  const guesses = [
    resolve(here, '..', '..', '..', '..', 'skills'), // packages/cli/dist/commands → packages/skills
    resolve(here, '..', '..', '..', '..', '..', 'skills'),
  ]
  for (const g of guesses) {
    if (fsExistsSync(g)) return g
  }

  emitErrorAndExit(
    'NOT_FOUND',
    'cannot locate @memon/skills bundled directory; reinstall memon or set MEMON_SKILLS_DIR',
  )
}

interface ResolvedTargets {
  /** Where the AGENTS.md prompt looks for CLAUDE.md / AGENTS.md. */
  projectRootForLink: string
  targets: { agent: AgentName | null; path: string }[]
}

function resolveTargets(input: InstallSkillsInput): ResolvedTargets {
  if (input.target && input.projectRoot) {
    emitErrorAndExit('BAD_REQUEST', '--target and --project-root cannot both be set')
  }
  if (input.target && input.agents) {
    emitErrorAndExit('BAD_REQUEST', '--target and --agent cannot both be set')
  }
  if (input.target) {
    return {
      projectRootForLink: resolve(input.cwd),
      targets: [{ agent: null, path: resolve(input.target) }],
    }
  }
  const root = resolve(input.projectRoot ?? input.cwd)
  if (isHarnessCheckout(root)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `${root} is the memon harness checkout: bundled skills live in packages/skills/ and are installed into research projects, never into the harness itself`,
    )
  }
  const agents = input.agents && input.agents.length > 0 ? input.agents : [...ALL_AGENTS]
  return {
    projectRootForLink: root,
    targets: agents.map((agent) => ({ agent, path: join(root, AGENT_TARGETS[agent]) })),
  }
}

/** A memon checkout carries the skill package sources; installing into it would mirror them. */
function isHarnessCheckout(root: string): boolean {
  try {
    const manifest = JSON.parse(
      readFileSync(join(root, 'packages', 'skills', 'package.json'), 'utf8'),
    )
    return manifest?.name === '@memon/skills'
  } catch {
    return false
  }
}

/**
 * Load the retirement registry that ships beside the skill dirs.
 *
 * A source tree without the file is legal (older bundle, hand-curated sync
 * dir): the registry is then empty, so no directory is ever retired and the
 * report says `available: false` instead of pretending the target is clean.
 * A malformed registry is a hard error — silently degrading to "retire
 * nothing" would hide a broken release.
 */
async function loadRetirementRegistry(src: string): Promise<{
  report: RetirementRegistryReport
  deposits: Map<string, Set<string>>
}> {
  const path = join(src, RETIRED_SKILLS_FILE)
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return { report: { path, available: false, names: [] }, deposits: new Map() }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    emitErrorAndExit('BAD_REQUEST', `malformed retirement registry at ${path}: ${String(err)}`)
  }
  if (
    !(parsed && typeof parsed === 'object' && 'retired' in parsed && Array.isArray(parsed.retired))
  ) {
    emitErrorAndExit('BAD_REQUEST', `retirement registry at ${path} has no "retired" array`)
  }
  if (!('schema_version' in parsed) || parsed.schema_version !== 1) {
    emitErrorAndExit('BAD_REQUEST', `unsupported retirement registry schema at ${path}`)
  }
  const deposits = new Map<string, Set<string>>()
  for (const entry of parsed.retired) {
    const named =
      entry && typeof entry === 'object' && 'name' in entry && 'deposit_digests' in entry
    if (
      !named ||
      typeof entry.name !== 'string' ||
      !/^memon-[a-z0-9-]+$/.test(entry.name) ||
      !Array.isArray(entry.deposit_digests) ||
      deposits.has(entry.name)
    ) {
      emitErrorAndExit(
        'BAD_REQUEST',
        `retirement registry at ${path} has an entry without a name and deposit_digests`,
      )
    }
    const digests = new Set<string>()
    for (const digest of entry.deposit_digests) {
      if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
        emitErrorAndExit(
          'BAD_REQUEST',
          `retirement registry at ${path}: ${entry.name} has an invalid deposit digest`,
        )
      }
      digests.add(digest)
    }
    deposits.set(entry.name, digests)
  }
  return {
    report: { path, available: true, names: [...deposits.keys()].sort() },
    deposits,
  }
}

/**
 * Digest of a whole installed skill tree: `sha256` over the path-sorted
 * `<relative path>\0<sha256 of bytes>\n` lines of every file below `dir`.
 * Any edited file, added helper, or removed reference changes the result, so
 * an equal digest means the tree is exactly one this harness released.
 * Returns `null` for a directory that contains no files at all.
 */
export async function computeDepositDigest(dir: string): Promise<string | null> {
  if (!(await fs.lstat(dir)).isDirectory()) return null
  const lines: string[] = []
  const walk = async (current: string): Promise<void> => {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const abs = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(abs)
      } else if (entry.isFile()) {
        const bytes = await fs.readFile(abs)
        const rel = relative(dir, abs).split('\\').join('/')
        lines.push(`${rel}\0${createHash('sha256').update(bytes).digest('hex')}\n`)
      } else {
        // A symlink or device node was never part of a released deposit; mark
        // the tree as foreign so it is preserved rather than deleted.
        lines.push(`${relative(dir, abs).split('\\').join('/')}\0<non-file>\n`)
      }
    }
  }
  await walk(dir)
  if (lines.length === 0) return null
  lines.sort()
  return createHash('sha256').update(lines.join('')).digest('hex')
}

async function classifyUnshipped(
  targetPath: string,
  names: string[],
  deposits: Map<string, Set<string>>,
): Promise<UnshippedDir[]> {
  const out: UnshippedDir[] = []
  for (const name of names) {
    const shipped = deposits.get(name)
    if (!shipped) {
      out.push({ name, action: 'kept-unmanaged', depositDigest: null })
      continue
    }
    const digest = await computeDepositDigest(join(targetPath, name))
    out.push({
      name,
      action: digest !== null && shipped.has(digest) ? 'retired' : 'kept-modified',
      depositDigest: digest,
    })
  }
  return out
}

async function installOne(
  target: { agent: AgentName | null; path: string },
  src: string,
  sourceSkills: string[],
  deposits: Map<string, Set<string>>,
  dryRun: boolean,
): Promise<InstalledTarget> {
  let existingMemonInTarget: string[] = []
  if (await pathExists(target.path)) {
    existingMemonInTarget = (await fs.readdir(target.path, { withFileTypes: true }))
      .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && d.name.startsWith('memon-'))
      .map((d) => d.name)
      .sort()
  }

  const shippedNames = new Set(sourceSkills)
  // Dirs the bundle still ships are replaced wholesale so their stale files go.
  const replaced = existingMemonInTarget.filter((name) => shippedNames.has(name))
  const unshipped = await classifyUnshipped(
    target.path,
    existingMemonInTarget.filter((name) => !shippedNames.has(name)),
    deposits,
  )
  const retired = unshipped.filter((d) => d.action === 'retired').map((d) => d.name)
  const removed = [...replaced, ...retired].sort()
  // installed[]: skill dir basenames + the PREFLIGHT.md sibling.
  const installed = [...sourceSkills, 'PREFLIGHT.md']

  if (!dryRun) {
    await fs.mkdir(target.path, { recursive: true })
    for (const name of removed) {
      await fs.rm(join(target.path, name), { recursive: true, force: true })
    }
    for (const name of sourceSkills) {
      await copyDir(join(src, name), join(target.path, name))
    }
    // Sibling deposit. fs.copyFile overwrites unconditionally; a stale
    // PREFLIGHT.md (not in removed[] under the memon-* replacement scope)
    // is replaced from source on every non-dry-run invocation.
    await fs.copyFile(join(src, 'PREFLIGHT.md'), join(target.path, 'PREFLIGHT.md'))
  }

  return { agent: target.agent, path: target.path, removed, installed, unshipped }
}

export async function runInstallSkills(input: InstallSkillsInput): Promise<void> {
  const resolved = resolveTargets(input)
  const src = await resolveSkillsDir()

  // FS version preflight + first-install marker write. Use --target → null
  // (the user opted out of project-root semantics).
  // Run BEFORE skill copy so an "ahead" project (newer than this memon)
  // aborts cleanly without touching skill files.
  const usesProjectRoot = !input.target
  let fsVersion: FsVersionReport | null = null
  if (usesProjectRoot) {
    fsVersion = await preflightAndMaybeWriteMarker(resolved.projectRootForLink, !!input.dryRun)
  }

  const sourceSkills = (await fs.readdir(src, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && d.name.startsWith('memon-'))
    .map((d) => d.name)
    .sort()

  const registry = await loadRetirementRegistry(src)

  const installed: InstalledTarget[] = []
  for (const target of resolved.targets) {
    installed.push(await installOne(target, src, sourceSkills, registry.deposits, !!input.dryRun))
  }

  const agentsLink = await maybeOfferAgentsLink({
    projectRoot: resolved.projectRootForLink,
    dryRun: !!input.dryRun,
    format: input.format,
  })

  if (input.format === 'human') {
    const lines: string[] = [`source: ${src}`]
    if (!registry.report.available) {
      lines.push(`retirement registry: absent (${RETIRED_SKILLS_FILE} missing) — nothing retired`)
    }
    for (const t of installed) {
      const label = t.agent ? `target [${t.agent}]: ${t.path}` : `target: ${t.path}`
      lines.push(label)
      const replacedCount =
        t.removed.length - t.unshipped.filter((d) => d.action === 'retired').length
      lines.push(`  replaced ${replacedCount} memon-* dir(s); installed ${t.installed.length}`)
      for (const line of formatUnshippedLines(t.unshipped)) lines.push(line)
    }
    lines.push(formatAgentsLinkLine(agentsLink, resolved.projectRootForLink))
    if (fsVersion) lines.push(formatFsVersionLine(fsVersion))
    if (fsVersion?.status === 'behind') {
      // The banner goes to stderr (non-JSON, interactive flag) so JSON output stays clean.
      process.stderr.write(
        `WARNING: Project FS convention is at v${fsVersion.current}; current memon expects v${fsVersion.available}. Run the memon-migrate-fs skill to upgrade.\n`,
      )
    }
    if (input.dryRun) lines.push('(dry run — no files written)')
    process.stdout.write(`${lines.join('\n')}\n`)
  } else {
    emitJson({
      ok: true,
      source: src,
      retirementRegistry: registry.report,
      targets: installed,
      agentsLink,
      fsVersion,
      dryRun: !!input.dryRun,
    })
  }
}

/**
 * One human line per outcome group, so an operator can see before syncing
 * which directories a real run deletes and which ones it deliberately leaves
 * behind for review.
 */
function formatUnshippedLines(unshipped: UnshippedDir[]): string[] {
  const lines: string[] = []
  const group = (action: UnshippedAction): string[] =>
    unshipped.filter((d) => d.action === action).map((d) => d.name)

  const retired = group('retired')
  if (retired.length > 0) lines.push(`  retired ${retired.length}: ${retired.join(', ')}`)
  const modified = group('kept-modified')
  if (modified.length > 0) {
    lines.push(
      `  kept ${modified.length} modified retired dir(s), review manually: ${modified.join(', ')}`,
    )
  }
  const unmanaged = group('kept-unmanaged')
  if (unmanaged.length > 0) {
    lines.push(`  kept ${unmanaged.length} unmanaged memon-* dir(s): ${unmanaged.join(', ')}`)
  }
  return lines
}

/**
 * Inspect `<projectRoot>/.memon/version.json` and either:
 *  - First install: write a fresh marker, return `writtenAt`. (Skipped on dry-run.)
 *  - Match: report only, no write.
 *  - Behind: report only, no write. Caller surfaces the upgrade banner.
 *  - Ahead: emit MEMON_TOO_OLD error and exit 11. The full install is aborted
 *    (no skill copy yet at this point in the flow).
 */
async function preflightAndMaybeWriteMarker(
  projectRoot: string,
  dryRun: boolean,
): Promise<FsVersionReport> {
  const record = await readFsVersion(projectRoot)
  const current = record?.fs_convention_version ?? null
  const available = FS_CONVENTION_VERSION
  const status = computeFsVersionStatus(current, available)

  if (status === 'ahead') {
    emitErrorAndExit(
      'MEMON_TOO_OLD',
      `project FS convention is v${current}; this memon supports up to v${available}. Upgrade memon to a release that supports v${current} or later.`,
    )
  }

  if (status === 'uninitialised' && !dryRun) {
    const installedAt = formatIsoLocal(new Date())
    await writeFsVersion(projectRoot, {
      fs_convention_version: available,
      installed_at: installedAt,
      last_migrated_at: null,
    })
    return {
      current: null,
      available,
      status,
      upgradeRequired: false,
      writtenAt: installedAt,
    }
  }

  return {
    current,
    available,
    status,
    upgradeRequired: status === 'behind',
    writtenAt: null,
  }
}

function formatFsVersionLine(r: FsVersionReport): string {
  switch (r.status) {
    case 'match':
      return `fs-version: v${r.current} (match)`
    case 'behind':
      return `fs-version: v${r.current} → v${r.available} available (run memon-migrate-fs to upgrade)`
    case 'uninitialised':
      return r.writtenAt
        ? `fs-version: initialised at v${r.available} (.memon/version.json written)`
        : `fs-version: would initialise at v${r.available} (dry run)`
    case 'ahead':
      // Unreachable — preflightAndMaybeWriteMarker exits earlier.
      return `fs-version: v${r.current} ahead of tool v${r.available}`
  }
}

interface AgentsLinkInput {
  projectRoot: string
  dryRun: boolean
  format: OutputFormat
}

/**
 * Decide what to do about the AGENTS.md → CLAUDE.md symlink and (if
 * appropriate) prompt the user. Always returns a structured report; never
 * throws — fs failures are captured as `action: "failed"`.
 *
 * Exported for tests.
 */
export async function maybeOfferAgentsLink(input: AgentsLinkInput): Promise<AgentsLinkReport> {
  const claudeMdPath = join(input.projectRoot, 'CLAUDE.md')
  const agentsMdPath = join(input.projectRoot, 'AGENTS.md')

  const agentsMdExists = await lstatExists(agentsMdPath)
  const claudeMdExists = await lstatExists(claudeMdPath)

  // Files are mutually independent: AGENTS.md present at all → leave alone.
  if (agentsMdExists) {
    return { checked: true, claudeMdExists, agentsMdExists: true, action: 'none' }
  }
  if (!claudeMdExists) {
    return { checked: true, claudeMdExists: false, agentsMdExists: false, action: 'none' }
  }

  // CLAUDE.md exists, AGENTS.md doesn't → consider creating the link.
  if (input.dryRun) {
    return {
      checked: true,
      claudeMdExists: true,
      agentsMdExists: false,
      action: 'skipped-dry-run',
    }
  }
  if (input.format === 'json' || !process.stdin.isTTY) {
    return {
      checked: true,
      claudeMdExists: true,
      agentsMdExists: false,
      action: 'skipped-non-tty',
    }
  }

  const accepted = await promptYesNo('是否创建 AGENTS.md → CLAUDE.md 软链接？(y/N) ')
  if (accepted === 'timeout') {
    return {
      checked: true,
      claudeMdExists: true,
      agentsMdExists: false,
      action: 'skipped-no-input',
    }
  }
  if (!accepted) {
    return {
      checked: true,
      claudeMdExists: true,
      agentsMdExists: false,
      action: 'declined',
    }
  }
  try {
    // Relative target so the link survives a project move.
    await fs.symlink('CLAUDE.md', agentsMdPath)
    return { checked: true, claudeMdExists: true, agentsMdExists: false, action: 'created' }
  } catch (err) {
    return {
      checked: true,
      claudeMdExists: true,
      agentsMdExists: false,
      action: 'failed',
      error: (err as Error)?.message ?? String(err),
    }
  }
}

function formatAgentsLinkLine(report: AgentsLinkReport, projectRoot: string): string {
  switch (report.action) {
    case 'created':
      return `AGENTS.md: created symlink → CLAUDE.md (relative; remove if you delete CLAUDE.md) at ${projectRoot}`
    case 'declined':
      return 'AGENTS.md: prompt declined; no symlink created'
    case 'skipped-dry-run':
      return 'AGENTS.md: skipped (dry run)'
    case 'skipped-non-tty':
      return 'AGENTS.md: skipped (non-TTY or --format json)'
    case 'skipped-no-input':
      return 'AGENTS.md: skipped (no input received)'
    case 'failed':
      return `AGENTS.md: symlink failed: ${report.error ?? 'unknown error'}`
    case 'none':
    default:
      if (report.agentsMdExists) return 'AGENTS.md: already present; nothing to do'
      if (!report.claudeMdExists) return 'AGENTS.md: skipped (no CLAUDE.md found)'
      return 'AGENTS.md: nothing to do'
  }
}

/**
 * Read one line from stdin with a 30-second timeout. Resolves to:
 *   - true  for affirmative answers (y/yes, case-insensitive)
 *   - false for any other line (including empty/EOF)
 *   - 'timeout' if no input arrives within the timeout window
 */
async function promptYesNo(question: string): Promise<boolean | 'timeout'> {
  process.stdout.write(question)
  return await new Promise((resolvePrompt) => {
    const stdin = process.stdin
    let buffer = ''
    let settled = false
    const settle = (value: boolean | 'timeout') => {
      if (settled) return
      settled = true
      cleanup()
      resolvePrompt(value)
    }
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString('utf8')
      const newlineIdx = buffer.indexOf('\n')
      if (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).trim().toLowerCase()
        settle(line === 'y' || line === 'yes')
      }
    }
    const onEnd = () => {
      settle(false)
    }
    const onError = () => {
      settle(false)
    }
    const timer = setTimeout(() => settle('timeout'), 30_000)
    function cleanup() {
      clearTimeout(timer)
      stdin.removeListener('data', onData)
      stdin.removeListener('end', onEnd)
      stdin.removeListener('error', onError)
      // Note: we deliberately don't pause stdin — leave it in whatever state
      // the caller had it in. (For a fresh CLI run, that's the default.)
    }
    stdin.on('data', onData)
    stdin.on('end', onEnd)
    stdin.on('error', onError)
  })
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

async function lstatExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p)
    return true
  } catch {
    return false
  }
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true })
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = join(src, entry.name)
    const d = join(dst, entry.name)
    if (entry.isDirectory()) {
      await copyDir(s, d)
    } else {
      await fs.copyFile(s, d)
    }
  }
}
