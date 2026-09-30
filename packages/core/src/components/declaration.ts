/**
 * Info-string grammar for component blocks: `<lang> <type>@<N> #<id>`.
 *
 * Pure and dependency-free copy of `apps/web/lib/components/declaration.ts`:
 * core needs the grammar for structural lint and for the CLI runner, and the
 * dashboard cannot be imported from here. `shared-grammar.test.ts` keeps the
 * two files in step over a shared fixture list.
 */

export type ComponentDiagnosticCode =
  | 'WIKI_COMPONENT_UNPINNED'
  | 'WIKI_COMPONENT_INVALID'
  | 'COMPONENT_ID_DUPLICATE'

export interface ComponentDeclaration {
  /** First token: payload language (`yaml`, `json`, `html`, …). */
  lang: string
  type: string
  /** Null when the author omitted `@<N>` (resolves to latest, warns). */
  version: number | null
  id: string | null
}

export type ComponentDeclarationResult =
  | { kind: 'component'; declaration: ComponentDeclaration }
  | { kind: 'invalid'; message: string }
  | { kind: 'plain' }

const TYPE_TOKEN = /^([a-z][a-z0-9-]*)(?:@(\d+))?$/
const ID_TOKEN = /^#([A-Za-z0-9_]+)$/

/**
 * Classify an info string. `plain` = ordinary code block (no second token of
 * the `<type>[@N]` shape); `invalid` = looks like a component but breaks the
 * grammar (extra tokens, bad version, bad id) and must be reported.
 */
export function parseComponentDeclaration(info: string): ComponentDeclarationResult {
  const tokens = info.trim().split(/\s+/).filter(Boolean)
  if (tokens.length < 2) return { kind: 'plain' }
  const lang = tokens[0]!
  const typeMatch = TYPE_TOKEN.exec(tokens[1]!)
  if (!typeMatch) return { kind: 'plain' }
  const type = typeMatch[1]!
  let version: number | null = null
  if (typeMatch[2] !== undefined) {
    version = Number(typeMatch[2])
    if (!Number.isInteger(version) || version < 1) {
      return {
        kind: 'invalid',
        message: `component version must be a positive integer: ${tokens[1]}`,
      }
    }
  }
  let id: string | null = null
  if (tokens.length >= 3) {
    const idMatch = ID_TOKEN.exec(tokens[2]!)
    if (!idMatch) {
      return {
        kind: 'invalid',
        message: `expected \`#<id>\` after \`${tokens[1]}\`, got \`${tokens[2]}\``,
      }
    }
    id = idMatch[1]!
  }
  if (tokens.length > 3) {
    return {
      kind: 'invalid',
      message: `unexpected tokens after the block id: ${tokens.slice(3).join(' ')}`,
    }
  }
  return { kind: 'component', declaration: { lang, type, version, id } }
}

export function formatComponentDeclaration(declaration: ComponentDeclaration): string {
  const version = declaration.version === null ? '' : `@${declaration.version}`
  const id = declaration.id === null ? '' : ` #${declaration.id}`
  return `${declaration.lang} ${declaration.type}${version}${id}`
}
