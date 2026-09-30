/**
 * Every block body becomes one object:
 *   yaml  → mapping (core schema, no anchors/aliases, unique keys)
 *   json  → object
 *   other → { data: "<body verbatim>" }
 * A yaml mapping carrying `script` or `code` is executable: its cached result
 * replaces the mapping at render time and the remaining keys are kwargs.
 *
 * Pure copy of `apps/web/lib/components/payload.ts`; the runner in
 * `execute.ts` and the dashboard registry must agree byte for byte, which
 * `shared-grammar.test.ts` asserts.
 */

import { isMap, parseDocument, visit } from 'yaml'

export const RESERVED_PAYLOAD_KEYS = ['script', 'code'] as const
export const RESERVED_PREFIX = '__'

export interface ExecutableSpec {
  /** `<path>::<function>`; path document-relative or absolute in a project root. */
  script?: string
  /** Inline Python with exactly one top-level `def`. */
  code?: string
  /** Every other top-level key, passed as keyword arguments. */
  kwargs: Record<string, unknown>
}

export type DerivedPayload =
  | { kind: 'static'; value: Record<string, unknown> }
  | { kind: 'executable'; spec: ExecutableSpec }
  | { kind: 'error'; field: string | null; message: string }

const SCRIPT_REF = /^(.+)::([A-Za-z_][A-Za-z0-9_]*)$/
const TOP_LEVEL_DEF = /^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm

export type YamlMappingResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

export function parseYamlMapping(body: string): YamlMappingResult {
  const document = parseDocument(body, { schema: 'core', uniqueKeys: true })
  if (document.errors.length > 0) {
    return { ok: false, error: document.errors[0]!.message.split('\n')[0]! }
  }
  let aliased = false
  visit(document, {
    Alias: () => {
      aliased = true
      return visit.BREAK
    },
  })
  if (aliased) return { ok: false, error: 'anchors and aliases are not allowed' }
  if (document.contents === null) return { ok: true, value: {} }
  if (!isMap(document.contents)) return { ok: false, error: 'payload must be a YAML mapping' }
  return { ok: true, value: document.toJS() as Record<string, unknown> }
}

export function derivePayload(lang: string, body: string): DerivedPayload {
  let value: Record<string, unknown>
  if (lang === 'yaml' || lang === 'yml') {
    const parsed = parseYamlMapping(body)
    if (!parsed.ok) return { kind: 'error', field: null, message: parsed.error }
    value = parsed.value
  } else if (lang === 'json') {
    try {
      const parsed: unknown = JSON.parse(body)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { kind: 'error', field: null, message: 'payload must be a JSON object' }
      }
      value = parsed as Record<string, unknown>
    } catch (error) {
      return {
        kind: 'error',
        field: null,
        message: `payload must be valid JSON: ${(error as Error).message}`,
      }
    }
  } else {
    return { kind: 'static', value: { data: body } }
  }

  const hasScript = 'script' in value
  const hasCode = 'code' in value
  if (!hasScript && !hasCode) return { kind: 'static', value }
  if (lang === 'json') {
    return {
      kind: 'error',
      field: hasScript ? 'script' : 'code',
      message: 'executable payloads must be YAML',
    }
  }
  if (hasScript && hasCode) {
    return { kind: 'error', field: 'script', message: '`script` and `code` are mutually exclusive' }
  }

  const kwargs: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'script' || key === 'code') continue
    if (key.startsWith(RESERVED_PREFIX)) {
      return {
        kind: 'error',
        field: key,
        message: `keys starting with \`${RESERVED_PREFIX}\` are reserved`,
      }
    }
    kwargs[key] = entry
  }

  if (hasScript) {
    const script = value.script
    if (typeof script !== 'string' || !SCRIPT_REF.test(script.trim())) {
      return { kind: 'error', field: 'script', message: '`script` must be `<path>::<function>`' }
    }
    return { kind: 'executable', spec: { script: script.trim(), kwargs } }
  }
  const code = value.code
  if (typeof code !== 'string')
    return { kind: 'error', field: 'code', message: '`code` must be a string' }
  const defs = [...code.matchAll(TOP_LEVEL_DEF)]
  if (defs.length !== 1) {
    return {
      kind: 'error',
      field: 'code',
      message: `\`code\` must contain exactly one top-level \`def\`, found ${defs.length}`,
    }
  }
  return { kind: 'executable', spec: { code, kwargs } }
}

/** Name of the function an executable spec calls. */
export function executableFunctionName(spec: ExecutableSpec): string {
  if (spec.script) return SCRIPT_REF.exec(spec.script)![2]!
  const [def] = [...spec.code!.matchAll(TOP_LEVEL_DEF)]
  return def![1]!
}

/** Strip execution-layer keys before schema validation. */
export function stripHiddenKeys(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!key.startsWith(RESERVED_PREFIX)) out[key] = entry
  }
  return out
}
