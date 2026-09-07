/**
 * Central-only registry of wiki body components.
 *
 * Every registered version stays readable, lintable, and renderable forever:
 * a pinned info string resolves to exactly that version, an unpinned one
 * resolves to the highest registered version (the structural
 * `WIKI_COMPONENT_UNPINNED` warning for that case belongs to `@memon/core`,
 * which sees only the info string), and a version below the latest is flagged
 * `outdated` so tooling can offer `memon wiki components migrate`.
 *
 * The module is deliberately free of `@memon/core` and of `node:fs`: the same
 * code resolves blocks inside the client Markdown renderer and computes
 * diagnostics on the request path.
 */

import { scanFencedBlocks } from './fence'
import { htmlEmbedV1 } from './html-embed@1'
import type { MemonDataV1 } from './memon-data@1'
import { memonDataV1 } from './memon-data@1'
import { formatWikiComponentInfoString, parseWikiComponentInfoString } from './parse-info-string'
import {
  WikiComponentBlockError,
  type WikiComponentArg,
  type WikiComponentDescriptor,
  type WikiComponentDiagnostic,
  type WikiComponentInvalidExample,
} from './types'

/** Result of looking one info string up in the registry. */
export interface WikiComponentMatch {
  name: string
  /** Version written in the info string; `null` when unpinned. */
  pinnedVersion: number | null
  /** Highest registered version of this component. */
  latestVersion: number
  /** Version that renders the block; `null` when the pin is not registered. */
  version: number | null
  descriptor: WikiComponentDescriptor | null
  /** `true` when the block renders under a version below the latest. */
  outdated: boolean
  attributes: Record<string, string>
  bareTokens: string[]
}

/** One component block of a document, resolved and validated. */
export interface WikiComponentBlock {
  /** Index among the component blocks of the document. */
  index: number
  name: string
  /** Resolved version; `null` when the pinned version is not registered. */
  version: number | null
  pinnedVersion: number | null
  latestVersion: number
  outdated: boolean
  /** 1-based line of the opening fence. */
  line: number
  info: string
  payload: string
  attributes: Record<string, string>
  /** Parsed payload, or `null` when the block is invalid and renders verbatim. */
  data: unknown
  diagnostics: WikiComponentDiagnostic[]
}

export interface WikiComponentBlockOptions {
  /** Bundle-relative existence probe for payload file references. */
  fileExists?: (relativePath: string) => boolean
}

/** Serializable projection served by `GET /api/wiki/components`. */
export interface WikiComponentDescriptorDto {
  name: string
  version: number
  /** Canonical authored form, e.g. `memon-data@1`. */
  pinned: string
  latestVersion: number
  outdated: boolean
  description: string
  args: WikiComponentArg[]
  effect: string
  useWhen: string
  example: string
  invalidExamples: WikiComponentInvalidExample[]
  fixtures: string[]
  /** `true` when a block of the previous major version migrates automatically. */
  hasMigration: boolean
}

export interface WikiComponentMigration {
  index: number
  name: string
  from: number | null
  to: number
}

/** Provenance of every `memon-data` block, keyed for `staleSources` entries. */
export interface WikiDataProvenance {
  /** Index among all component blocks. */
  index: number
  /** Index among `memon-data` blocks — the `<n>` in `data[<n>]:<source>`. */
  dataIndex: number
  sources: string[]
  capturedAt: string
}

export interface WikiComponentRegistry {
  listComponents(): WikiComponentDescriptor[]
  /** Descriptors of the latest version of each component, pinned form first. */
  listLatestComponents(): WikiComponentDescriptor[]
  /** `name` or `name@N`; unpinned resolves to the latest registered version. */
  findComponent(reference: string): WikiComponentDescriptor | null
  resolveComponent(info: string): WikiComponentMatch | null
  resolveComponentBlock(
    source: { info: string; payload: string },
    index?: number,
    line?: number,
    options?: WikiComponentBlockOptions,
  ): WikiComponentBlock | null
  listComponentBlocks(body: string, options?: WikiComponentBlockOptions): WikiComponentBlock[]
  lintComponents(body: string, options?: WikiComponentBlockOptions): WikiComponentDiagnostic[]
  listDataProvenance(body: string): WikiDataProvenance[]
  migrateComponents(body: string): { content: string; changes: WikiComponentMigration[] }
  describeComponent(descriptor: WikiComponentDescriptor): WikiComponentDescriptorDto
}

