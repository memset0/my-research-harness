// `memon notify <severity> "<title>"` / `memon notify test` —
// push notifications to a configured Telegram chat via the Bot API.
//
// Credential resolution (per openspec/specs/telegram-notify):
//   1. env MEMON_TELEGRAM_BOT_TOKEN + MEMON_TELEGRAM_CHAT_ID
//   2. config.yml `telegram:` block at --config <path> or cwd config.yml
//   3. BAD_REQUEST

import { promises as fs } from 'node:fs'
import { hostname } from 'node:os'
import { resolve } from 'node:path'
import {
  AgentKindError,
  RESERVED_CONTEXT_KEYS,
  assembleMessage,
  collapseHome,
  detectAgent,
  loadConfig,
  nowIsoLocal,
  NOTIFY_SEVERITIES,
  probeGitBranch,
  redactToken,
} from '@memon/core'
import type { NotifySeverity, TelegramConfig } from '@memon/core'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitHuman, emitJson, type OutputFormat } from '../lib/output.js'
import { readStdin } from './experiment.js'

const TITLE_MAX_LEN = 200
const SESSION_MAX_LEN = 80
const MAX_CONTEXT_ENTRIES = 10
const DEFAULT_TIMEOUT_MS = 10_000
const BRANCH_PROBE_TIMEOUT_MS = 1_000
const BRANCH_PROBE_OUTER_CEILING_MS = 1_500

export interface NotifySendInput {
  severity: string
  title: string
  details?: string
  detailsFile?: string
  context: Array<readonly [string, string]>
  link?: string
  agent?: string
  session?: string
  soft: boolean
  quiet: boolean
  format: OutputFormat
  configPath?: string
  cwd: string
}

export interface NotifyTestInput {
  agent?: string
  session?: string
  format: OutputFormat
  configPath?: string
  cwd: string
}

interface ResolvedCreds extends TelegramConfig {
  source: 'env' | 'config'
}

// ---------- credential resolution ----------

async function resolveCreds(
  configPath: string | undefined,
  cwd: string,
): Promise<ResolvedCreds> {
  const envToken = process.env.MEMON_TELEGRAM_BOT_TOKEN
  const envChat = process.env.MEMON_TELEGRAM_CHAT_ID

  const envTokenSet = envToken !== undefined && envToken !== ''
  const envChatSet = envChat !== undefined && envChat !== ''

  if (envTokenSet && envChatSet) {
    return {
      botToken: envToken,
      chatId: envChat,
      parseMode: 'MarkdownV2',
      disableNotification: false,
      source: 'env',
    }
  }

  if (envTokenSet !== envChatSet) {
    process.stderr.write(
      'memon: only one of MEMON_TELEGRAM_BOT_TOKEN / MEMON_TELEGRAM_CHAT_ID is set; falling back to config.yml\n',
    )
  }

  let cfg
  try {
    cfg = await loadConfig({ explicitPath: configPath, cwd })
  } catch (err) {
    emitErrorAndExit('BAD_REQUEST', (err as Error).message)
  }

  if (cfg && cfg.telegram) {
    return { ...cfg.telegram, source: 'config' }
  }

  emitErrorAndExit(
    'BAD_REQUEST',
    'no Telegram credentials: set MEMON_TELEGRAM_BOT_TOKEN + MEMON_TELEGRAM_CHAT_ID env vars, or add a `telegram:` block (bot_token + chat_id) to config.yml',
  )
}

// ---------- input validation ----------

function validateSeverity(s: string): NotifySeverity {
  if (!(NOTIFY_SEVERITIES as readonly string[]).includes(s)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `unknown severity "${s}"; must be one of: ${NOTIFY_SEVERITIES.join(', ')}`,
    )
  }
  return s as NotifySeverity
}

function validateTitle(t: string): void {
  if (!t || t.length === 0) {
    emitErrorAndExit('BAD_REQUEST', 'title is required and must be non-empty')
  }
  if (t.length > TITLE_MAX_LEN) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `title length ${t.length} exceeds max ${TITLE_MAX_LEN}`,
    )
  }
}

