// Read-time Run eligibility: the `deprecated` flag of declared/cited Runs.
//
// Same contract as core's `listDeprecatedRunIds` (only frontmatter matters,
// a missing Run or README is simply not deprecated, unreadable or malformed
// eligibility metadata is an error) but resolved with the Backend's
// request-scoped Run path resolver.

import { parseReadme, splitFrontmatter } from '@memon/core'

/**
 * The `deprecated` flag of one Run README, strictly: an unterminated or
 * unparseable frontmatter block, a block that is not a mapping, or a
 * non-boolean `deprecated` value is an error, never "eligible".
 */
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
