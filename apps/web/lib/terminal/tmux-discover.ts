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

export type StaleReason = 'unknown-project' | 'unknown-target' | 'old-format' | 'unparseable'

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
  if (parsed.legacy) return { matchable: false, staleReason: 'old-format' }
  if (!parsed.project || !parsed.scope || !parsed.slug || !parsed.agent) {
    return { matchable: false, staleReason: 'unparseable' }
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
