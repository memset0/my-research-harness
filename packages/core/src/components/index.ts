// `@memon/core` component surface: the declaration grammar and payload model
// shared with the dashboard registry, plus the executable-payload runtime
// (Python execution and the per-document result cache) the CLI, the Backend,
// and the dashboard all drive.

export {
  formatComponentDeclaration,
  parseComponentDeclaration,
  type ComponentDeclaration,
  type ComponentDeclarationResult,
  type ComponentDiagnosticCode,
} from './declaration.js'
export {
  derivePayload,
  executableFunctionName,
  parseYamlMapping,
  RESERVED_PAYLOAD_KEYS,
  RESERVED_PREFIX,
  stripHiddenKeys,
  type DerivedPayload,
  type ExecutableSpec,
  type YamlMappingResult,
} from './payload.js'
export {
  canonicalJson,
  componentAssetsDir,
  componentCachePath,
  readComponentCache,
  writeComponentCache,
  type ComponentCacheEntry,
  type ComponentCacheError,
  type WriteComponentCacheInput,
  type WriteComponentCacheResult,
} from './cache.js'
export {
  COMPONENT_RUN_DEFAULT_PYTHON,
  COMPONENT_RUN_DEFAULT_TIMEOUT_MS,
  ComponentRunError,
  listExecutableComponentBlocks,
  runDocumentComponents,
  type ComponentRunErrorCode,
  type ComponentRunRequest,
  type ComponentRunResult,
  type ExecutableComponentBlock,
} from './execute.js'
