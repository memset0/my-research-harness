import { resolve } from '@memon/file-protocol/paths'

/**
 * Resolve `<projectRoot>/.memon/version.json` and assert the result stays
 * within `projectRoot` after path normalisation. Defends against malformed
 * `projectRoot` inputs that contain `..` segments.
 */
export function resolveVersionFilePath(projectRoot: string): {
  rootAbs: string
  markerAbs: string
} {
  const rootAbs = resolve(projectRoot)
  const markerAbs = resolve(rootAbs, '.memon', 'version.json')
  if (markerAbs !== `${rootAbs}/.memon/version.json`) {
    throw new Error(`fs-version path "${markerAbs}" escapes project root "${rootAbs}"`)
  }
  return { rootAbs, markerAbs }
}
