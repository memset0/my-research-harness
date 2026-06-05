import { describe, expect, it } from 'vitest'
import {
  AGENT_KIND_RE,
  FOOTER_EMOJI,
  RESERVED_CONTEXT_KEYS,
  SEVERITY_META,
  TELEGRAM_MESSAGE_CAP,
  assembleMessage,
  escapeHtml,
  escapeMarkdownV2,
  renderDetails,
  redactToken,
} from './telegram.js'

const AUTO_MIN = {
  host: 'erdos',
  agent: 'claude',
  cwd: '~/work',
  ts: '2026-05-30T12:00:00+08:00',
}

describe('escapeMarkdownV2', () => {
  it('escapes every reserved character', () => {
    expect(escapeMarkdownV2('_*[]()~`>#+-=|{}.!')).toBe(
      '\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!',
    )
  })

  it('escapes backslash without double-escaping subsequent escapes', () => {
    expect(escapeMarkdownV2('a\\b')).toBe('a\\\\b')
  })

  it('passes plain ascii alphanumerics through unchanged', () => {
    expect(escapeMarkdownV2('Hello world 123')).toBe('Hello world 123')
  })

  it('escapes dot and bang in a typical title', () => {
    expect(escapeMarkdownV2('Hello. World!')).toBe('Hello\\. World\\!')
  })
})

describe('escapeHtml', () => {
  it('escapes &, <, > only', () => {
    expect(escapeHtml('1 < 2 & true')).toBe('1 &lt; 2 &amp; true')
  })

  it('passes other markdownv2-reserved chars through', () => {
    expect(escapeHtml('foo.bar!')).toBe('foo.bar!')
  })
})

describe('SEVERITY_META', () => {
  it('has all five severities with non-empty emoji + tag', () => {
    for (const sev of ['info', 'warn', 'error', 'question', 'done'] as const) {
      expect(SEVERITY_META[sev].emoji.length).toBeGreaterThan(0)
      expect(SEVERITY_META[sev].tag).toMatch(/^[A-Z]+$/)
    }
  })

  it('tags are uppercase versions of severity names', () => {
    expect(SEVERITY_META.info.tag).toBe('INFO')
    expect(SEVERITY_META.warn.tag).toBe('WARN')
    expect(SEVERITY_META.error.tag).toBe('ERROR')
    expect(SEVERITY_META.question.tag).toBe('QUESTION')
    expect(SEVERITY_META.done.tag).toBe('DONE')
  })
})

describe('RESERVED_CONTEXT_KEYS', () => {
  it('matches the documented six-element set', () => {
    expect([...RESERVED_CONTEXT_KEYS].sort()).toEqual(
      ['agent', 'branch', 'cwd', 'host', 'session', 'ts'].sort(),
    )
  })
})

describe('AGENT_KIND_RE', () => {
  it('accepts documented kinds', () => {
    for (const k of ['claude', 'codex', 'opencode', 'unknown', 'my-experimental-shell']) {
      expect(AGENT_KIND_RE.test(k)).toBe(true)
    }
  })

  it('rejects malformed', () => {
    for (const k of ['MyShell!', '', '1claude', '-claude', 'a'.repeat(33), 'foo bar']) {
      expect(AGENT_KIND_RE.test(k)).toBe(false)
    }
  })
})