function validateContext(
  ctx: Array<readonly [string, string]>,
): void {
  if (ctx.length > MAX_CONTEXT_ENTRIES) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `--context limited to ${MAX_CONTEXT_ENTRIES} entries; got ${ctx.length}`,
    )
  }
  const reserved = new Set(RESERVED_CONTEXT_KEYS)
  for (const [k] of ctx) {
    if (reserved.has(k)) {
      emitErrorAndExit(
        'BAD_REQUEST',
        `--context key "${k}" is reserved (reserved set: ${[...reserved].sort().join(', ')}); rename your key`,
      )
    }
  }
}

function validateLink(url: string): void {
  if (!url.startsWith('https://')) {
    emitErrorAndExit('BAD_REQUEST', `--link must be https:// (got: ${url})`)
  }
}

function validateSession(s: string): void {
  if (s.length > SESSION_MAX_LEN) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `--session length ${s.length} exceeds max ${SESSION_MAX_LEN}`,
    )
  }
}

function resolveAgent(explicit?: string): string {
  try {
    return detectAgent(process.env, explicit)
  } catch (err) {
    if (err instanceof AgentKindError) emitErrorAndExit('BAD_REQUEST', err.message)
    throw err
  }
}

async function resolveDetails(
  details: string | undefined,
  detailsFile: string | undefined,
): Promise<string | undefined> {
  if (details !== undefined && detailsFile !== undefined) {
    emitErrorAndExit(
      'BAD_REQUEST',
      '--details and --details-file are mutually exclusive',
    )
  }
  if (details !== undefined) return details
  if (detailsFile === undefined) return undefined

  if (detailsFile === '-') {
    const content = await readStdin()
    return content === '' ? undefined : content
  }
  try {
    return await fs.readFile(resolve(detailsFile), 'utf8')
  } catch (err) {
    const errno = err as NodeJS.ErrnoException
    if (errno.code === 'ENOENT') {
      emitErrorAndExit('NOT_FOUND', `--details-file not found: ${detailsFile}`)
    }
    emitErrorAndExit('BAD_REQUEST', `cannot read --details-file: ${errno.message}`)
  }
}

// ---------- telegram POST ----------

interface SendResult {
  ok: boolean
  messageId?: number
  errorEnvelope?: { code: string; message: string }
}

async function postToTelegram(
  creds: ResolvedCreds,
  body: string,
  disableNotification: boolean,
): Promise<SendResult> {
  const timeoutMs = parseTimeoutEnv() ?? DEFAULT_TIMEOUT_MS
  const url = `https://api.telegram.org/bot${creds.botToken}/sendMessage`
  const payload = {
    chat_id: creds.chatId,
    text: body,
    parse_mode: creds.parseMode,
    disable_notification: disableNotification,
  }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal,
    })
    const text = await resp.text()
    if (!resp.ok) {
      // Don't echo the URL (contains the token). Don't echo the raw
      // response if it could quote the token. Telegram's response body
      // does not contain the token in any documented error, but redact
      // defensively.
      const safe = redactToken(text, creds.botToken)
      let msg: string
      if (resp.status === 401) msg = '401 Unauthorized: token rejected'
      else if (resp.status === 400) msg = `400 Bad Request: ${safe.slice(0, 500)}`
      else msg = `telegram HTTP ${resp.status}: ${safe.slice(0, 500)}`
      return { ok: false, errorEnvelope: { code: 'GENERIC', message: msg } }
    }
    let parsed: { result?: { message_id?: number }; ok?: boolean }
    try {
      parsed = JSON.parse(text)
    } catch {
      return {
        ok: false,
        errorEnvelope: {
          code: 'GENERIC',
          message: `telegram returned non-JSON: ${text.slice(0, 200)}`,
        },
      }
    }
    if (!parsed.ok || parsed.result?.message_id === undefined) {
      return {
        ok: false,
        errorEnvelope: {
          code: 'GENERIC',
          message: `telegram returned ok=false: ${text.slice(0, 500)}`,
        },
      }
    }
    return { ok: true, messageId: parsed.result.message_id }
  } catch (err) {
    const e = err as Error & { name?: string }
    let msg: string
    if (e.name === 'AbortError') {
      msg = `telegram POST timed out after ${timeoutMs}ms`
    } else {
      msg = `telegram POST failed: ${redactToken(e.message ?? String(e), creds.botToken)}`
    }
    return { ok: false, errorEnvelope: { code: 'GENERIC', message: msg } }
  } finally {
    clearTimeout(timer)
  }
}

