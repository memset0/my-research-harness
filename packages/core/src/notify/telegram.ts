// Telegram Bot API render + escape helpers for `memon notify`.
//
// Pure, side-effect-free. The CLI handler wraps these with the
// `fetch` call and config-resolution glue.

export type NotifySeverity = 'info' | 'warn' | 'error' | 'question' | 'done'

export const NOTIFY_SEVERITIES: readonly NotifySeverity[] = [
  'info',
  'warn',
  'error',
  'question',
  'done',
] as const

export interface SeverityMeta {
  emoji: string
  tag: string
}

/**
 * Severity → emoji + uppercase tag. Stable contract: agent skills
 * key behavior off these emojis/tags, so adding / removing /
 * renaming an entry is a breaking change.
 *
 * The `tag` is preserved on the API but is NOT rendered in the
 * outgoing message header (the emoji alone fronts the bold title);
 * skills may still consume it for log lines or internal routing.
 */
export const SEVERITY_META: Record<NotifySeverity, SeverityMeta> = {
  info: { emoji: 'ℹ️', tag: 'INFO' },
  warn: { emoji: '⚠️', tag: 'WARN' },
  error: { emoji: '🔥', tag: 'ERROR' },
  question: { emoji: '❓', tag: 'QUESTION' },
  done: { emoji: '✅', tag: 'DONE' },
}

/**
 * Footer-field emoji prefixes. Each line in the auto-context footer
 * renders as `\- <emoji> <value>` (dash bullet escaped for MarkdownV2,
 * literal bullet in HTML), keyed off this map. Stable contract: agent
 * skills may scan messages for these emojis to extract fields.
 */
export const FOOTER_EMOJI = {
  host: '🖥',
  agent: '🤖',
  session: '💬',
  cwd: '📁',
  branch: '🌿',
  ts: '🕐',
} as const

export type FooterField = keyof typeof FOOTER_EMOJI

/**
 * Auto-context keys reserved by the footer renderer. `--context K=V`
 * with K in this set is rejected at the CLI boundary so user-supplied
 * context can't collide with the auto-footer.
 */
export const RESERVED_CONTEXT_KEYS: readonly string[] = [
  'host',
  'agent',
  'session',
  'cwd',
  'branch',
  'ts',
] as const

/** Free-form but bounded agent-kind identifier. */
export const AGENT_KIND_RE = /^[a-z][a-z0-9-]{0,31}$/

export type ParseMode = 'MarkdownV2' | 'HTML'

// MarkdownV2 reserved set per https://core.telegram.org/bots/api#markdownv2-style.
// Backslash escapes every occurrence; order matters only for backslash itself
// (escaped first so subsequent backslashes are not double-escaped).
const MARKDOWN_V2_RESERVED = ['\\', '_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!']

