// `@memon/core` component surface: the declaration grammar and payload model
// shared with the dashboard registry, plus the executable-payload runtime
// (Python execution and the per-document result cache) the CLI, the Backend,
// and the dashboard all drive.

export {
  type ComponentCacheEntry,
  type ComponentCacheError,
  canonicalJson,
  componentAssetsDir,
  componentCachePath,
  readComponentCache,
  type WriteComponentCacheInput,
  type WriteComponentCacheResult,
  writeComponentCache,
} from './cache.js'
export {
  type ComponentDeclaration,
  type ComponentDeclarationResult,
  type ComponentDiagnosticCode,
  formatComponentDeclaration,
  parseComponentDeclaration,
} from './declaration.js'
export {
  COMPONENT_RUN_DEFAULT_PYTHON,
  COMPONENT_RUN_DEFAULT_TIMEOUT_MS,
  ComponentRunError,
  type ComponentRunErrorCode,
  type ComponentRunRequest,
  type ComponentRunResult,
  type ExecutableComponentBlock,
  listExecutableComponentBlocks,
  runDocumentComponents,
} from './execute.js'
export {
  type DerivedPayload,
  derivePayload,
  type ExecutableSpec,
  executableFunctionName,
  parseYamlMapping,
  RESERVED_PAYLOAD_KEYS,
  RESERVED_PREFIX,
  stripHiddenKeys,
  type YamlMappingResult,
} from './payload.js'
