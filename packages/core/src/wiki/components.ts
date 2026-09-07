// Structural body scanning: fenced blocks, component info strings, and the
// code mask every other lint pass reads.
//
// Core stays opaque to component semantics — payload schemas, renderers, and
// `WIKI_COMPONENT_INVALID` / `WIKI_DATA_*` diagnostics live in the central
// dashboard registry (`apps/web/lib/wiki-components/`). What lives here is
// only what a Backend or the CLI can decide without the registry: where the
// blocks are, which component each one names, and whether the info string
// pins a major version.

import type { WikiComponentBlock } from './types.js'

/**
 * Component names known well enough offline to warn about an unpinned info
 * string. This is a *name* mirror of the central registry, never a descriptor:
 * a component added centrally simply misses the offline WIKI_COMPONENT_UNPINNED
 * warning until the next core release, and central always passes its live name
 * list to `lintWikiPage`.
 */
export const WIKI_STRUCTURAL_COMPONENT_NAMES: readonly string[] = ['memon-data', 'html-embed']

/** `<name>` or `<name>@<major>` — the first token of a component info string. */
const COMPONENT_TOKEN_REGEX = /^([a-z][a-z0-9-]*)(?:@(\d+))?$/

export interface WikiFencedBlock {
  /** 1-based line of the opening fence. */
  line: number
  /** 1-based line of the closing fence, or of the last body line when the block is unterminated. */
  endLine: number
  /** Info string as written, trimmed. */
  info: string
  /** Block body, verbatim, without the fences. */
  payload: string
}

/**
 * CommonMark-shaped fenced code block scan: 3+ backticks or tildes, up to
 * three leading spaces, closed by a fence of the same character that is at
 * least as long. An unterminated fence runs to the end of the body.
 */
export function parseWikiFencedBlocks(body: string): WikiFencedBlock[] {
  const lines = body.split('\n')
  const blocks: WikiFencedBlock[] = []
  let index = 0
  while (index < lines.length) {
    const open = matchFence(lines[index]!)
    if (!open) {
      index += 1
      continue
    }
    // Backtick info strings may not contain a backtick (CommonMark 4.5).
    if (open.char === '`' && open.rest.includes('`')) {
      index += 1
      continue
    }
    const startLine = index + 1
    const payload: string[] = []
    let endLine = lines.length
    let cursor = index + 1
    for (; cursor < lines.length; cursor += 1) {
      const close = matchFence(lines[cursor]!)
      if (close && close.char === open.char && close.length >= open.length && !close.rest) {
        endLine = cursor + 1
        break
      }
      payload.push(lines[cursor]!)
    }
    blocks.push({
      line: startLine,
      endLine,
      info: open.rest.trim(),
      payload: payload.length > 0 ? `${payload.join('\n')}\n` : '',
    })
    index = cursor + 1
  }
  return blocks
}

/**
 * Every fenced block whose info string opens with a component-shaped token,
 * in body order. Unregistered languages (`python`, `mermaid`, `foo-chart`)
 * come back too — resolving names against a registry is the caller's job, and
 * `index` is the position in this list.
 */
export function parseWikiComponentBlocks(body: string): WikiComponentBlock[] {
  const blocks: WikiComponentBlock[] = []
  for (const fenced of parseWikiFencedBlocks(body)) {
    const [token = '', ...rest] = fenced.info.split(/\s+/)
    const match = COMPONENT_TOKEN_REGEX.exec(token)
    if (!match) continue
    const version = match[2] === undefined ? null : Number.parseInt(match[2], 10)
    blocks.push({
      index: blocks.length,
      name: match[1]!,
      version,
      line: fenced.line,
      info: rest.join(' '),
      payload: fenced.payload,
    })
  }
  return blocks
}

/**
 * Blank out every region a Markdown reader treats as code — fenced blocks,
 * indented code blocks, and inline code spans — replacing their characters
 * with spaces so line and column numbers still line up. Prose scans (`@`
 * references, evidence tokens, deprecation callouts) run over the mask so a
 * `@W0001` inside backticks is never mistaken for a reference.
 */
export function maskWikiCode(body: string): string {
  const lines = body.split('\n')
  const masked = lines.slice()
  for (const block of parseWikiFencedBlocks(body)) {
    for (let line = block.line; line <= Math.min(block.endLine, lines.length); line += 1) {
      masked[line - 1] = ' '.repeat(lines[line - 1]!.length)
    }
  }
  for (let index = 0; index < masked.length; index += 1) {
    const line = masked[index]!
    // An indented code block only starts outside a paragraph; approximating it
    // by "4+ spaces and the previous line is blank-or-indented" is enough to
    // keep pasted snippets from producing reference noise.
    const previous = index === 0 ? '' : masked[index - 1]!
    const indented =
      /^ {4,}\S/.test(line) && (previous.trim() === '' || /^ {4,}\S/.test(previous.trimEnd()))
    masked[index] = indented ? ' '.repeat(line.length) : maskInlineCode(line)
  }
  return masked.join('\n')
}

function maskInlineCode(line: string): string {
  let out = ''
  let index = 0
  while (index < line.length) {
    if (line[index] !== '`') {
      out += line[index]
      index += 1
      continue
    }
    let runLength = 0
    while (line[index + runLength] === '`') runLength += 1
    const marker = '`'.repeat(runLength)
    const close = line.indexOf(marker, index + runLength)
    if (close === -1) {
      out += line.slice(index, index + runLength)
      index += runLength
      continue
    }
    out += ' '.repeat(close + runLength - index)
    index = close + runLength
  }
  return out
}

interface FenceMatch {
  char: '`' | '~'
  length: number
  rest: string
}

function matchFence(line: string): FenceMatch | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match) return null
  const fence = match[1]!
  return { char: fence[0] as '`' | '~', length: fence.length, rest: match[2] ?? '' }
}