describe('assembleMessage minimal', () => {
  it('header is emoji + bold title on one line (no uppercase tag)', () => {
    const body = assembleMessage({
      severity: 'info',
      title: 'Hello. World!',
      contextKv: [],
      parseMode: 'MarkdownV2',
      auto: AUTO_MIN,
    })
    // Emoji + bold title on the same line, no separate "INFO" line.
    expect(body).toContain('ℹ️ *Hello\\. World\\!*')
    expect(body).not.toMatch(/\bINFO\b/)
  })

  it('footer renders as a blockquote: > + emoji per line with escapes', () => {
    const body = assembleMessage({
      severity: 'info',
      title: 't',
      contextKv: [],
      parseMode: 'MarkdownV2',
      auto: AUTO_MIN,
    })
    // Each footer line begins with an UNescaped `>` (blockquote markup);
    // the value is escaped; the emoji passes through.
    expect(body).toContain(`>${FOOTER_EMOJI.host} erdos`)
    expect(body).toContain(`>${FOOTER_EMOJI.agent} claude`)
    expect(body).toContain(`>${FOOTER_EMOJI.cwd} \\~/work`)
    expect(body).toContain(`>${FOOTER_EMOJI.ts} 2026\\-05\\-30T12:00:00\\+08:00`)
    expect(body).not.toContain(FOOTER_EMOJI.session) // no session in minimal
    expect(body).not.toContain(FOOTER_EMOJI.branch)
  })

  it('session line appears when provided, between agent and cwd', () => {
    const body = assembleMessage({
      severity: 'info',
      title: 't',
      contextKv: [],
      parseMode: 'MarkdownV2',
      auto: { ...AUTO_MIN, session: 'telegram-notify' },
    })
    const agentIdx = body.indexOf(FOOTER_EMOJI.agent)
    const sessionIdx = body.indexOf(FOOTER_EMOJI.session)
    const cwdIdx = body.indexOf(FOOTER_EMOJI.cwd)
    expect(agentIdx).toBeLessThan(sessionIdx)
    expect(sessionIdx).toBeLessThan(cwdIdx)
    expect(body).toContain(`${FOOTER_EMOJI.session} telegram\\-notify`)
  })

  it('branch line appears when provided, between cwd and ts', () => {
    const body = assembleMessage({
      severity: 'info',
      title: 't',
      contextKv: [],
      parseMode: 'MarkdownV2',
      auto: { ...AUTO_MIN, branch: 'main@c19e413' },
    })
    const cwdIdx = body.indexOf(FOOTER_EMOJI.cwd)
    const branchIdx = body.indexOf(FOOTER_EMOJI.branch)
    const tsIdx = body.indexOf(FOOTER_EMOJI.ts)
    expect(cwdIdx).toBeLessThan(branchIdx)
    expect(branchIdx).toBeLessThan(tsIdx)
    expect(body).toContain(`${FOOTER_EMOJI.branch} main@c19e413`)
  })

  it('section order: header → details → user-kv → link → footer', () => {
    const body = assembleMessage({
      severity: 'error',
      title: 'crashed',
      details: 'stack here',
      contextKv: [
        ['project', 'foo'],
        ['run', 'bar-260530'],
      ],
      link: 'https://example.com/x',
      parseMode: 'MarkdownV2',
      auto: AUTO_MIN,
    })
    const idxHeader = body.indexOf('🔥 *crashed*')
    const idxDetails = body.indexOf('stack here')
    const idxKv = body.indexOf('project: foo')
    const idxLink = body.indexOf('https://example')
    const idxFooter = body.indexOf(FOOTER_EMOJI.host)
    expect(idxHeader).toBeGreaterThanOrEqual(0)
    expect(idxHeader).toBeLessThan(idxDetails)
    expect(idxDetails).toBeLessThan(idxKv)
    expect(idxKv).toBeLessThan(idxLink)
    expect(idxLink).toBeLessThan(idxFooter)
    expect(body).toContain('run: bar\\-260530')
  })
})

describe('renderDetails — MarkdownV2 markdown rendering', () => {
  const md = (s: string) => renderDetails(s, 'MarkdownV2')

  it('escapes plain text the same as escapeMarkdownV2', () => {
    expect(md('Hello. World!')).toBe('Hello\\. World\\!')
  })

  it('renders **bold** (CommonMark) to single-star Telegram bold', () => {
    expect(md('**Stack trace**')).toBe('*Stack trace*')
  })

  it('renders __bold__ to Telegram bold', () => {
    expect(md('__loud__')).toBe('*loud*')
  })

  it('renders *italic* and _italic_ to Telegram italic', () => {
    expect(md('*soft*')).toBe('_soft_')
    expect(md('_soft_')).toBe('_soft_')
  })

  it('renders [text](url) to a Telegram link', () => {
    // Telegram MarkdownV2 link URLs escape only `)` and `\` — NOT `.`.
    expect(md('see [docs](https://x.io/a)')).toBe('see [docs](https://x.io/a)')
  })

  it('escapes reserved chars inside bold content', () => {
    expect(md('**a.b!**')).toBe('*a\\.b\\!*')
  })

  it('preserves triple-backtick fences with only `+\\ escaped inside', () => {
    const src = '```python\nfoo.bar() # ok!\n```'
    // Fences preserved verbatim; the code body is NOT escaped for `.` `!`.
    expect(md(src)).toBe('```python\nfoo.bar() # ok!\n```')
  })

  it('escapes `\\` and `` ` `` inside code blocks', () => {
    const src = '```\nhas a \\ and a `tick`\n```'
    expect(md(src)).toBe('```\nhas a \\\\ and a \\`tick\\`\n```')
  })

  it('mixes bold + plain + code regions correctly', () => {
    const src = '**Trace** (rank 3):\n```\ncode!\n```\nafter!'
    const out = md(src)
    expect(out).toContain('*Trace*')
    expect(out).toContain('\\(rank 3\\):')
    expect(out).toContain('```\ncode!\n```')
    expect(out).toContain('after\\!')
  })

  it('treats inline backticks as code', () => {
    expect(md('check `foo.bar` please.')).toBe('check `foo.bar` please\\.')
  })

  it('escapes an unclosed backtick as a literal reserved char', () => {
    expect(md('oops `unclosed')).toBe('oops \\`unclosed')
  })
})

