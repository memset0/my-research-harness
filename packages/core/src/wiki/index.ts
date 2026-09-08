// `@memon/core` wiki surface: discovery, frontmatter, lint, evidence,
// deprecation, structural component scanning, review, and the projections the
// CLI / Backend / dashboard all serve.

export {
  maskWikiCode,
  parseWikiComponentBlocks,
  parseWikiFencedBlocks,
  WIKI_STRUCTURAL_COMPONENT_NAMES,
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
  discoverWikiPages,
  type DiscoveredWikiPage,
  type DiscoverWikiPagesOptions,
} from './discover.js'
export {
  parseWikiFrontmatter,
  serializeWikiPage,
  updateWikiFrontmatter,
  wikiDeprecationValue,
  wikiStringList,
  type ParsedWikiFrontmatter,
} from './frontmatter.js'
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
  type WikiDataBlockSources,
  type WikiPageStaleness,
  type WikiSourceContext,
  type WikiSourceIndex,
  type WikiSourceKind,
  wikiSourceKind,
  type WikiSourcePage,
  type WikiSourceReferences,
  type WikiSourceResolution,
} from './staleness.js'
export {
  buildWikiPage,
  buildWikiProject,
  buildWikiSummary,
  effectiveWikiId,
  sortWikiSummaries,
  wikiContentHash,
  wikiDisplayTitle,
  type BuildWikiSummaryInput,
  type WikiLocalProjectContext,
  type WikiProjectContext,
  type WikiProjectProjection,
  type WikiSummaryLocation,
} from './summary.js'
export * from './types.js'
