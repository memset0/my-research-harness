/** Source-published navigation. No document bodies or machine-specific paths. */
import { randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { basename, dirname, join, relative } from '@memon/file-protocol/paths'
import { z } from 'zod'
import {
  BackendExperimentSummarySchema,
  BackendReportSummarySchema,
  BackendWikiSummarySchema,
} from './backend-protocol.js'
import { parseContent } from './content.js'
import { defaultIndexFs, type IndexFs } from './derived-index/fs.js'
import { ensureIndexDirectory } from './derived-index/gitignore.js'
import { resolveIndexPaths } from './derived-index/paths.js'
import type { IndexSnapshot } from './derived-index/schema.js'
import { IsoTimestampSchema, RelativePathSchema } from './derived-index/schema.js'
import { projectFs } from './project-file-store.js'
import { deriveVariantStatus } from './results/summary.js'
import { formatIsoLocal } from './time.js'
import { parseWikiFrontmatter } from './wiki/frontmatter.js'
import { buildWikiSummary } from './wiki/summary.js'

export const PROJECT_CATALOG_KINDS = ['experiments', 'wiki', 'reports'] as const
export type ProjectCatalogKind = (typeof PROJECT_CATALOG_KINDS)[number]
export const ProjectCatalogEntrySchema = z
  .object({
    id: z.string().min(1),
    slug: z.string(),
    resource: RelativePathSchema,
    summary: z.record(z.unknown()),
  })
  .strict()
const ExperimentSummarySchema = BackendExperimentSummarySchema.omit({
  mtime: true,
  sections: true,
  warningsRaw: true,
  frontMatter: true,
}).extend({
  frontMatter: BackendExperimentSummarySchema.shape.frontMatter.omit({
    runs: true,
    hypotheses: true,
  }),
  runCount: z.number().nonnegative(),
  hypothesisCount: z.number().nonnegative(),
  openWarningCount: z.number().nonnegative(),
})

export const ProjectCatalogSchema = z
  .object({
    catalog_version: z.literal(1),
    kind: z.enum(PROJECT_CATALOG_KINDS),
    generated_at: IsoTimestampSchema,
    entries: z.array(ProjectCatalogEntrySchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>()
    for (const [i, entry] of value.entries.entries()) {
      const prefix = value.kind === 'experiments' ? 'E' : value.kind === 'wiki' ? 'W' : 'R'
      if (
        !new RegExp(`^${prefix}\\d{4}${prefix === 'E' ? '-[a-z0-9-]+' : ''}$`).test(entry.id) ||
        !entry.resource.startsWith(`docs/${value.kind}/`) ||
        ids.has(entry.id) ||
        (entry.summary.id !== undefined && entry.summary.id !== entry.id) ||
        (entry.summary.path !== undefined && entry.summary.path !== entry.resource) ||
        (entry.summary.resource !== undefined && entry.summary.resource !== entry.resource)
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries', i],
          message: 'Invalid or duplicate catalog identity/path',
        })
      const summary = { ...entry.summary, project: 'catalog', resource: entry.resource }
      const schema =
        value.kind === 'experiments'
          ? ExperimentSummarySchema
          : value.kind === 'wiki'
            ? BackendWikiSummarySchema
            : BackendReportSummarySchema
      const { path: _path, ...portable } = summary as typeof summary & { path?: unknown }
      if (!schema.safeParse(portable).success)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries', i, 'summary'],
          message: 'Invalid catalog summary',
        })
      ids.add(entry.id)
    }
  })
export type ProjectCatalog = z.infer<typeof ProjectCatalogSchema>
export type ProjectCatalogEntry = z.infer<typeof ProjectCatalogEntrySchema>

