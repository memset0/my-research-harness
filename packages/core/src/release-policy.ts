import { z } from 'zod'
import { ReleaseVersionSchema } from './backend-protocol.js'

export const RELEASE_CHANGE_SURFACES = ['central', 'cli', 'skills', 'filesystem'] as const
export type ReleaseChangeSurface = (typeof RELEASE_CHANGE_SURFACES)[number]

export interface ReleasePolicyTransition {
  previousRelease: unknown
  nextRelease: unknown
  previousFsConvention: number
  nextFsConvention: number
  changedSurfaces: readonly ReleaseChangeSurface[]
}

export type ReleaseChangeClass = 'initial' | 'central-patch' | 'cli-minor' | 'filesystem-major'

interface NumericRelease {
  major: number
  minor: number
  patch: number
}

function numericRelease(value: unknown, label: string): NumericRelease {
  const parsed = ReleaseVersionSchema.safeParse(value)
  if (!parsed.success) throw new Error(`${label} must be a canonical MAJOR.MINOR.PATCH release`)
  const [major, minor, patch] = parsed.data.split('.').map(Number)
  return { major: major!, minor: minor!, patch: patch! }
}

function assertFsConvention(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer`)
  }
}

function uniqueSurfaces(values: readonly ReleaseChangeSurface[]): Set<ReleaseChangeSurface> {
  const parsed = z.array(z.enum(RELEASE_CHANGE_SURFACES)).safeParse(values)
  if (!parsed.success) throw new Error('changedSurfaces contains an unknown release surface')
  return new Set(parsed.data)
}

/**
 * Enforce memon's release axes before a release build is allowed to publish.
 * The release tool supplies changed surfaces from its scoped artifact/diff
 * audit; this function makes a change to a distributed artifact (the CLI or
 * the bundled managed skills) inside a Patch impossible. Distributed nodes
 * install those artifacts independently through `memon update`, so no
 * fleet-revision equality is part of this policy.
 */
export function validateReleaseTransition(transition: ReleasePolicyTransition): ReleaseChangeClass {
  assertFsConvention(transition.previousFsConvention, 'previousFsConvention')
  assertFsConvention(transition.nextFsConvention, 'nextFsConvention')
  const previous = numericRelease(transition.previousRelease, 'previousRelease')
  const next = numericRelease(transition.nextRelease, 'nextRelease')
  const surfaces = uniqueSurfaces(transition.changedSurfaces)
  if (surfaces.size === 0) throw new Error('a release must identify at least one changed surface')
  if (previous.major !== transition.previousFsConvention) {
    throw new Error('previous release Major must equal previous FS convention')
  }
  if (next.major !== transition.nextFsConvention) {
    throw new Error('next release Major must equal next FS convention')
  }

  const filesystemChanged = surfaces.has('filesystem')
  const distributedChanged = surfaces.has('cli') || surfaces.has('skills')

  if (filesystemChanged) {
    if (transition.nextFsConvention !== transition.previousFsConvention + 1) {
      throw new Error('filesystem release must increment FS convention by exactly one')
    }
    if (next.major !== previous.major + 1 || next.minor !== 0 || next.patch !== 0) {
      throw new Error('filesystem release must begin the next Major at .0.0')
    }
    return 'filesystem-major'
  }

  if (
    transition.nextFsConvention !== transition.previousFsConvention ||
    next.major !== previous.major
  ) {
    throw new Error('release Major cannot change without a filesystem migration')
  }

  if (distributedChanged) {
    if (next.minor !== previous.minor + 1 || next.patch !== 0) {
      throw new Error('CLI/skills release must increment Minor by exactly one and reset Patch')
    }
    return 'cli-minor'
  }

  if (!surfaces.has('central')) {
    throw new Error('non-filesystem release must change central, the CLI, or bundled skills')
  }
  if (next.minor !== previous.minor || next.patch !== previous.patch + 1) {
    throw new Error('central-only release must increment Patch by exactly one')
  }
  return 'central-patch'
}

/** Assert the initial baseline selected by this change. */
export function validateInitialRelease(release: unknown, fsConvention: number): ReleaseChangeClass {
  assertFsConvention(fsConvention, 'fsConvention')
  const parsed = numericRelease(release, 'release')
  if (parsed.major !== fsConvention || parsed.minor !== 0 || parsed.patch !== 0) {
    throw new Error('initial release must be FS_CONVENTION_VERSION.0.0')
  }
  return 'initial'
}
