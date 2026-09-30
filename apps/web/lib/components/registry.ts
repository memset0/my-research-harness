/**
 * The component registry: the one place that turns a fenced block into a
 * validated component instance plus diagnostics.
 *
 * Registration is not hand-written: `GENERATED_DESCRIPTORS` comes from
 * `registry.generated.ts`, which `scripts/component-docs.ts` derives from the
 * `apps/web/lib/components/<type>/v<N>/` directories.
 */

import type { RefinementCtx, ZodIssue, ZodObject, ZodType, ZodTypeDef } from 'zod'
import { parseComponentDeclaration, type ComponentDiagnosticCode } from './declaration'
import { scanFencedBlocks } from './fence'
import { derivePayload, stripHiddenKeys, type ExecutableSpec } from './payload'
import { GENERATED_DESCRIPTORS } from './registry.generated'
import type { ComponentDescriptor } from './types'

export interface ComponentDiagnostic {
  code: ComponentDiagnosticCode
  severity: 'error' | 'warn'
  message: string
  /** 1-based opening-fence line in the body the diagnostic was produced from. */
  line: number
}

/** One fenced block that declared a component, resolved against the registry. */
export interface ResolvedBlock {
  /** Position among the component blocks of the body, 0-based. */
  index: number
  /** 1-based opening fence line in the given body. */
  line: number
  /** Info string as written. */
  info: string
  /** First info-string token: the payload language. */
  lang: string
  type: string
  /** Resolved major version; null when the type or the pinned version is unknown. */
  version: number | null
  /** `@<N>` as written, or null when the author omitted it. */
  pinnedVersion: number | null
  /** Highest registered version of the type, or null for an unknown type. */
  latestVersion: number | null
  outdated: boolean
  id: string | null
  /** Payload as written; the identity guard for in-place rewrites. */
  payload: string
  executable: boolean
  spec: ExecutableSpec | null
  /** Validated static data; null when the block is executable or invalid. */
  data: Record<string, unknown> | null
  diagnostics: ComponentDiagnostic[]
}

export type PayloadValidation =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; field: string | null; message: string }

// biome-ignore lint/suspicious/noExplicitAny: registry entries intentionally erase each descriptor's schema shape
type AnyDescriptor = ComponentDescriptor<any>

const BY_TYPE = new Map<string, Map<number, AnyDescriptor>>()
/** `<type>@<N>` → the strict schema plus the descriptor's cross-field checks. */
const VALIDATORS = new Map<string, ZodType<unknown, ZodTypeDef, unknown>>()
for (const descriptor of GENERATED_DESCRIPTORS) {
  const versions = BY_TYPE.get(descriptor.type) ?? new Map<number, AnyDescriptor>()
  if (versions.has(descriptor.version)) {
    throw new Error(`duplicate component ${descriptor.type}@${descriptor.version}`)
  }
  versions.set(descriptor.version, descriptor)
  BY_TYPE.set(descriptor.type, versions)
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous generated descriptors erase their shapes here
  const strict = (descriptor.schema as ZodObject<any>).strict()
  const refine = descriptor.refine as ((data: unknown, ctx: RefinementCtx) => void) | undefined
  VALIDATORS.set(
    `${descriptor.type}@${descriptor.version}`,
    refine ? strict.superRefine(refine) : strict,
  )
}

export function listComponents(): readonly AnyDescriptor[] {
  return GENERATED_DESCRIPTORS
}

export function latestVersion(type: string): number | null {
  const versions = BY_TYPE.get(type)
  if (!versions) return null
  return Math.max(...versions.keys())
}

export function findDescriptor(type: string, version: number): AnyDescriptor | null {
  return BY_TYPE.get(type)?.get(version) ?? null
}