export function createWikiComponentRegistry(
  descriptors: readonly WikiComponentDescriptor[],
): WikiComponentRegistry {
  const byName = new Map<string, Map<number, WikiComponentDescriptor>>()
  for (const descriptor of descriptors) {
    const versions = byName.get(descriptor.name) ?? new Map<number, WikiComponentDescriptor>()
    if (versions.has(descriptor.version)) {
      throw new Error(`duplicate wiki component ${descriptor.name}@${descriptor.version}`)
    }
    versions.set(descriptor.version, descriptor)
    byName.set(descriptor.name, versions)
  }

  const latestVersionOf = (name: string): number | null => {
    const versions = byName.get(name)
    if (!versions) return null
    return Math.max(...versions.keys())
  }

  const resolveComponent = (info: string): WikiComponentMatch | null => {
    const parsed = parseWikiComponentInfoString(info)
    if (!parsed) return null
    const versions = byName.get(parsed.name)
    const latestVersion = latestVersionOf(parsed.name)
    if (!versions || latestVersion === null) return null
    const requested = parsed.malformedVersion ? null : (parsed.pinnedVersion ?? latestVersion)
    const descriptor = requested === null ? null : (versions.get(requested) ?? null)
    return {
      name: parsed.name,
      pinnedVersion: parsed.pinnedVersion,
      latestVersion,
      version: descriptor ? descriptor.version : null,
      descriptor,
      outdated: descriptor !== null && descriptor.version < latestVersion,
      attributes: parsed.attributes,
      bareTokens: parsed.bareTokens,
    }
  }

  const resolveComponentBlock = (
    source: { info: string; payload: string },
    index = 0,
    line = 1,
    options: WikiComponentBlockOptions = {},
  ): WikiComponentBlock | null => {
    const match = resolveComponent(source.info)
    if (!match) return null

    const diagnostics: WikiComponentDiagnostic[] = []
    const block: WikiComponentBlock = {
      index,
      name: match.name,
      version: match.version,
      pinnedVersion: match.pinnedVersion,
      latestVersion: match.latestVersion,
      outdated: match.outdated,
      line,
      info: source.info,
      payload: source.payload,
      attributes: match.attributes,
      data: null,
      diagnostics,
    }
    if (match.descriptor && match.pinnedVersion === null) {
      diagnostics.push({
        code: 'WIKI_COMPONENT_UNPINNED',
        severity: 'warn',
        message: `component block \`${match.name}\` does not pin a major version; write \`${match.name}@<N>\``,
        line,
      })
    }
    const prefix = `${match.name}@${match.version ?? match.pinnedVersion ?? match.latestVersion} block ${index}`

    if (!match.descriptor) {
      diagnostics.push({
        code: 'WIKI_COMPONENT_INVALID',
        severity: 'error',
        message: `${prefix}: version is not registered; registered versions are ${[
          ...(byName.get(match.name)?.keys() ?? []),
        ]
          .sort((left, right) => left - right)
          .map((version) => `${match.name}@${version}`)
          .join(', ')}`,
        line,
      })
      return block
    }
    if (match.bareTokens.length > 0) {
      diagnostics.push({
        code: 'WIKI_COMPONENT_INVALID',
        severity: 'error',
        message: `${prefix}: info string token \`${match.bareTokens[0]}\` is not in key=value form`,
        line,
      })
      return block
    }

    try {
      const data = match.descriptor.parsePayload(source.payload, match.attributes)
      block.data = data
      for (const diagnostic of match.descriptor.lint(data, {
        name: match.name,
        version: match.descriptor.version,
        index,
        line,
        fileExists: options.fileExists,
      })) {
        diagnostics.push({ ...diagnostic, message: `${prefix}: ${diagnostic.message}` })
      }
    } catch (cause) {
      const failure =
        cause instanceof WikiComponentBlockError
          ? cause
          : new WikiComponentBlockError(
              'WIKI_COMPONENT_INVALID',
              null,
              cause instanceof Error ? cause.message : String(cause),
            )
      diagnostics.push({
        code: failure.code,
        severity: 'error',
        message: failure.field
          ? `${prefix} field \`${failure.field}\`: ${failure.message}`
          : `${prefix}: ${failure.message}`,
        line,
      })
    }
    return block
  }

  const listComponentBlocks = (
    body: string,
    options: WikiComponentBlockOptions = {},
  ): WikiComponentBlock[] => {
    const blocks: WikiComponentBlock[] = []
    for (const fenced of scanFencedBlocks(body)) {
      const block = resolveComponentBlock(
        { info: fenced.info, payload: fenced.payload },
        blocks.length,
        fenced.line,
        options,
      )
      if (block) blocks.push(block)
    }
    return blocks
  }

  const migrateComponents = (body: string): { content: string; changes: WikiComponentMigration[] } => {
    const lines = body.split('\n')
    const changes: WikiComponentMigration[] = []
    const fenced = scanFencedBlocks(body)
    let componentIndex = 0
    const rewrites: { block: (typeof fenced)[number]; lines: string[]; change: WikiComponentMigration }[] = []

    for (const candidate of fenced) {
      const match = resolveComponent(candidate.info)
      if (!match) continue
      const index = componentIndex
      componentIndex += 1
      if (!match.descriptor) continue

      if (match.pinnedVersion === null) {
        // Pin in place so every other byte of the fence line survives.
        const openLine = lines[candidate.openIndex] as string
        const nameEnd = openLine.indexOf(match.name) + match.name.length
        rewrites.push({
          block: candidate,
          lines: [
            `${openLine.slice(0, nameEnd)}@${match.latestVersion}${openLine.slice(nameEnd)}`,
            ...lines.slice(candidate.openIndex + 1, Math.min(candidate.closeIndex + 1, lines.length)),
          ],
          change: { index, name: match.name, from: null, to: match.latestVersion },
        })
        continue
      }
      if (!match.outdated) continue

      let carried = {
        info: candidate.info,
        attributes: match.attributes,
        payload: candidate.payload,
      }
      let reached = match.descriptor.version
      const versions = byName.get(match.name)
      for (let target = match.descriptor.version + 1; target <= match.latestVersion; target += 1) {
        const step = versions?.get(target)
        const migrated = step?.migrate?.(carried)
        if (!migrated) break
        carried = {
          info: formatWikiComponentInfoString(match.name, target, migrated.attributes),
          attributes: migrated.attributes,
          payload: migrated.payload,
        }
        reached = target
      }
      if (reached === match.descriptor.version) continue

      const closing = lines[candidate.closeIndex]
      rewrites.push({
        block: candidate,
        lines: [
          `${candidate.indent}${candidate.fence}${carried.info}`,
          ...carried.payload.split('\n').map((line) => `${candidate.indent}${line}`),
          ...(closing === undefined ? [] : [closing]),
        ],
        change: { index, name: match.name, from: match.descriptor.version, to: reached },
      })
    }

    for (const rewrite of rewrites.reverse()) {
      const end = Math.min(rewrite.block.closeIndex + 1, lines.length)
      lines.splice(rewrite.block.openIndex, end - rewrite.block.openIndex, ...rewrite.lines)
      changes.unshift(rewrite.change)
    }
    return { content: lines.join('\n'), changes }
  }

  return {
    listComponents: () => [...descriptors],
    listLatestComponents: () =>
      [...byName.values()]
        .map((versions) => versions.get(Math.max(...versions.keys())) as WikiComponentDescriptor)
        .sort((left, right) => left.name.localeCompare(right.name)),
    findComponent: (reference) => {
      const at = reference.indexOf('@')
      const name = at === -1 ? reference : reference.slice(0, at)
      const versions = byName.get(name)
      if (!versions) return null
      if (at === -1) return versions.get(Math.max(...versions.keys())) ?? null
      const version = Number(reference.slice(at + 1))
      return Number.isInteger(version) ? (versions.get(version) ?? null) : null
    },
    resolveComponent,
    resolveComponentBlock,
    listComponentBlocks,
    lintComponents: (body, options) =>
      listComponentBlocks(body, options).flatMap((block) => block.diagnostics),
    listDataProvenance: (body) => {
      const provenance: WikiDataProvenance[] = []
      for (const block of listComponentBlocks(body)) {
        if (block.name !== 'memon-data' || block.data === null) continue
        const data = block.data as MemonDataV1
        provenance.push({
          index: block.index,
          dataIndex: provenance.length,
          sources: data.sources,
          capturedAt: data.capturedAt,
        })
      }
      return provenance
    },
    migrateComponents,
    describeComponent: (descriptor) => ({
      name: descriptor.name,
      version: descriptor.version,
      pinned: `${descriptor.name}@${descriptor.version}`,
      latestVersion: latestVersionOf(descriptor.name) ?? descriptor.version,
      outdated: descriptor.version < (latestVersionOf(descriptor.name) ?? descriptor.version),
      description: descriptor.description,
      args: [...descriptor.args],
      effect: descriptor.effect,
      useWhen: descriptor.useWhen,
      example: descriptor.example,
      invalidExamples: [...descriptor.invalidExamples],
      fixtures: [...descriptor.fixtures],
      hasMigration: typeof descriptor.migrate === 'function',
    }),
  }
}

/** The shipped registry: exactly `memon-data@1` and `html-embed@1`. */
export const WIKI_COMPONENT_REGISTRY = createWikiComponentRegistry([memonDataV1, htmlEmbedV1])

export const listComponents = WIKI_COMPONENT_REGISTRY.listComponents
export const listLatestComponents = WIKI_COMPONENT_REGISTRY.listLatestComponents
export const findComponent = WIKI_COMPONENT_REGISTRY.findComponent
export const resolveComponent = WIKI_COMPONENT_REGISTRY.resolveComponent
export const resolveComponentBlock = WIKI_COMPONENT_REGISTRY.resolveComponentBlock
export const listComponentBlocks = WIKI_COMPONENT_REGISTRY.listComponentBlocks
export const lintComponents = WIKI_COMPONENT_REGISTRY.lintComponents
export const listDataProvenance = WIKI_COMPONENT_REGISTRY.listDataProvenance
export const migrateComponents = WIKI_COMPONENT_REGISTRY.migrateComponents
export const describeComponent = WIKI_COMPONENT_REGISTRY.describeComponent
