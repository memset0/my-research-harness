// Strict Run eligibility metadata (the `deprecated` flag).
//
// Shared by every read path that must not treat broken metadata as
// "eligible": an unterminated or unparseable frontmatter block, a block that
// is not a mapping, or a non-boolean `deprecated` value is an error. A README
// without frontmatter is simply not deprecated.

import { splitFrontmatter } from '../frontmatter.js'
import { parseReadme } from '../readme/parse.js'

/** The `deprecated` flag of one Run README, strictly (throws on bad metadata). */
export function strictDeprecatedFlag(content: string): boolean {
  const split = splitFrontmatter(content)
  if (split.status === 'none') return false
  if (split.status === 'unterminated') {
    throw new Error('Run eligibility frontmatter is not terminated')
  }
  const parsed = parseReadme(content)
  if (parsed.parseErrors.some((issue) => issue.field === undefined)) {
    throw new Error('Run eligibility frontmatter must be a YAML mapping')
  }
  if (
    [...parsed.parseErrors, ...parsed.parseWarnings].some((issue) => issue.field === 'deprecated')
  ) {
    throw new Error('Run deprecated field must be boolean')
  }
  return parsed.frontMatter.deprecated
}

/** The eligibility error message of a README, or null when its metadata is sound. */
export function runEligibilityError(content: string): string | null {
  try {
    strictDeprecatedFlag(content)
    return null
  } catch (error) {
    return (error as Error).message
  }
}
