import { z } from 'zod'
import { BACKEND_API_MAJOR, ReleaseVersionSchema } from './backend-protocol.js'

export const RELEASE_COMPATIBILITY_STATES = [
  'online',
  'update_available',
  'upgrade_required',
  'central_update_required',
  'filesystem_migration_required',
  'misconfigured',
] as const

export type ReleaseCompatibilityState = (typeof RELEASE_COMPATIBILITY_STATES)[number]

/** Runtime input at the central/Backend trust boundary. */
export interface ReleaseCompatibilityInput {
  centralRelease: unknown
  centralApiMajor: unknown
  backendRelease: unknown
  backendApiMajor: unknown
}

export const ReleaseCompatibilityInputSchema = z
  .object({
    centralRelease: ReleaseVersionSchema,
    centralApiMajor: z.literal(BACKEND_API_MAJOR),
    backendRelease: ReleaseVersionSchema,
    backendApiMajor: z.literal(BACKEND_API_MAJOR),
  })
  .strict()

interface ParsedRelease {
  major: number
  minor: number
}

function parseRelease(release: string): ParsedRelease | null {
  const [major, minor, patch, ...rest] = release.split('.')
  if (major === undefined || minor === undefined || patch === undefined || rest.length > 0) {
    return null
  }

  const parsed = {
    major: Number(major),
    minor: Number(minor),
  }
  return Number.isSafeInteger(parsed.major) && Number.isSafeInteger(parsed.minor) ? parsed : null
}

/**
 * Classify a Backend from the central release's point of view.
 *
 * Patch is deliberately ignored. Only the current and immediately preceding
 * Backend Minor are usable; malformed release/API metadata fails closed.
 */
export function evaluateReleaseCompatibility(
  input: ReleaseCompatibilityInput,
): ReleaseCompatibilityState {
  const validated = ReleaseCompatibilityInputSchema.safeParse(input)
  if (!validated.success) return 'misconfigured'

  const central = parseRelease(validated.data.centralRelease)
  const backend = parseRelease(validated.data.backendRelease)
  if (!central || !backend) return 'misconfigured'

  if (central.major !== backend.major) return 'filesystem_migration_required'
  if (central.minor === backend.minor) return 'online'
  if (backend.minor === central.minor - 1) return 'update_available'
  if (backend.minor < central.minor - 1) return 'upgrade_required'
  return 'central_update_required'
}