export function escapeMarkdownV2(s: string): string {
  let out = s
  for (const ch of MARKDOWN_V2_RESERVED) {
    out = out.split(ch).join('\\' + ch)
  }
  return out
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeInsideCode(s: string): string {
  // Inside a code entity, only \ and ` need escaping.
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`')
}

function escapeFor(parseMode: ParseMode): (s: string) => string {
  return parseMode === 'MarkdownV2' ? escapeMarkdownV2 : escapeHtml
}

/**
 * Per-parse-mode emitter for the inline-markdown renderer. Each callback
 * receives the RAW inner text and is responsible for escaping it for the
 * target parse mode.
 */
interface DetailsEmitter {
  text: (s: string) => string
  bold: (s: string) => string
  italic: (s: string) => string
  code: (s: string) => string
  pre: (raw: string) => string
  link: (text: string, url: string) => string
}

const MARKDOWN_V2_EMITTER: DetailsEmitter = {
  text: escapeMarkdownV2,
  bold: (s) => `*${escapeMarkdownV2(s)}*`,
  italic: (s) => `_${escapeMarkdownV2(s)}_`,
  code: (s) => '`' + escapeInsideCode(s) + '`',
  // `raw` is everything between the ``` fences (incl. the optional
  // leading language tag line); Telegram parses the lang itself.
  pre: (raw) => '```' + escapeInsideCode(raw) + '```',
  link: (text, url) =>
    `[${escapeMarkdownV2(text)}](${url.replace(/\\/g, '\\\\').replace(/\)/g, '\\)')})`,
}

const HTML_EMITTER: DetailsEmitter = {
  text: escapeHtml,
  bold: (s) => `<b>${escapeHtml(s)}</b>`,
  italic: (s) => `<i>${escapeHtml(s)}</i>`,
  code: (s) => `<code>${escapeHtml(s)}</code>`,
  pre: (raw) => {
    // Strip an optional leading `lang\n` so it doesn't print as text.
    const m = /^([A-Za-z0-9_+-]*)\n([\s\S]*)$/.exec(raw)
    const body = m ? (m[2] ?? '') : raw
    return `<pre>${escapeHtml(body)}</pre>`
  },
  link: (text, url) => `<a href="${url.replace(/"/g, '&quot;')}">${escapeHtml(text)}</a>`,
}

/**
 * Render a `details` body (authored in common markdown) into the target
 * Telegram parse mode. Handles the markdown most agents / users actually
 * write:
 *   - ` ```fenced``` ` code blocks (language tag preserved)
 *   - `` `inline` `` code
 *   - `**bold**` / `__bold__`  → Telegram bold
 *   - `*italic*` / `_italic_`  → Telegram italic
 *   - `[text](url)`            → Telegram link
 *   - everything else is escaped for the target parse mode
 *
 * This bridges the gap between CommonMark (what people type, e.g.
 * `**bold**`) and Telegram MarkdownV2 (which uses single `*` for bold
 * and requires escaping the full reserved set). Without it, `**bold**`
 * would be escaped to a literal `\*\*bold\*\*`.
 *
 * Code regions are escaped with the code-only policy (`\` and `` ` ``)
 * so their backticks aren't mangled — over-escaping there breaks
 * Telegram's code-block parser.
 */
export function renderDetails(s: string, parseMode: ParseMode): string {
  const e = parseMode === 'MarkdownV2' ? MARKDOWN_V2_EMITTER : HTML_EMITTER
  let out = ''
  let i = 0
  while (i < s.length) {
    if (s.startsWith('```', i)) {
      const close = s.indexOf('```', i + 3)
      if (close >= 0) {
        out += e.pre(s.slice(i + 3, close))
        i = close + 3
        continue
      }
    }
    // Process the chunk up to the next fence (or EOS) as inline markdown.
    let nextFence = s.indexOf('```', i)
    if (nextFence < 0) nextFence = s.length
    out += renderInline(s.slice(i, nextFence), e)
    i = nextFence
  }
  return out
}

function renderInline(s: string, e: DetailsEmitter): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]!
    // inline code
    if (c === '`') {
      const close = s.indexOf('`', i + 1)
      if (close > i) {
        out += e.code(s.slice(i + 1, close))
        i = close + 1
        continue
      }
    }
    // bold: ** ** or __ __
    if (s.startsWith('**', i)) {
      const close = s.indexOf('**', i + 2)
      if (close > i + 1) {
        out += e.bold(s.slice(i + 2, close))
        i = close + 2
        continue
      }
    }
    if (s.startsWith('__', i)) {
      const close = s.indexOf('__', i + 2)
      if (close > i + 1) {
        out += e.bold(s.slice(i + 2, close))
        i = close + 2
        continue
      }
    }
    // italic: * * or _ _ (single)
    if (c === '*') {
      const close = s.indexOf('*', i + 1)
      if (close > i) {
        out += e.italic(s.slice(i + 1, close))
        i = close + 1
        continue
      }
    }
    if (c === '_') {
      const close = s.indexOf('_', i + 1)
      if (close > i) {
        out += e.italic(s.slice(i + 1, close))
        i = close + 1
        continue
      }
    }
    // link: [text](url)
    if (c === '[') {
      const m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(s.slice(i))
      if (m) {
        out += e.link(m[1] ?? '', m[2] ?? '')
        i += m[0].length
        continue
      }
    }
    // plain char — escape for the target mode and advance one.
    out += e.text(c)
    i += 1
  }
  return out
}

function bold(text: string, parseMode: ParseMode): string {
  return parseMode === 'MarkdownV2' ? `*${text}*` : `<b>${text}</b>`
}

function link(label: string, url: string, parseMode: ParseMode): string {
  if (parseMode === 'MarkdownV2') {
    // URLs inside Markdown link parens need `)` and `\` escaped only.
    const escapedUrl = url.replace(/\\/g, '\\\\').replace(/\)/g, '\\)')
    return `[${label}](${escapedUrl})`
  }
  // HTML: escape attribute value (we only need to worry about " in href).
  const safeHref = url.replace(/"/g, '&quot;')
  return `<a href="${safeHref}">${label}</a>`
}

export interface AssembleMessageAutoContext {
  host: string
  agent: string
  session?: string
  /** cwd already collapsed: `$HOME` → `~`. */
  cwd: string
  /** Pre-formatted `<branch>@<short-sha>`; omitted when not in a git repo. */
  branch?: string
  /** ISO8601 with timezone offset. */
  ts: string
}

export interface AssembleMessageInput {
  severity: NotifySeverity
  title: string
  details?: string
  /** User-supplied repeatable `--context K=V`. Order preserved. */
  contextKv: ReadonlyArray<readonly [string, string]>
  /** Already validated `https://...`. */
  link?: string
  parseMode: ParseMode
  auto: AssembleMessageAutoContext
}

