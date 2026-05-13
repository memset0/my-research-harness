/**
 * FS_CONVENTION_VERSION — the integer version of memon's on-disk schema.
 *
 * Independent from `package.json#version`. Bumped by exactly one (never
 * skipped, never decreased) when, and only when, memon ships a breaking
 * change to the on-disk schema (renamed file, removed required field,
 * restructured directory). Non-breaking additions (new optional frontmatter
 * field, new file in a new subdirectory) MUST NOT bump this constant.
 *
 * Every bump SHALL ship with a corresponding migration guide at
 * `packages/core/migrations/v<old>-to-v<new>.md`. See
 * `openspec/specs/fs-migration-guide-authoring/spec.md` for the required
 * structure of those guides.
 */
export const FS_CONVENTION_VERSION = 4
