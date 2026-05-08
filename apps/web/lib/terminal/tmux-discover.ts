// Host-level inventory of `memon-*` tmux sessions, classified for the
// /manage/tmux page. The manager.ts singleton tracks only sessions with a
// live ttyd; this module shells out to `tmux ls` to see EVERY session on
// the host (including those memon doesn't currently have a ttyd bound to).
//
// Stale classification cross-references the project name + slug against
// the runtime's project list and run / experiment indexes.

import { spawn } from 'node:child_process'
import {
  lookupSession,
  parseSessionName,
  stopSession,
  type ParsedSessionName,
} from './manager'
import type { Runtime } from '../runtime'

// Stale = "this name parses as the standard convention but the project /
// target lookup failed". Legacy and arbitrary user-created names are NOT
// stale — they're the manual category (matchable: false, staleReason: null).
export type StaleReason = 'unknown-project' | 'unknown-target'

export interface TmuxSessionRow {
  sessionName: string
  parsed: ParsedSessionName
  liveEntry: { port: number; lastActiveAt: string } | null
  /** ISO8601, or '' if tmux didn't surface a created time. */
  tmuxCreatedAt: string
  /** ISO8601, or '' if tmux didn't surface activity. */
  tmuxLastActivity: string
  matchable: boolean
  staleReason: StaleReason | null
}

const FORMAT = '#{session_name}|#{session_created}|#{session_activity}'

export async function listMemonTmuxSessions(rt: Runtime): Promise<TmuxSessionRow[]> {
  let stdout: string
  try {
    stdout = await execTmux(['ls', '-F', FORMAT])
  } catch {
    // tmux daemon not running or no sessions: classify as empty
    return []
  }

  const rows: TmuxSessionRow[] = []
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const [name, createdEpoch, activityEpoch] = line.split('|') as [string, string, string]
    if (!name || !name.startsWith('memon-')) continue

    const parsed = parseSessionName(name)
    const live = lookupSession(name)

    const { matchable, staleReason } = classify(parsed, rt)

    rows.push({
      sessionName: name,
      parsed,
      liveEntry: live,
      tmuxCreatedAt: epochToIso(createdEpoch),
      tmuxLastActivity: epochToIso(activityEpoch),
      matchable,
      staleReason,
    })
  }

  rows.sort((a, b) => parseTime(b.tmuxLastActivity) - parseTime(a.tmuxLastActivity))
  return rows
}

function classify(parsed: ParsedSessionName, rt: Runtime): {
  matchable: boolean
  staleReason: StaleReason | null
} {
  // Legacy or arbitrary names → manual category (not stale). The user might
  // have created them via the New session dialog (memon-manual-<name>) or
  // they're holdovers from before tmux-session-rework. Either way, don't
  // flag them as stale just because they don't fit the new convention.
  if (parsed.legacy) return { matchable: false, staleReason: null }
  if (!parsed.project || !parsed.scope || !parsed.slug || !parsed.agent) {
    return { matchable: false, staleReason: null }
  }
  const project = rt.config.projects.find((p) => p.name === parsed.project)
  if (!project) return { matchable: false, staleReason: 'unknown-project' }

  if (parsed.scope === 'run') {
    const runs = rt.index.list({ project: project.name })
    const found = runs.some((r) => r.id === parsed.slug)
    return found ? { matchable: true, staleReason: null } : { matchable: false, staleReason: 'unknown-target' }
  }
  // exp scope
  const expFound = Array.from(rt.experiments.values()).some(
    (e) => e.project === project.name && e.id === parsed.slug,
  )
  return expFound
    ? { matchable: true, staleReason: null }
    : { matchable: false, staleReason: 'unknown-target' }
}

/** Validate the name looks like one of our session-name formats before
 *  passing it to `tmux kill-session`. Refuses anything outside the
 *  `memon-` prefix or with shell-unsafe characters. */
const SAFE_NAME_RE = /^memon-[A-Za-z0-9._-]+$/

export async function killTmuxSessionByName(name: string): Promise<void> {
  if (!SAFE_NAME_RE.test(name)) {
    throw new Error(`refusing to kill unsafe sessionName: ${name}`)
  }
  // Best-effort: also clear any cached manager entry (its ttyd child will
  // exit naturally because the tmux session it's attached to ended).
  await stopSession(name).catch(() => {
    /* ignore — manager may not have an entry */
  })
  await execTmux(['kill-session', '-t', name])
}

/** Prefix the user's typed name with `memon-manual-` to form the full
 *  tmux session name. */
const MANUAL_PREFIX = 'memon-manual-'
const MANUAL_NAME_RE = /^[A-Za-z0-9._-]+$/

export interface CreateManualResult {
  sessionName: string
  alreadyExisted: boolean
}

export async function createManualTmuxSession(input: {
  name: string
  cwd?: string
}): Promise<CreateManualResult> {
  const raw = input.name
  if (!raw) {
    throw new Error('name is required')
  }
  if (!MANUAL_NAME_RE.test(raw)) {
    throw new Error(`name must match ${MANUAL_NAME_RE} (got ${JSON.stringify(raw)})`)
  }
  if (raw.includes('--')) {
    throw new Error("name must not contain '--' (the scope delimiter)")
  }
  if (raw.startsWith('memon-')) {
    throw new Error("name must not start with 'memon-' (the prefix is added automatically)")
  }
  const sessionName = `${MANUAL_PREFIX}${raw}`
  const cwd = input.cwd ?? process.cwd()
  const alreadyExisted = await tmuxHasSession(sessionName)
  if (!alreadyExisted) {
    // Detached create. Note: `new-session -A -d` (which would be the
    // textbook "attach if exists else create detached" form) actually
    // fails when the session exists with "open terminal failed: not a
    // terminal" because the -A path still wants a controlling tty.
    // Splitting into has-session + conditional new-session is robust
    // and side-steps the issue.
    await execTmux(['new-session', '-d', '-s', sessionName, '-c', cwd])
  }
  return { sessionName, alreadyExisted }
}

export async function tmuxHasSession(name: string): Promise<boolean> {
  if (!SAFE_NAME_RE.test(name)) return false
  try {
    await execTmux(['has-session', '-t', name])
    return true
  } catch {
    return false
  }
}

function execTmux(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('tmux', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (b: Buffer) => {
      stdout += b.toString('utf8')
    })
    proc.stderr.on('data', (b: Buffer) => {
      stderr += b.toString('utf8')
    })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`tmux ${args.join(' ')} exited ${code}: ${stderr.trim()}`))
    })
  })
}

function epochToIso(epoch: string | undefined): string {
  if (!epoch) return ''
  const sec = Number(epoch)
  if (!Number.isFinite(sec) || sec === 0) return ''
  return new Date(sec * 1000).toISOString()
}

function parseTime(iso: string): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}
