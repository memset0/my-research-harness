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
export const FS_CONVENTION_VERSION = 6

/**
 * The product release is intentionally independent from the workspace package
 * versions. Its Major is locked to the on-disk FS convention, its Minor tracks
 * Backend/CLI changes, and its Patch tracks central-only changes.
 */
export const MEMON_RELEASE = '6.10.2' as const

const RELEASE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

/** Return the Major from a canonical `MAJOR.MINOR.PATCH` release string. */
export function parseMemonReleaseMajor(release: string): number {
  const match = RELEASE_PATTERN.exec(release)
  if (!match) {
    throw new Error(`invalid memon release ${JSON.stringify(release)}; expected MAJOR.MINOR.PATCH`)
  }
  return Number(match[1])
}

/**
 * Fail closed when a release line does not match the filesystem it can read
 * and write. Exported so release tooling can run the same invariant before it
 * builds or publishes an artifact.
 */
export function assertReleaseMajorMatchesFsConvention(
  release: string,
  fsConventionVersion = FS_CONVENTION_VERSION,
): void {
  if (!Number.isInteger(fsConventionVersion) || fsConventionVersion < 1) {
    throw new Error(
      `invalid FS_CONVENTION_VERSION ${String(fsConventionVersion)}; expected a positive integer`,
    )
  }

  const releaseMajor = parseMemonReleaseMajor(release)
  if (releaseMajor !== fsConventionVersion) {
    throw new Error(
      `memon release Major ${releaseMajor} must equal FS_CONVENTION_VERSION ${fsConventionVersion}`,
    )
  }
}

// Keep the invariant adjacent to the sole tracked release value so changing
// either constant without the other fails immediately in every package.
assertReleaseMajorMatchesFsConvention(MEMON_RELEASE)

/**
 * Builds inject the exact source revision through MEMON_REVISION. Source-tree
 * and test runs remain explicit instead of pretending an arbitrary checkout is
 * a pinned distribution.
 */
export const MEMON_REVISION = process.env.MEMON_REVISION?.trim() || 'unknown'

export interface MemonReleaseMetadata {
  release: typeof MEMON_RELEASE
  revision: string
}

export const MEMON_RELEASE_METADATA: Readonly<MemonReleaseMetadata> = Object.freeze({
  release: MEMON_RELEASE,
  revision: MEMON_REVISION,
})

/** Backward-compatible public version export, derived from the canonical release. */
export const VERSION = MEMON_RELEASE
