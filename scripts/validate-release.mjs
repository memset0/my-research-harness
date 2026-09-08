import {
  FS_CONVENTION_VERSION,
  MEMON_RELEASE,
  RELEASE_CHANGE_SURFACES,
  validateInitialRelease,
  validateReleaseTransition,
} from '../packages/core/dist/index.js'

const previousRelease = process.env.MEMON_PREVIOUS_RELEASE
if (!previousRelease) {
  validateInitialRelease(MEMON_RELEASE, FS_CONVENTION_VERSION)
  process.stdout.write(`memon release ${MEMON_RELEASE}: initial policy valid\n`)
  process.exit(0)
}

const previousFs = Number(process.env.MEMON_PREVIOUS_FS_CONVENTION)
const surfaces = (process.env.MEMON_CHANGED_SURFACES ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const unknown = surfaces.filter((surface) => !RELEASE_CHANGE_SURFACES.includes(surface))
if (unknown.length > 0) {
  // `backend` was a surface until the remote Backend hosting model was
  // retired; distributed artifacts are now `cli` and `skills`.
  process.stderr.write(
    `memon release: unknown changed surface(s) ${unknown.join(', ')}; accepted: ${RELEASE_CHANGE_SURFACES.join(', ')}\n`,
  )
  process.exit(1)
}

const classification = validateReleaseTransition({
  previousRelease,
  nextRelease: MEMON_RELEASE,
  previousFsConvention: previousFs,
  nextFsConvention: FS_CONVENTION_VERSION,
  changedSurfaces: surfaces,
})
process.stdout.write(`memon release ${MEMON_RELEASE}: ${classification} policy valid\n`)
