import { resolve } from 'node:path'

/**
 * Resolve `<projectRoot>/.memon/shares.json` and assert the result stays
 * within `projectRoot` after path normalisation. Defends against malformed
 * `projectRoot` inputs that contain `..` segments.
 *
 * Mirrors the pattern in `fs-version/paths.ts`.
 */
export function resolveSharesFilePath(projectRoot: string): { rootAbs: string; sharesAbs: string } {
  const rootAbs = resolve(projectRoot)
  const sharesAbs = resolve(rootAbs, '.memon', 'shares.json')
  if (sharesAbs !== `${rootAbs}/.memon/shares.json`) {
    throw new Error(`shares-store path "${sharesAbs}" escapes project root "${rootAbs}"`)
  }
  return { rootAbs, sharesAbs }
}
