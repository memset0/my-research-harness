/**
 * On-disk schema for `<projectRoot>/.memon/version.json`. Machine-managed;
 * users should not edit it by hand.
 */
export interface FsVersionRecord {
  /** Integer; matches `FS_CONVENTION_VERSION` at the time of last install or migration. */
  fs_convention_version: number
  /** ISO8601 with timezone offset (e.g. `2026-05-04T10:00:00+08:00`). Set on first install; never updated thereafter. */
  installed_at: string
  /** ISO8601 with timezone offset; null until the first migration runs. */
  last_migrated_at: string | null
}

/**
 * Computed comparison between a project's recorded version and the bundled
 * `FS_CONVENTION_VERSION`. Used by both `memon install-skills` and skill
 * preflight checks.
 */
export type FsVersionStatus = 'uninitialised' | 'match' | 'behind' | 'ahead'