export async function writeProjectCatalog(
  root: string,
  kind: ProjectCatalogKind,
  entries: ProjectCatalogEntry[],
  io: IndexFs = defaultIndexFs,
): Promise<void> {
  const catalog = ProjectCatalogSchema.parse({
    catalog_version: 1,
    kind,
    generated_at: formatIsoLocal(new Date()),
    entries,
  })
  const paths = resolveIndexPaths(root)
  await ensureIndexDirectory(paths, { fs: io })
  const temporary = join(paths.dir, `.tmp-${kind}-${randomUUID()}`)
  try {
    await io.writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    await io.rename(temporary, join(paths.dir, `${kind}.json`))
  } catch (error) {
    await io.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export function experimentCatalogEntries(snapshot: IndexSnapshot): ProjectCatalogEntry[] {
  return Object.entries(snapshot.experiments)
    .map(([key, entry]) => {
      const resource = key.endsWith('.md') ? key : `${key}/README.md`
      const owned =
        entry.format === 'lightweight'
          ? Object.entries(snapshot.runs).filter(([path]) =>
              path.startsWith(`logs/${entry.id.slice(0, 5)}/`),
            )
          : entry.runs.flatMap((path) =>
              snapshot.runs[path] ? [[path, snapshot.runs[path]!] as const] : [],
            )
      const running = owned.filter(([, run]) => run.status === 'RUNNING').length
      let required: number, currentRunning: number, completed: boolean
      if (entry.format === 'lightweight') {
        const selected = owned.filter(
          ([path, run]) =>
            /^V\d{4}$/.test(path.split('/')[2] ?? '') &&
            run.row.active &&
            !run.deprecated &&
            !entry.variants?.[path.split('/')[2]!]?.deprecated,
        )
        required = new Set(selected.map(([path]) => path.split('/')[2])).size
        currentRunning = selected.filter(([, run]) => run.status === 'RUNNING').length
        completed =
          required > 0 &&
          selected.every(
            ([, run]) => run.status === 'FINISHED' && run.row.assessment?.kind !== 'INVALID',
          )
      } else {
        const variants = Object.entries(entry.variants ?? {}).filter(
          ([id, v]) =>
            id !== 'V0000' && id !== 'smoke' && !v.deprecated && v.legacy_status !== 'DROPPED',
        )
        required = variants.length
        const selected = variants.flatMap(([, v]) =>
          v.active_runs.map((path) => snapshot.runs[path]),
        )
        currentRunning = selected.filter(
          (run) => run?.status === 'RUNNING' && !run.deprecated,
        ).length
        completed =
          required > 0 &&
          variants.every(
            ([, v]) =>
              deriveVariantStatus(
                v.legacy_status ?? null,
                v.active_runs.map((path) => {
                  const r = snapshot.runs[path]
                  return r
                    ? { status: r.status, deprecated: r.deprecated, stop_reason: null }
                    : null
                }),
                v.frozen_status ?? null,
              ) === 'COMPLETED',
          )
      }
      const row = entry.row
      return {
        id: entry.id,
        slug: entry.slug,
        resource,
        summary: {
          id: entry.id,
          resource,
          readmeMtime: row.readme_mtime,
          frontMatter: {
            id: entry.id,
            slug: entry.slug,
            title: row.title,
            status: entry.status,
            archived: entry.archived,
            tags: row.tags,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
          runCount: owned.length,
          hypothesisCount: 0,
          openWarningCount: row.open_warning_count,
          parseErrors: row.parse_errors,
          parseWarnings: row.parse_warnings,
          effectiveCreatedAt: row.created_at,
          effectiveUpdatedAt: row.updated_at,
          displayStatus:
            entry.status === 'ACTIVE'
              ? (entry.format === 'lightweight' ? running : currentRunning)
                ? 'RUNNING'
                : completed
                  ? 'COMPLETED'
                  : 'ACTIVE'
              : entry.status,
          requiredVariantCount: required,
          currentRunningRunCount: currentRunning,
          runningRunCount: running,
        },
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

async function contained(root: string, resource: string): Promise<string> {
  RelativePathSchema.parse(resource)
  const [realRoot, path] = await Promise.all([
    projectFs.realpath(root),
    projectFs.realpath(join(root, resource)),
  ])
  const rel = relative(realRoot, path)
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('/') || rel.includes('\\'))
    throw new Error('Catalog source escapes project')
  return path
}

export async function publishWikiCatalog(
  root: string,
  snapshot: IndexSnapshot,
  io: IndexFs = defaultIndexFs,
): Promise<void> {
  const entries: ProjectCatalogEntry[] = []
  for (const resource of Object.keys(snapshot.wiki)) {
    const path = await contained(root, resource)
    const [text, stat] = await Promise.all([io.readFile(path, 'utf8'), io.stat(path)])
    const format = /\/(README\.md|manifest\.json)$/.test(resource)
      ? ('bundle' as const)
      : ('markdown' as const)
    const stem = format === 'bundle' ? basename(dirname(resource)) : basename(resource, '.md')
    const match = /^(W\d{4})-(.+)$/.exec(stem)
    if (!match) throw new Error(`Invalid Wiki catalog source: ${resource}`)
    const kind = resource.split('/')[2]!
    const { frontmatter, body } = parseWikiFrontmatter(text, resource)
    const summary = {
      ...buildWikiSummary({
        location: {
          id: match[1]!,
          slug: match[2]!,
          kind,
          format,
          path: resource,
          mtime: stat.mtimeMs,
        },
        frontmatter,
        body,
      }),
      ...parseContent(text, resource, kind).fields,
    }
    entries.push({ id: summary.id, slug: summary.slug, resource, summary: { ...summary } })
  }
  await writeProjectCatalog(root, 'wiki', entries, io)
}

export async function publishReportCatalog(
  root: string,
  io: IndexFs = defaultIndexFs,
): Promise<void> {
  const entries: ProjectCatalogEntry[] = []
  const walk = async (resource: string, categories: boolean): Promise<void> => {
    let paths: Dirent[]
    try {
      const dir = await contained(root, resource)
      paths = await io.readdir(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const item of paths) {
      const bundle = item.isDirectory()
      const match = (
        bundle ? /^(R\d{4})-([a-z0-9][a-z0-9-]*)$/ : /^(R\d{4})-([a-z0-9][a-z0-9-]*)\.md$/
      ).exec(item.name)
      if (!match) {
        if (categories && bundle && !item.name.startsWith('.'))
          await walk(`${resource}/${item.name}`, false)
        continue
      }
      let entry = `${resource}/${item.name}`
      if (bundle) {
        const children = await io.readdir(await contained(root, entry))
        if (!children.includes('manifest.json') && !children.includes('README.md')) continue
        entry += children.includes('manifest.json') ? '/manifest.json' : '/README.md'
      }
      const path = await contained(root, entry)
      const [text, stat] = await Promise.all([io.readFile(path, 'utf8'), io.stat(path)])
      const parsed = parseContent(
        text,
        entry,
        resource === 'docs/reports' ? undefined : basename(resource),
      )
      if (parsed.errors.length)
        throw new Error(`Invalid Report ${match[1]}: ${parsed.errors.join('; ')}`)
      const title = String(
        parsed.metadata.title ?? /^#\s+(.+)$/m.exec(text)?.[1] ?? match[2],
      ).slice(0, 512)
      entries.push({
        id: match[1]!,
        slug: match[2]!,
        resource: entry,
        summary: {
          ...parsed.fields,
          id: match[1]!,
          slug: match[2]!,
          resource: entry,
          title,
          mtime: stat.mtimeMs,
          format: bundle ? 'bundle' : 'markdown',
        },
      })
    }
  }
  await walk('docs/reports', true)
  entries.sort((a, b) => b.id.localeCompare(a.id))
  await writeProjectCatalog(root, 'reports', entries, io)
}