function parseTimeoutEnv(): number | undefined {
  const v = process.env.MEMON_TELEGRAM_TIMEOUT_MS
  if (!v) return undefined
  const n = parseInt(v, 10)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n
}

// ---------- auto-context collection ----------

async function collectAuto(
  agent: string,
  session: string | undefined,
  cwd: string,
): Promise<{ host: string; agent: string; session?: string; cwd: string; branch?: string; ts: string }> {
  const home = process.env.HOME
  const collapsedCwd = collapseHome(cwd, home)

  // Defense-in-depth: race the probe against an outer ceiling.
  const branchPromise = probeGitBranch(cwd, BRANCH_PROBE_TIMEOUT_MS).catch(() => undefined)
  const outerCeiling = new Promise<undefined>((res) =>
    setTimeout(() => res(undefined), BRANCH_PROBE_OUTER_CEILING_MS),
  )
  const branchInfo = await Promise.race([branchPromise, outerCeiling])
  const branch = branchInfo ? `${branchInfo.branch}@${branchInfo.shortSha}` : undefined

  // Build the ts at the LAST moment before assembleMessage / send.
  return {
    host: hostname(),
    agent,
    session,
    cwd: collapsedCwd,
    branch,
    ts: nowIsoLocal(),
  }
}

// ---------- public handlers ----------

export async function runNotifySend(input: NotifySendInput): Promise<void> {
  const severity = validateSeverity(input.severity)
  validateTitle(input.title)
  validateContext(input.context)
  if (input.link !== undefined) validateLink(input.link)
  if (input.session !== undefined) validateSession(input.session)
  const agent = resolveAgent(input.agent)
  const details = await resolveDetails(input.details, input.detailsFile)

  const creds = await resolveCreds(input.configPath, input.cwd)
  const auto = await collectAuto(agent, input.session, input.cwd)
  const body = assembleMessage({
    severity,
    title: input.title,
    details,
    contextKv: input.context,
    link: input.link,
    parseMode: creds.parseMode,
    auto,
  })

  const disableNotification = creds.disableNotification || input.quiet
  const result = await postToTelegram(creds, body, disableNotification)

  if (!result.ok) {
    const env = result.errorEnvelope!
    if (input.soft) {
      process.stderr.write(`${JSON.stringify({ error: env })}\n`)
      // Also surface the would-be-sent severity / title for log triage.
      if (input.format === 'human') {
        emitHuman(`soft: send failed (${env.message})`)
      } else {
        emitJson({
          sent: false,
          severity,
          title: input.title,
          agent,
          session: input.session ?? null,
          error: env,
        })
      }
      return
    }
    emitErrorAndExit(env.code, env.message)
  }

  if (input.format === 'human') {
    emitHuman(`sent → ${creds.chatId} (#${result.messageId})`)
  } else {
    emitJson({
      sent: true,
      severity,
      title: input.title,
      agent,
      session: input.session ?? null,
      telegram_chat_id: creds.chatId,
      telegram_message_id: result.messageId,
    })
  }
}

export async function runNotifyTest(input: NotifyTestInput): Promise<void> {
  if (input.session !== undefined) validateSession(input.session)
  const agent = resolveAgent(input.agent)

  const creds = await resolveCreds(input.configPath, input.cwd)
  const auto = await collectAuto(agent, input.session, input.cwd)
  const body = assembleMessage({
    severity: 'info',
    title: 'memon notify self-test',
    contextKv: [],
    parseMode: creds.parseMode,
    auto,
  })

  // `notify test` ignores --soft: a silent failure here is the worst UX.
  const result = await postToTelegram(creds, body, creds.disableNotification)
  if (!result.ok) {
    const env = result.errorEnvelope!
    emitErrorAndExit(env.code, env.message)
  }

  if (input.format === 'human') {
    emitHuman(`sent → ${creds.chatId} (#${result.messageId}) agent=${agent}`)
  } else {
    emitJson({
      sent: true,
      severity: 'info',
      title: 'memon notify self-test',
      agent,
      session: input.session ?? null,
      telegram_chat_id: creds.chatId,
      telegram_message_id: result.messageId,
    })
  }
}
