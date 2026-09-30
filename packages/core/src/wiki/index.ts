// `@memon/core` wiki surface: discovery, frontmatter, lint, evidence,
// deprecation, structural component scanning, review, and the projections the
// CLI / Backend / dashboard all serve.

export { COMPONENT_LATEST_VERSION, COMPONENT_TYPES } from './component-names.generated.js'
export {
  maskWikiCode,
  parseWikiComponentBlocks,
  parseWikiFencedBlocks,
  type WikiFencedBlock,
} from './components.js'
export {
  findWikiDeprecatedSections,
  validateWikiDeprecation,
  validateWikiEntry,
  type WikiDeprecatedSection,
  type WikiDeprecationResult,
  type WikiSectionDeprecationResult,
} from './deprecation.js'
export {
  type DiscoveredWikiPage,
  type DiscoverWikiPagesOptions,
  discoverWikiPages,
} from './discover.js'
export {
  type ParsedWikiFrontmatter,
  parseWikiFrontmatter,
  serializeWikiPage,
  updateWikiFrontmatter,
  wikiDeprecationValue,
  wikiStringList,
} from './frontmatter.js'
export * from './kind-guidance.js'
export * from './kind-registry.js'
export {
  extractWikiReferences,
  lintWikiPage,
  lintWikiProject,
  resolvesWikiReference,
  type WikiArtifactInventory,
  type WikiLintContext,
  type WikiLintPage,
  type WikiReference,
} from './lint.js'
export * from './review.js'
export {
  collectWikiSourceReferences,
  experimentEffectiveUpdatedAtMs,
  resolveWikiSources,
  runLastChangedAtMs,
  type WikiPageStaleness,
  type WikiSourceContext,
  type WikiSourceIndex,
  type WikiSourceKind,
  type WikiSourcePage,
  type WikiSourceReferences,
  type WikiSourceResolution,
  wikiSourceKind,
} from './staleness.js'
export {
  type BuildWikiSummaryInput,
  buildWikiPage,
  buildWikiProject,
  buildWikiSummary,
  effectiveWikiId,
  sortWikiSummaries,
  type WikiLocalProjectContext,
  type WikiProjectContext,
  type WikiProjectProjection,
  type WikiSummaryLocation,
  wikiContentHash,
  wikiDisplayTitle,
} from './summary.js'
export * from './types.js'
