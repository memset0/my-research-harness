/**
 * Fenced-block info-string parser for the wiki component registry.
 *
 * A component block is a fenced code block whose info string is
 * `<component>[@<version>] [key=value …]`. The first token selects the
 * component and optionally pins a major version; every remaining token is an
 * attribute in `key=value` or `key="quoted value"` form.
 *
 * Pure string handling only — no filesystem, no `@memon/core` — so the same
 * module runs inside the client Markdown renderer and on the request path.
 */

export interface WikiComponentInfoString {
  /** First token with any `@<version>` suffix removed. */
  name: string
  /** Major version literally written in the info string; `null` when unpinned. */
  pinnedVersion: number | null
  /** `true` when an `@…` suffix was present but was not a positive integer. */
  malformedVersion: boolean
  /** Raw (unquoted) attribute values in source order. */
  attributes: Record<string, string>
  /** Trailing tokens that are not in `key=value` form; always a lint error. */
  bareTokens: string[]
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9._-]*$/
const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]*$/
const VERSION_RE = /^[1-9][0-9]*$/

/**
 * Split an info string on unquoted whitespace. Quotes only group; they are
 * removed when the value is unquoted below, so `title="a b"` yields the single
 * token `title="a b"`.
 */
function tokenizeInfoString(info: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let index = 0; index < info.length; index += 1) {
    const char = info[index] as string
    if (quote) {
      if (char === '\\' && info[index + 1] === quote) {
        current += quote
        index += 1
        continue
      }
      if (char === quote) {
        quote = null
        current += char
        continue
      }
      current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current.length > 0) tokens.push(current)
  return tokens
}

function unquote(value: string): string {
  const first = value[0]
  if ((first === '"' || first === "'") && value.length >= 2 && value.endsWith(first)) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Parse an info string. Returns `null` when the string has no leading token
 * that could name a component (empty info, or a first token that is not a
 * plain identifier such as `{.foo}`).
 */
export function parseWikiComponentInfoString(info: string): WikiComponentInfoString | null {
  const tokens = tokenizeInfoString(info)
  const head = tokens[0]
  if (!head) return null

  const at = head.indexOf('@')
  const name = at === -1 ? head : head.slice(0, at)
  const versionToken = at === -1 ? null : head.slice(at + 1)
  if (!NAME_RE.test(name)) return null

  const pinned = versionToken !== null && VERSION_RE.test(versionToken)
  const attributes: Record<string, string> = {}
  const bareTokens: string[] = []
  for (const token of tokens.slice(1)) {
    const equals = token.indexOf('=')
    const key = equals === -1 ? '' : token.slice(0, equals)
    if (equals <= 0 || !KEY_RE.test(key)) {
      bareTokens.push(unquote(token))
      continue
    }
    attributes[key] = unquote(token.slice(equals + 1))
  }

  return {
    name,
    pinnedVersion: pinned ? Number(versionToken) : null,
    malformedVersion: versionToken !== null && !pinned,
    attributes,
    bareTokens,
  }
}

/** Inverse of the parser, used by `migrateComponents` to rewrite fence lines. */
export function formatWikiComponentInfoString(
  name: string,
  version: number,
  attributes: Record<string, string>,
): string {
  const parts = [`${name}@${version}`]
  for (const [key, value] of Object.entries(attributes)) {
    parts.push(/[\s"'=`]/.test(value) ? `${key}="${value.replaceAll('"', '\\"')}"` : `${key}=${value}`)
  }
  return parts.join(' ')
}
