export {
  lintProjectDeclaration,
  type ProjectDeclarationDiagnostic,
  type ProjectDeclarationLint,
} from './lint.js'
export {
  type EffectiveRunDirs,
  loadProjectDeclaration,
  type RunDirsSourceName,
  type RunDirsSources,
  resolveEffectiveRunDirs,
  selectEffectiveRunDirs,
} from './load.js'
export { PROJECT_DECLARATION_RELPATH, resolveProjectDeclarationPath } from './paths.js'
export {
  PROJECT_DECLARATION_INVALID,
  PROJECT_DECLARATION_SCHEMA_VERSION,
  type ProjectDeclaration,
  ProjectDeclarationError,
  validateProjectDeclaration,
} from './schema.js'
