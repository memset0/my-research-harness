/**
 * Component descriptor contract (central-only).
 *
 * A component version is one directory `apps/web/lib/components/<type>/v<N>/`
 * with `index.ts` (this descriptor, no React) and `render.tsx` (the renderer).
 * The registry, renderer barrel, core name list and skill table are all
 * generated from these directories by `scripts/component-docs.ts`; nothing
 * about a component is listed by hand anywhere else.
 */

import type { ZodObject, ZodRawShape, z } from 'zod'
import type { ComponentDiagnosticCode } from './declaration'

export interface ComponentDescriptor<Shape extends ZodRawShape = ZodRawShape> {
  /** `^[a-z][a-z0-9-]*$`; the second info-string token before `@`. */
  type: string
  /** Positive integer major version. */
  version: number
  /** One line: what it shows. */
  description: string
  /** When it is the right choice and when it is not (skill table). */
  useWhen: string
  /**
   * Payload schema. `.describe()` on each field supplies the "meaning" column
   * of the generated table. Must not declare `script`, `code` or `__*` keys.
   */
  schema: ZodObject<Shape>
  /**
   * Cross-field checks that `schema` cannot carry: `schema` stays a plain
   * `ZodObject` so the generator can read its shape, which rules out the
   * `ZodEffects` a top-level `superRefine` would produce. The registry runs
   * this as a `superRefine` after a successful parse, so `ctx.addIssue`
   * paths (`['views', 0, 'x']`) name the failing field exactly as the schema
   * itself would.
   */
  refine?: (data: z.infer<ZodObject<Shape>>, ctx: z.RefinementCtx) => void
  /** One complete, valid block in the `<lang> <type>@<N> #<id>` form. */
  example: string
  /** Wrong blocks paired with the diagnostic code each must produce. */
  invalidExamples: readonly { block: string; code: ComponentDiagnosticCode }[]
  /** Project-relative fixture documents that contain this type@version. */
  fixtures: readonly string[]
}

export type ComponentData<D> = D extends ComponentDescriptor<infer S> ? z.infer<ZodObject<S>> : never

/** Identity of the containing document, when the surface knows it. */
export interface ComponentDocumentRef {
  /** Project name (plus host for central mirrors). */
  project: string
  host?: string
  /** Project-relative path of the Markdown file. */
  path: string
}

/** What every renderer receives besides its validated data. */
export interface ComponentBlockContext {
  type: string
  version: number
  /** `#<id>` token, or null. */
  id: string | null
  /** 1-based line of the opening fence in the rendered body. */
  line: number
  /** Payload as written (identity guard for in-place rewrites). */
  payload: string
  /** True when the payload carries `script`/`code`. */
  executable: boolean
  document: ComponentDocumentRef | null
  /**
   * URL of a document-relative (or absolute-in-root) resource through the
   * document asset route, or null when the surface has no document.
   */
  resourceUrl: (relativeOrAbsolutePath: string) => string | null
}

export interface ComponentRendererProps<Data> {
  data: Data
  block: ComponentBlockContext
}

export type ComponentRenderer<Data> = (props: ComponentRendererProps<Data>) => React.ReactNode

/** Helper that pins `Data` to the schema so `render.tsx` stays in sync. */
export function defineComponent<Shape extends ZodRawShape>(
  descriptor: ComponentDescriptor<Shape>,
): ComponentDescriptor<Shape> {
  return descriptor
}
