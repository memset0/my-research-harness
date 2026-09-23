import { z } from 'zod'
import configuration from './kinds.json' with { type: 'json' }

const text = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Text must not be blank')
const uniqueTexts = z
  .array(text)
  .refine((values) => new Set(values).size === values.length, 'Duplicate values are not allowed')
const helpSchema = z
  .object({
    purpose: text,
    uses: uniqueTexts.refine((values) => values.length > 0, 'At least one use is required'),
    examples: uniqueTexts.refine((values) => values.length > 0, 'At least one example is required'),
    distinctions: text,
  })
  .strict()

export const WikiKindDefinitionSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
    order: z.number().int().nonnegative(),
    label: text,
    // Advisory headings are English-only. A translated list is rejected by its
    // own path instead of a bare unrecognized-key complaint about `zh`.
    zh: helpSchema.extend({
      headings: z.undefined({
        invalid_type_error:
          'Advisory headings exist only in English; remove the Chinese `headings` list',
      }),
    }),
    en: helpSchema.extend({ authoring: text }),
    relatedKinds: uniqueTexts,
    policy: z
      .object({
        statuses: z
          .array(z.string().regex(/^[A-Z][A-Z0-9_]*$/))
          .refine(
            (values) => new Set(values).size === values.length,
            'Duplicate statuses are not allowed',
          ),
        dateRequired: z.boolean(),
        sourcesRequired: z.boolean(),
        recommendedHeadings: uniqueTexts,
        requiredHeadings: z.array(z.never()).max(0),
        bodyEvidenceWarning: z.boolean(),
        reviewWarningStatus: text.nullable(),
      })
      .strict(),
  })
  .strict()

export const WikiKindRegistrySchema = z
  .object({
    schemaVersion: z.literal(1),
    reservedIds: uniqueTexts,
    kinds: z.array(WikiKindDefinitionSchema).min(1),
  })
  .strict()
  .superRefine((registry, context) => {
    const ids = new Set<string>()
    const orders = new Set<number>()
    const knownIds = new Set(registry.kinds.map((kind) => kind.id))
    for (const [index, kind] of registry.kinds.entries()) {
      const issue = (field: (string | number)[], message: string) =>
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['kinds', index, ...field],
          message,
        })
      if (ids.has(kind.id)) issue(['id'], `Duplicate kind ID: ${kind.id}`)
      if (registry.reservedIds.includes(kind.id)) issue(['id'], `Reserved kind ID: ${kind.id}`)
      if (orders.has(kind.order)) issue(['order'], `Duplicate order: ${kind.order}`)
      ids.add(kind.id)
      orders.add(kind.order)
      for (const related of kind.relatedKinds) {
        if (!knownIds.has(related) || related === kind.id) {
          issue(['relatedKinds'], `Invalid related kind: ${related}`)
        }
      }
      if (
        kind.policy.reviewWarningStatus !== null &&
        !kind.policy.statuses.includes(kind.policy.reviewWarningStatus)
      ) {
        issue(['policy', 'reviewWarningStatus'], 'Must reference a declared status')
      }
    }
  })

export type WikiKindDefinition = z.infer<typeof WikiKindDefinitionSchema>
export type WikiKindRegistry = z.infer<typeof WikiKindRegistrySchema>

export function parseWikiKindRegistry(value: unknown): WikiKindRegistry {
  const result = WikiKindRegistrySchema.safeParse(value)
  if (!result.success) {
    throw new Error(
      `Invalid Wiki kind registry:\n${result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('\n')}`,
    )
  }
  return {
    ...result.data,
    kinds: result.data.kinds.sort((left, right) => left.order - right.order),
  }
}

export const WIKI_KIND_REGISTRY = parseWikiKindRegistry(configuration)
export const WIKI_KIND_DEFINITIONS = WIKI_KIND_REGISTRY.kinds
export const WIKI_KINDS = WIKI_KIND_DEFINITIONS.map((kind) => kind.id)
export type WikiKind = string
export const WIKI_RESERVED_KINDS = WIKI_KIND_REGISTRY.reservedIds
export const WIKI_STATUS_BY_KIND = Object.fromEntries(
  WIKI_KIND_DEFINITIONS.map((kind) => [kind.id, kind.policy.statuses]),
) as Record<WikiKind, readonly string[]>

/** Per kind, the advisory H2s in registry order; English on every page. */
export const WIKI_RECOMMENDED_SECTIONS = Object.fromEntries(
  WIKI_KIND_DEFINITIONS.map((kind) => [kind.id, kind.policy.recommendedHeadings]),
) as Record<WikiKind, readonly string[]>

export function getWikiKind(value: string): WikiKindDefinition | undefined {
  return WIKI_KIND_DEFINITIONS.find((kind) => kind.id === value)
}

export function isWikiKind(value: unknown): value is WikiKind {
  return typeof value === 'string' && getWikiKind(value) !== undefined
}
