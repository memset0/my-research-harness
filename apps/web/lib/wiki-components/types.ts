/**
 * Descriptor contract for wiki body components.
 *
 * Components live only in the central web application (never in
 * `@memon/core`, `@memon/backend`, or the CLI artifact) so adding or changing
 * one is a central-only release. Descriptors are therefore deliberately free
 * of any `@memon/core` runtime import: the registry has to run unchanged
 * inside the client Markdown bundle, which must not pull `fast-glob`/`fs`.
 */

import type { ZodType, ZodTypeAny } from 'zod'

/**
 * Structural mirror of `WikiDiagnostic` in `@memon/core`. Kept local for the
 * bundle reason above; central merges these into the core diagnostics list
 * when it serves a wiki page.
 */
export interface WikiComponentDiagnostic {
  code: WikiComponentDiagnosticCode
  severity: 'error' | 'warn'
  message: string
  line?: number
}

/** Diagnostic codes emitted by the central component registry. */
export type WikiComponentDiagnosticCode =
  | 'WIKI_COMPONENT_UNPINNED'
  | 'WIKI_COMPONENT_INVALID'
  | 'WIKI_DATA_BLOCK_INVALID'
  | 'WIKI_DATA_PROVENANCE_MISSING'

/** Thrown by `parsePayload`; the registry turns it into a diagnostic. */
export class WikiComponentBlockError extends Error {
  readonly code: WikiComponentDiagnosticCode
  /** Attribute or payload field the failure is attributable to. */
  readonly field: string | null

  constructor(code: WikiComponentDiagnosticCode, field: string | null, message: string) {
    super(message)
    this.name = 'WikiComponentBlockError'
    this.code = code
    this.field = field
  }
}

export interface WikiComponentArg {
  name: string
  scope: 'attribute' | 'payload'
  type: string
  required: boolean
  default?: string
  meaning: string
}

/** A wrong block paired with the diagnostic code it must produce. */
export interface WikiComponentInvalidExample {
  block: string
  code: WikiComponentDiagnosticCode
}

/** Raw block as it appears in the document, before version resolution. */
export interface WikiComponentBlockSource {
  info: string
  attributes: Record<string, string>
  payload: string
}

export interface WikiComponentLintContext {
  name: string
  version: number
  /** Index of the block among the component blocks of the document. */
  index: number
  /** 1-based line of the opening fence. */
  line: number
  /**
   * Bundle-relative existence probe. Central supplies it for pages that have
   * an asset root; it is absent on surfaces where relative payload paths
   * cannot be resolved, and file-existence checks are then skipped.
   */
  fileExists?: (relativePath: string) => boolean
}

export interface WikiComponentDescriptor<Data = unknown> {
  name: string
  version: number
  /** What the component shows. */
  description: string
  /** Every attribute and payload field with type, default, and meaning. */
  args: readonly WikiComponentArg[]
  /** How the dashboard and the Markdown projection render it. */
  effect: string
  /** When this component is the right choice, and when it is not. */
  useWhen: string
  /** One complete, authorable block. */
  example: string
  invalidExamples: readonly WikiComponentInvalidExample[]
  /** Project-relative fixture pages that render this version. */
  fixtures: readonly string[]
  /** Attribute schema; also the source of truth for attribute validation. */
  attributes: ZodTypeAny
  /** Parse and validate the block, or throw `WikiComponentBlockError`. */
  parsePayload(payload: string, attributes: Record<string, string>): Data
  lint(data: Data, context: WikiComponentLintContext): WikiComponentDiagnostic[]
  /** Projection used outside the dashboard (`show --format markdown`). */
  toMarkdown(data: Data): string
  /**
   * Mechanically rewrite a block authored against the previous major version
   * into this one. `null` means the block cannot be migrated automatically.
   */
  migrate?(previous: WikiComponentBlockSource): {
    attributes: Record<string, string>
    payload: string
  } | null
}

/**
 * Validate the attribute record of a block against its descriptor schema.
 * Every descriptor calls this first inside `parsePayload` so an unknown or
 * malformed attribute always surfaces as `WIKI_COMPONENT_INVALID` naming the
 * field; the registry prefixes the component and version.
 */
export function parseComponentAttributes<T extends Record<string, unknown>>(
  descriptor: Pick<WikiComponentDescriptor, 'name' | 'version'> & { attributes: ZodType<T> },
  attributes: Record<string, string>,
): T {
  const result = descriptor.attributes.safeParse(attributes)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  // A `strict()` violation reports the offending key in `keys`, not in `path`.
  const unrecognized =
    issue && issue.code === 'unrecognized_keys' ? issue.keys[0] : (issue?.path?.[0] ?? null)
  throw new WikiComponentBlockError(
    'WIKI_COMPONENT_INVALID',
    typeof unrecognized === 'string' ? unrecognized : null,
    issue?.message ?? 'attributes are invalid',
  )
}
