// The one YAML-frontmatter delimiter rule for every Markdown document memon
// splits or patches by hand (Run README patches and deprecation flags, wiki
// pages, code-review docs, the journal, filesystem migrations).
//
//   - optional leading byte-order mark
//   - opening line `---`, trailing spaces/tabs allowed, LF or CRLF
//   - terminator: the first following line that is `---` or `...`
//     (trailing spaces/tabs allowed), ending in LF, CRLF or end of text
//   - an empty block (`---\n---\n`) is an empty mapping
//   - the body is every byte after the terminator line, verbatim
//
// Only the delimiters are shared. Each caller keeps its own YAML library
// (gray-matter / js-yaml / `yaml`): they differ in timestamp coercion,
// anchors and error recovery, and swapping one would change what is parsed
// and written back to disk.

export type FrontmatterSplit =
  /** The text does not open with a frontmatter line. */
  | { status: 'none' }
  /** An opening line without a terminator. */
  | { status: 'unterminated'; bom: boolean; rawStart: number }
  | {
      status: 'ok'
      bom: boolean
      /** YAML text between the delimiter lines (no trailing newline). */
      raw: string
      /** Everything after the terminator line, byte-for-byte. */
      body: string
      /** Offset of `raw` in the original text. */
      rawStart: number
      /** Offset just after `raw` (before the newline preceding the terminator). */
      rawEnd: number
      /** Offset of the terminator line. */
      terminatorStart: number
      /** Offset of `body` in the original text. */
      bodyStart: number
    }

const OPENING = /^﻿?---[ \t]*\r?\n/
const TERMINATOR = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm

export function splitFrontmatter(text: string): FrontmatterSplit {
  const opening = OPENING.exec(text)
  if (!opening) return { status: 'none' }
  const bom = text.charCodeAt(0) === 0xfeff
  const rawStart = opening[0].length
  TERMINATOR.lastIndex = rawStart
  const close = TERMINATOR.exec(text)
  if (!close) return { status: 'unterminated', bom, rawStart }
  // `raw` excludes the newline that precedes the terminator line.
  let rawEnd = close.index
  if (rawEnd > rawStart && text[rawEnd - 1] === '\n') rawEnd -= 1
  if (rawEnd > rawStart && text[rawEnd - 1] === '\r') rawEnd -= 1
  const bodyStart = close.index + close[0].length
  return {
    status: 'ok',
    bom,
    raw: text.slice(rawStart, rawEnd),
    body: text.slice(bodyStart),
    rawStart,
    rawEnd,
    terminatorStart: close.index,
    bodyStart,
  }
}