/** Telegram's documented message-body cap (UTF-16 code units). */
export const TELEGRAM_MESSAGE_CAP = 4096

const TRUNCATED_SUFFIX = '…(truncated)'

/**
 * Build the final outgoing message body. Escapes per `parseMode`,
 * truncates `details` to keep total ≤ TELEGRAM_MESSAGE_CAP UTF-16
 * code units. Title and footer are preserved verbatim — only
 * `details` is allowed to shrink.
 *
 * UTF-16 code-unit counting uses `string.length` (JavaScript strings
 * are UTF-16 internally) — same metric Telegram uses.
 */
export function assembleMessage(input: AssembleMessageInput): string {
  const esc = escapeFor(input.parseMode)
  const meta = SEVERITY_META[input.severity]

  // Header: emoji + bolded title on a single line. No uppercase tag line.
  const headerLine = `${meta.emoji} ${bold(esc(input.title), input.parseMode)}`

  const userKvLines = input.contextKv.map(
    ([k, v]) => `${esc(k)}: ${esc(v)}`,
  )

  // Footer goes inside a Telegram blockquote. Telegram MarkdownV2 has no
  // list syntax — a leading `-` would render as a literal dash, not a
  // bullet. A blockquote groups the auto-context visually instead.
  //   - MarkdownV2: each line prefixed with an UNescaped `>` (the markup);
  //     the value is escaped; the leading emoji is not reserved.
  //   - HTML: the whole block wrapped in <blockquote>…</blockquote>.
  const footerEntries: Array<[string, string]> = []
  footerEntries.push([FOOTER_EMOJI.host, input.auto.host])
  footerEntries.push([FOOTER_EMOJI.agent, input.auto.agent])
  if (input.auto.session !== undefined) {
    footerEntries.push([FOOTER_EMOJI.session, input.auto.session])
  }
  footerEntries.push([FOOTER_EMOJI.cwd, input.auto.cwd])
  if (input.auto.branch !== undefined) {
    footerEntries.push([FOOTER_EMOJI.branch, input.auto.branch])
  }
  footerEntries.push([FOOTER_EMOJI.ts, input.auto.ts])

  const renderFooter = (): string => {
    if (input.parseMode === 'HTML') {
      const lines = footerEntries.map(([em, v]) => `${em} ${escapeHtml(v)}`)
      return `<blockquote>${lines.join('\n')}</blockquote>`
    }
    return footerEntries
      .map(([em, v]) => `>${em} ${escapeMarkdownV2(v)}`)
      .join('\n')
  }

  const buildBody = (details: string | undefined): string => {
    const parts: string[] = []
    parts.push(headerLine)
    if (details !== undefined && details.length > 0) {
      parts.push('')
      // Details are authored in common markdown — render them to the
      // target parse mode (bold/italic/code/links rendered, code-block
      // backticks preserved, everything else escaped).
      parts.push(renderDetails(details, input.parseMode))
    }
    if (userKvLines.length > 0) {
      parts.push('')
      parts.push(...userKvLines)
    }
    if (input.link !== undefined) {
      parts.push('')
      parts.push(link(esc('View'), input.link, input.parseMode))
    }
    parts.push('')
    parts.push(renderFooter())
    return parts.join('\n')
  }

  const body = buildBody(input.details)
  if (body.length <= TELEGRAM_MESSAGE_CAP) return body

  // Over the cap. Try truncating details only — title + footer survive.
  // If details is absent OR even an empty-truncated-details body still
  // exceeds the cap (extreme title / context spam), return the over-cap
  // body and let the CLI surface the failure.
  if (input.details === undefined || input.details.length === 0) return body

  const minBody = buildBody(TRUNCATED_SUFFIX)
  if (minBody.length > TELEGRAM_MESSAGE_CAP) return body

  // Bisect on the unescaped source length of `details` to find the
  // largest prefix whose assembled body fits the cap. Bisect (not
  // arithmetic) because escape can multiply length by up to 2x.
  let lo = 0
  let hi = input.details.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2)
    if (mid > input.details.length) break
    const candidateBody = buildBody(input.details.slice(0, mid) + TRUNCATED_SUFFIX)
    if (candidateBody.length <= TELEGRAM_MESSAGE_CAP) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }

  return buildBody(input.details.slice(0, lo) + TRUNCATED_SUFFIX)
}

/**
 * Replace every occurrence of `token` in `s` with `***`. Used by the
 * CLI before emitting any error string mentioning the Telegram URL or
 * status payload. If `token` is empty, returns `s` unchanged.
 */
export function redactToken(s: string, token: string): string {
  if (!token) return s
  return s.split(token).join('***')
}
