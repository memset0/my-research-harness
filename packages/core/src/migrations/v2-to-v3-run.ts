// v2 → v3 deterministic run README rewrite.
//
// This is the mechanical part of the v2→v3 migration that transforms a
// single run README, AFTER the user has decided which exp doc to bind it
// to (or left it unbound). The clustering / user-confirm phase lives
// outside this function — see `packages/core/migrations/v2-to-v3.md`
// for the full agent-facing recipe.
//
// Transform:
//   - Frontmatter: drop `project`, `hypotheses`, `tags`; add
//     `experiment` (caller-supplied; null for unbound) + `updated_at`
//     (caller-supplied migration timestamp).
//   - Body: keep only `## Setup` / `## Result` / `## Artifacts`. The
//     legacy run-level Motivation / Method / Conclusion / Caveats /
//     Warnings / New Hypotheses sections are stripped — those concerns
//     belong on the parent exp doc in v3.
//
// The output is byte-canonical (it always passes through the v3
// `serializeReadme` pretty-printer) so re-running the rewrite on a v3
// README is a no-op modulo `updated_at`.

import { patchRunFrontMatter } from '../readme/frontmatter-patch.js'
import { parseReadme } from '../readme/parse.js'
import { serializeReadme } from '../readme/serialize.js'

export interface RewriteV2RunInput {
  /** Raw v2 README content (entire file, frontmatter + body). */
  v2Content: string
  /** v3 exp doc id to bind to, or null to leave the run unbound. */
  experiment: string | null
  /** ISO8601 with offset; written into the new `updated_at` field. */
  migrationTime: string
}

export function rewriteV2RunReadme(input: RewriteV2RunInput): string {
  const parsed = parseReadme(input.v2Content)

  // Set v3 fields. parseReadme already populates the legacy fields
  // (project / hypotheses / tags) on parsed.frontMatter, but the v3
  // serializer (post task 4.2) doesn't emit them — so we don't need
  // to clear them here, just set the v3 ones.
  parsed.frontMatter.experiment = input.experiment
  parsed.frontMatter.updatedAt = input.migrationTime

  // Strip body sections that move to the exp doc in v3.
  parsed.sections.motivation = null
  parsed.sections.method = null
  parsed.sections.conclusion = null
  parsed.sections.caveats = null
  parsed.sections.newHypotheses = null
  // Warnings on the run side: parseReadme reads them into
  // parsed.warnings separately from sections; the serializer doesn't
  // emit a `## Warnings` heading for the run side anyway.

  const intermediate = serializeReadme({
    frontMatter: parsed.frontMatter,
    sections: parsed.sections,
  })

  // The serializer emits placeholder `## Heading\n\n` blocks for the
  // four cleared sections. Strip them so the v3 run README contains
  // only Setup / Result / Artifacts.
  return stripEmptyHeadings(
    patchRunFrontMatter(intermediate, { experiment: JSON.stringify(input.experiment) }),
    ['Motivation', 'Method', 'Conclusion', 'Caveats'],
  )
}

function stripEmptyHeadings(content: string, headings: readonly string[]): string {
  let out = content
  for (const h of headings) {
    const pat = new RegExp(`(^|\\n)## ${escapeRegExp(h)}\\s*\\n+(?=## |$)`, 'g')
    out = out.replace(pat, (_m, prefix) => (typeof prefix === 'string' ? prefix : ''))
  }
  return out
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