/** `views[0].x` — how a zod issue path reads in a diagnostic. */
function dottedPath(path: readonly (string | number | symbol)[]): string {
  let out = ''
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`
    else out += out.length === 0 ? String(segment) : `.${String(segment)}`
  }
  return out
}

/**
 * Validate one payload object against a registered schema. `__*` keys are
 * stripped first: they belong to the execution layer, never to a schema.
 */
export function validatePayload(
  type: string,
  version: number,
  value: Record<string, unknown>,
): PayloadValidation {
  const validator = VALIDATORS.get(`${type}@${version}`)
  if (!validator) return { ok: false, field: null, message: `unknown component ${type}@${version}` }
  const parsed = validator.safeParse(stripHiddenKeys(value))
  if (parsed.success) return { ok: true, data: parsed.data as Record<string, unknown> }
  const issue = parsed.error.issues[0] as ZodIssue
  const field =
    issue.code === 'unrecognized_keys' ? (issue.keys[0] ?? null) : dottedPath(issue.path) || null
  return { ok: false, field, message: issue.message }
}

/** Best-effort type/version recovery for a block that broke the grammar. */
const LOOSE_TYPE_TOKEN = /^([a-z][a-z0-9-]*)(?:@(\d+))?/

function looseType(info: string): { type: string; version: number | null } {
  const token = info.trim().split(/\s+/)[1] ?? ''
  const match = LOOSE_TYPE_TOKEN.exec(token)
  if (!match) return { type: token, version: null }
  const version = match[2] === undefined ? null : Number(match[2])
  return { type: match[1] as string, version: Number.isInteger(version) ? version : null }
}

/**
 * Resolve one block. Returns null for an ordinary code block; every block
 * whose info string declares a component — valid or not — comes back with its
 * diagnostics so the surface can render it verbatim and report the problem.
 */
export function resolveComponentBlock(
  source: { info: string; payload: string },
  index = 0,
  line = 1,
): ResolvedBlock | null {
  const parsed = parseComponentDeclaration(source.info)
  if (parsed.kind === 'plain') return null

  const block: ResolvedBlock = {
    index,
    line,
    info: source.info,
    lang: source.info.trim().split(/\s+/)[0] ?? '',
    type: '',
    version: null,
    pinnedVersion: null,
    latestVersion: null,
    outdated: false,
    id: null,
    payload: source.payload,
    executable: false,
    spec: null,
    data: null,
    diagnostics: [],
  }
  const invalid = (message: string, field: string | null = null) => {
    block.diagnostics.push({
      code: 'WIKI_COMPONENT_INVALID',
      severity: 'error',
      message: field ? `${prefix()} field \`${field}\`: ${message}` : `${prefix()}: ${message}`,
      line,
    })
  }
  const prefix = () =>
    `${block.type}@${block.version ?? block.pinnedVersion ?? block.latestVersion ?? '?'} block ${index}`

  if (parsed.kind === 'invalid') {
    const loose = looseType(source.info)
    block.type = loose.type
    block.pinnedVersion = loose.version
    block.latestVersion = latestVersion(loose.type)
    invalid(parsed.message)
    return block
  }

  const { lang, type, version, id } = parsed.declaration
  block.lang = lang
  block.type = type
  block.id = id
  block.pinnedVersion = version
  const latest = latestVersion(type)
  block.latestVersion = latest
  if (latest === null) {
    invalid('component type is not registered')
    return block
  }
  const resolved = version ?? latest
  const descriptor = findDescriptor(type, resolved)
  if (version === null) {
    block.diagnostics.push({
      code: 'WIKI_COMPONENT_UNPINNED',
      severity: 'warn',
      message: `component block \`${type}\` does not pin a major version; write \`${type}@${latest}\``,
      line,
    })
  }
  if (!descriptor) {
    invalid(
      `version is not registered; registered versions are ${[...(BY_TYPE.get(type)?.keys() ?? [])]
        .sort((left, right) => left - right)
        .map((known) => `${type}@${known}`)
        .join(', ')}`,
    )
    return block
  }
  block.version = descriptor.version
  block.outdated = descriptor.version < latest

  const derived = derivePayload(lang, source.payload)
  if (derived.kind === 'error') {
    invalid(derived.message, derived.field)
    return block
  }
  if (derived.kind === 'executable') {
    block.executable = true
    block.spec = derived.spec
    if (id === null) invalid('executable block needs #<id>')
    return block
  }
  const validation = validatePayload(type, descriptor.version, derived.value)
  if (!validation.ok) {
    invalid(validation.message, validation.field)
    return block
  }
  block.data = validation.data
  return block
}

/**
 * Every component block of a Markdown body, in document order, with block-id
 * uniqueness enforced across the document.
 */
export function listComponentBlocks(body: string): ResolvedBlock[] {
  const blocks: ResolvedBlock[] = []
  for (const fenced of scanFencedBlocks(body)) {
    const block = resolveComponentBlock(
      { info: fenced.info, payload: fenced.payload },
      blocks.length,
      fenced.line,
    )
    if (block) blocks.push(block)
  }
  const seen = new Map<string, number>()
  for (const block of blocks) {
    if (block.id === null) continue
    const first = seen.get(block.id)
    if (first === undefined) {
      seen.set(block.id, block.line)
      continue
    }
    block.diagnostics.push({
      code: 'COMPONENT_ID_DUPLICATE',
      severity: 'error',
      message: `block id \`${block.id}\` is already used at line ${first}`,
      line: block.line,
    })
  }
  return blocks
}

export function lintComponents(body: string): ComponentDiagnostic[] {
  return listComponentBlocks(body).flatMap((block) => block.diagnostics)
}
