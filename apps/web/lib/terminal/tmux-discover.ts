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

export interface TmuxPaneInfo {
  /** PTY-protocol window title (OSC-set by the foreground program). */
  title: string | null
  /** Basename of the foreground process. */
  currentCommand: string | null
  /** Absolute cwd of the foreground process. */
  currentPath: string | null
}

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
  /** Active-pane info from `tmux list-panes -a`. Null when tmux didn't
   *  surface a usable active pane (daemon down, race, etc). */
  pane: TmuxPaneInfo | null
}

const FORMAT = '#{session_name}|#{session_created}|#{session_activity}'

// `pane_title` is LAST so embedded `|` in the title doesn't break the parser;
// we rejoin tokens past position 6 to reconstruct titles verbatim. See spec
// "Server-side pane-info enrichment with bounded shell-out cost".
const PANE_FORMAT =
  '#{session_name}|#{window_active}|#{pane_active}|#{pane_pid}|#{pane_current_command}|#{pane_current_path}|#{pane_title}'
const PANE_TITLE_MAX_LEN = 256
const PANE_CACHE_TTL_MS = 800

export async function listMemonTmuxSessions(rt: Runtime): Promise<TmuxSessionRow[]> {
  let stdout: string
  try {
    stdout = await execTmux(['ls', '-F', FORMAT])
  } catch {
    // tmux daemon not running or no sessions: classify as empty
    return []
  }

  const paneMap = await getActivePaneMapCached()

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
      pane: paneMap.get(name) ?? null,
    })
  }

  rows.sort((a, b) => parseTime(b.tmuxLastActivity) - parseTime(a.tmuxLastActivity))
  return rows
}

/**
 * Enriched single-row lookup by sessionName. Returns the matching
 * `TmuxSessionRow` from `listMemonTmuxSessions` output, or null if the host
 * has no tmux session by that name. Uses the same pane-cache as the bulk
 * listing so concurrent calls in the same 800 ms window share one shell-out.
 */
export async function getEnrichedSession(
  rt: Runtime,
  name: string,
): Promise<TmuxSessionRow | null> {
  const rows = await listMemonTmuxSessions(rt)
  return rows.find((r) => r.sessionName === name) ?? null
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
  if (parsed.scope === 'exp') {
    const expFound = Array.from(rt.experiments.values()).some(
      (e) => e.project === project.name && e.id === parsed.slug,
    )
    return expFound
      ? { matchable: true, staleReason: null }
      : { matchable: false, staleReason: 'unknown-target' }
  }
  // project scope — slug is the contract sentinel ('root'); matchability
  // depends only on project-in-config (already verified above), so always
  // matchable when we reach here.
  return { matchable: true, staleReason: null }
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

// ---------- Active-pane enrichment ----------
//
// Bulk pane data is fetched once per refresh from `tmux list-panes -a` and
// cached for PANE_CACHE_TTL_MS so concurrent callers (the list endpoint plus
// future per-button polls) collapse to one shell-out. The cache slot is
// pinned on globalThis to survive Next.js HMR — mirrors the pattern in
// `manager.ts`'s `getState()`.

const PANE_CACHE_GLOBAL_KEY = '__memonTmuxPaneCache' as const
interface PaneCacheSlot {
  at: number
  map: Map<string, TmuxPaneInfo>
  inflight: Promise<Map<string, TmuxPaneInfo>> | null
}
function getPaneCacheSlot(): { value: PaneCacheSlot | null; set: (v: PaneCacheSlot | null) => void } {
  const holder = globalThis as unknown as { [PANE_CACHE_GLOBAL_KEY]?: PaneCacheSlot | null }
  return {
    value: holder[PANE_CACHE_GLOBAL_KEY] ?? null,
    set: (v) => {
      holder[PANE_CACHE_GLOBAL_KEY] = v
    },
  }
}

export async function getActivePaneMapCached(): Promise<Map<string, TmuxPaneInfo>> {
  const slot = getPaneCacheSlot()
  const now = Date.now()
  const cur = slot.value
  if (cur && now - cur.at < PANE_CACHE_TTL_MS) return cur.map
  if (cur && cur.inflight) return cur.inflight

  const inflight = fetchActivePaneMap()
  // Mark inflight on the existing slot so concurrent calls share it; the
  // first caller will replace the slot once the fetch resolves.
  slot.set({
    at: cur?.at ?? 0,
    map: cur?.map ?? new Map(),
    inflight,
  })
  try {
    const map = await inflight
    slot.set({ at: Date.now(), map, inflight: null })
    return map
  } catch {
    // Any failure → fall back to an empty map and clear inflight so the next
    // call retries. We do NOT keep a stale cached map past TTL on error;
    // returning empty is safer than serving stale data marked fresh.
    slot.set({ at: Date.now(), map: new Map(), inflight: null })
    return new Map()
  }
}

async function fetchActivePaneMap(): Promise<Map<string, TmuxPaneInfo>> {
  let stdout: string
  try {
    stdout = await execTmux(['list-panes', '-a', '-F', PANE_FORMAT])
  } catch {
    // Daemon down, no panes, exec error — all surface as empty pane info.
    return new Map()
  }
  const out = new Map<string, TmuxPaneInfo>()
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trimEnd()
    if (!line) continue
    // Split into the 6 fixed fields + the title tail. We expect 7 segments
    // but title may itself contain `|`, so we limit splits to 6 and rejoin
    // the remainder.
    const segments = line.split('|')
    if (segments.length < 7) continue
    const sessionName = segments[0]!
    const windowActive = segments[1]!
    const paneActive = segments[2]!
    // segments[3] is pane_pid — unused on the public shape but kept in the
    // format string for future incident-debugging.
    const currentCommand = segments[4] ?? ''
    const currentPath = segments[5] ?? ''
    const titleRaw = segments.slice(6).join('|')
    if (windowActive !== '1' || paneActive !== '1') continue
    if (!sessionName) continue
    out.set(sessionName, {
      title: normalizeTitle(titleRaw),
      currentCommand: currentCommand.length > 0 ? currentCommand : null,
      currentPath: currentPath.length > 0 ? currentPath : null,
    })
  }
  return out
}

function normalizeTitle(raw: string): string | null {
  if (raw.length === 0) return null
  // Replace embedded newlines / carriage returns with a single space.
  const collapsed = raw.replace(/[\r\n]+/g, ' ')
  if (collapsed.length <= PANE_TITLE_MAX_LEN) return collapsed
  return collapsed.slice(0, PANE_TITLE_MAX_LEN) + '…'
}

/** Test-only: clear the pane-info cache so unit tests get deterministic
 *  shell-out counts. */
export function __resetPaneCacheForTests(): void {
  const slot = getPaneCacheSlot()
  slot.set(null)
}
