import { resolve } from '@memon/file-protocol/paths'

/** Project-relative location of the tracked project declaration. */
export const PROJECT_DECLARATION_RELPATH = '.memon/project.yml'

/**
 * Resolve `<projectRoot>/.memon/project.yml` and assert the result stays
 * within `projectRoot` after normalisation (as `fs-version/paths.ts` does).
 */
export function resolveProjectDeclarationPath(projectRoot: string): {
  rootAbs: string
  declarationAbs: string
} {
  const rootAbs = resolve(projectRoot)
  const declarationAbs = resolve(rootAbs, '.memon', 'project.yml')
  if (declarationAbs !== `${rootAbs === '/' ? '' : rootAbs}/.memon/project.yml`) {
    throw new Error(
      `project declaration path "${declarationAbs}" escapes project root "${rootAbs}"`,
    )
  }
  return { rootAbs, declarationAbs }
}