describe('renderDetails — HTML markdown rendering', () => {
  const html = (s: string) => renderDetails(s, 'HTML')

  it('renders **bold** to <b>', () => {
    expect(html('**hi**')).toBe('<b>hi</b>')
  })

  it('renders fenced code to <pre> stripping the lang line', () => {
    // The raw fence body is `python\nfoo()\n`; stripping the `python\n`
    // lang line leaves `foo()\n` (the newline before the closing fence).
    expect(html('```python\nfoo()\n```')).toBe('<pre>foo()\n</pre>')
  })

  it('renders inline code to <code> and escapes < & >', () => {
    expect(html('`a < b & c`')).toBe('<code>a &lt; b &amp; c</code>')
  })

  it('escapes plain reserved html chars', () => {
    expect(html('1 < 2 & 3')).toBe('1 &lt; 2 &amp; 3')
  })
})

describe('assembleMessage truncation', () => {
  it('truncates details when over the cap, preserves title + footer', () => {
    const longDetails = 'X'.repeat(5000)
    const body = assembleMessage({
      severity: 'info',
      title: 'short',
      details: longDetails,
      contextKv: [],
      parseMode: 'MarkdownV2',
      auto: AUTO_MIN,
    })
    expect(body.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_CAP)
    expect(body).toContain('*short*')
    // MarkdownV2 escapes the parens around "truncated".
    expect(body).toContain('…\\(truncated\\)')
    expect(body).toContain(`${FOOTER_EMOJI.host} erdos`)
    expect(body).toContain(`${FOOTER_EMOJI.ts} 2026`)
  })

  it('does NOT truncate when under the cap', () => {
    const details = 'small enough'
    const body = assembleMessage({
      severity: 'info',
      title: 'short',
      details,
      contextKv: [],
      parseMode: 'MarkdownV2',
      auto: AUTO_MIN,
    })
    expect(body).toContain('small enough')
    expect(body).not.toContain('…(truncated)')
  })
})

describe('assembleMessage HTML mode', () => {
  it('switches escape set and bold tag', () => {
    const body = assembleMessage({
      severity: 'info',
      title: '1 < 2 & true',
      contextKv: [],
      parseMode: 'HTML',
      auto: AUTO_MIN,
    })
    expect(body).toContain('<b>1 &lt; 2 &amp; true</b>')
    // HTML mode wraps the footer in <blockquote>; no backslash escaping.
    expect(body).toContain('<blockquote>')
    expect(body).toContain('</blockquote>')
    expect(body).toContain(`${FOOTER_EMOJI.cwd} ~/work`)
    expect(body).toContain(`${FOOTER_EMOJI.ts} 2026-05-30T12:00:00+08:00`)
  })
})

describe('redactToken', () => {
  it('replaces every occurrence with ***', () => {
    expect(redactToken('foo TOK bar TOK baz', 'TOK')).toBe('foo *** bar *** baz')
  })

  it('is identity when token absent from string', () => {
    expect(redactToken('foo bar', 'TOK')).toBe('foo bar')
  })

  it('is identity when token is empty', () => {
    expect(redactToken('foo TOK bar', '')).toBe('foo TOK bar')
  })
})
