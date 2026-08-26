import {
  assertReleaseMajorMatchesFsConvention,
  ReleaseVersionSchema,
  RevisionSchema,
} from '@memon/core'

export const DISTRIBUTION_MANIFEST_VERSION = 1 as const
export const DISTRIBUTION_MANIFEST_FILENAME = 'memon-backend-manifest.json'

export interface BackendDistributionManifest {
  version: typeof DISTRIBUTION_MANIFEST_VERSION
  release: string
  revision: string
  artifactSha256: string
  platform: string
  arch: string
  nodeRange: string
  createdAt: string
}

const KEYS = [
  'version',
  'release',
  'revision',
  'artifactSha256',
  'platform',
  'arch',
  'nodeRange',
  'createdAt',
] as const
const PLATFORM = /^[a-z0-9][a-z0-9_-]{0,63}$/
const NODE_RANGE = /^[0-9.<>=|~^*xX -]{1,128}$/

export function parseBackendDistributionManifest(input: unknown): BackendDistributionManifest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('distribution manifest must be an object')
  }
  const value = input as Record<string, unknown>
  if (Object.keys(value).sort().join('\0') !== [...KEYS].sort().join('\0')) {
    throw new Error('distribution manifest fields are not exact')
  }
  if (value.version !== DISTRIBUTION_MANIFEST_VERSION)
    throw new Error('unsupported manifest version')
  const release = ReleaseVersionSchema.parse(value.release)
  assertReleaseMajorMatchesFsConvention(release)
  const revision = RevisionSchema.parse(value.revision)
  if (typeof value.artifactSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.artifactSha256)) {
    throw new Error('artifactSha256 must be a lowercase sha256')
  }
  if (typeof value.platform !== 'string' || !PLATFORM.test(value.platform))
    throw new Error('invalid platform')
  if (typeof value.arch !== 'string' || !PLATFORM.test(value.arch)) throw new Error('invalid arch')
  if (
    typeof value.nodeRange !== 'string' ||
    !NODE_RANGE.test(value.nodeRange) ||
    !/\d/.test(value.nodeRange)
  ) {
    throw new Error('invalid Node runtime range')
  }
  if (
    typeof value.createdAt !== 'string' ||
    new Date(value.createdAt).toISOString() !== value.createdAt
  ) {
    throw new Error('createdAt must be canonical ISO8601 UTC')
  }
  return {
    version: DISTRIBUTION_MANIFEST_VERSION,
    release,
    revision,
    artifactSha256: value.artifactSha256,
    platform: value.platform,
    arch: value.arch,
    nodeRange: value.nodeRange,
    createdAt: value.createdAt,
  } as BackendDistributionManifest
}

export function serializeBackendDistributionManifest(
  manifest: BackendDistributionManifest,
): string {
  return `${JSON.stringify(parseBackendDistributionManifest(manifest), null, 2)}\n`
}
