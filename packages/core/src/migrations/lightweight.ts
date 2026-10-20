import { promises as fs } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import matter from 'gray-matter'
import { z } from 'zod'
import { listExperimentPaths } from '../experiments/discover.js'
import { sha1 } from '../experiments/mutations.js'
import { parseExperimentReadme } from '../experiments/parse.js'
import { resolveDeclaredRunPath } from '../experiments/run-path.js'
import { withFileWriterLock } from '../file-writer-lock.js'
import { patchRunFrontMatter } from '../readme/frontmatter-patch.js'
import { parseReadme } from '../readme/parse.js'
import { splitH2Sections } from '../readme/sections.js'
import { parseExperimentDescription } from '../results/description.js'
import { lightweightRunPath } from '../results/lightweight.js'
import { interpretResultText, parseResultFile } from '../results/result-file.js'
import { parseRunMetadata, serializeRunMetadata } from '../runs/metadata.js'
import { formatIsoLocal, formatRunStamp } from '../time.js'
import { matterOptions } from '../yaml-engine.js'

const PlanSchema = z
  .object({
    experiment: z.string().regex(/^E\d{4}-[a-z0-9][a-z0-9-]*$/),
    created_at: z.string(),
    sources: z.record(z.string()),
    readme: z.string(),
    description: z.record(z.unknown()),
    runs: z.array(
      z
        .object({
          from: z.string().nullable(),
          to: z.string(),
          metadata: z.record(z.unknown()),
        })
        .strict(),
    ),
    remove: z.array(z.string()).default([]),
  })
  .strict()
export type LightweightMigrationPlan = z.infer<typeof PlanSchema>

async function contained(root: string, path: string, missing = false): Promise<string> {
  const target = resolve(root, path)
  if (relative(root, target).startsWith(`..${sep}`) || target === dirname(root))
    throw new Error('Migration path escapes root')
  let real: string
  try {
    real = await fs.realpath(target)
  } catch (error) {
    if (!missing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await contained(root, dirname(target), true)
    return target
  }
  const rel = relative(root, real)
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Migration symlink escapes root')
  return target
}

/** Produce a reviewable, experiment-scoped plan. No files are modified. */
export async function planLightweightMigration(
  projectRoot: string,
  experiment: string,
): Promise<LightweightMigrationPlan> {
  if (!/^E\d{4}-[a-z0-9][a-z0-9-]*$/.test(experiment)) throw new Error('Use the full Experiment ID')
  const root = await fs.realpath(projectRoot)
  const directory = `docs/experiments/${experiment}`
  const sources: Record<string, string> = {}
  const read = async (path: string) => {
    const content = await fs.readFile(await contained(root, path), 'utf8')
    sources[path] = sha1(content)
    return content
  }
  const original = await read(`${directory}/README.md`)
  const doc = parseExperimentReadme(original, experiment)
  const sourceDescription = JSON.parse(await read(`${directory}/experiment.json`))
  const old = parseExperimentDescription(JSON.stringify(sourceDescription)).data
  if (!old || old.format === 'lightweight') throw new Error('Expected a valid legacy Experiment')
  if (old.research && old.research.versions.length > 1)
    throw new Error('Split or review historical research generations before scoped migration')
  const raw = matter(original, matterOptions)
  delete raw.data.runs
  delete raw.data.implementation
  delete raw.data.investigation
  delete raw.data.results
  const variants: Record<string, Record<string, unknown>> = {}
  const runs: LightweightMigrationPlan['runs'] = []
  const assigned = new Set<string>()
  for (const variant of old.variants) {
    const smoke = /smoke/i.test(`${variant.name} ${variant.id}`)
    const id = smoke ? 'smoke' : variant.id
    const target: Record<string, unknown> = {}
    if (!smoke && (variant.deprecated || variant.status === 'DROPPED')) {
      target.deprecated = true
      target.deprecation = variant.deprecation ?? {
        reason: 'Previously DROPPED; inspect historical limitations before reuse.',
        deprecated_at: formatIsoLocal(new Date()),
      }
      variants[id] = target
    }
    if (smoke)
      variants[variant.id] = {
        deprecated: true,
        deprecation: {
          reason: 'Legacy smoke identity; executions now belong to smoke.',
          deprecated_at: formatIsoLocal(new Date()),
        },
      }
    if (!variant.runs.length && !smoke) {
      const runId = `prepared-${id.toLowerCase()}-${formatRunStamp(new Date())}`
      runs.push({
        from: null,
        to: lightweightRunPath(experiment, id, runId),
        metadata: {
          id: runId,
          status: 'READY',
          active: !target.deprecated,
          created_at: formatIsoLocal(new Date()),
          name: variant.name,
          ...(variant.description ? { description: variant.description } : {}),
          params: Object.fromEntries(
            Object.entries(variant.values)
              .filter(([path]) => path.startsWith('params.'))
              .map(([path, value]) => [path.slice(7), value]),
          ),
        },
      })
    }
    for (const path of variant.runs) {
      if (assigned.has(path))
        throw new Error(
          `Run belongs to multiple Variants: ${path}; resolve explicitly before migration`,
        )
      assigned.add(path)
      if (!doc.frontMatter.runs.includes(path))
        throw new Error(`Variant Run is absent from Experiment membership: ${path}`)
      await resolveDeclaredRunPath(root, path)
      const content = await read(`${path}/README.md`)
      const run = parseReadme(content)
      if (run.parseErrors.length)
        throw new Error(
          `Invalid Run ${path}: ${run.parseErrors.map((issue) => issue.message).join('; ')}`,
        )
      if (run.frontMatter.status === 'RUNNING' || run.frontMatter.status === 'PENDING')
        throw new Error(`Run ${path} is running or queued; stop and verify before moving it`)
      const fm = matter(content, matterOptions).data
      const metadata: Record<string, unknown> = {
        ...fm,
        id: basename(path),
        status: run.frontMatter.status,
      }
      for (const key of ['experiment', 'hypotheses', 'tags', 'deprecated', 'archived'])
        delete metadata[key]
      for (const key of ['created_at', 'updated_at', 'started_at', 'finished_at']) {
        if (metadata[key] === null || metadata[key] === '') delete metadata[key]
        if (typeof metadata[key] === 'string') metadata[key] = metadata[key].replace(/Z$/, '+00:00')
      }
      const parsed = parseRunMetadata(JSON.stringify(metadata))
      if (!parsed.data)
        throw new Error(
          `Run ${path} needs explicit metadata repair: ${parsed.issues.map((issue) => issue.message).join('; ')}`,
        )
      const to = lightweightRunPath(experiment, id, basename(path))
      const active =
        !smoke &&
        !target.deprecated &&
        !run.frontMatter.deprecated &&
        run.frontMatter.status === 'FINISHED'
      metadata.active = active
      metadata.legacy_variant_id = variant.id
      const sections = splitH2Sections(run.body)
      const imported = [
        ...(sections.preamble.trim() ? [{ title: 'Preamble', body: sections.preamble }] : []),
        ...sections.entries.map((entry) => ({ title: entry.heading, body: entry.body })),
      ]
      if (imported.length) metadata.legacy_sections = imported
      if (variant.description || fm.stop_reason)
        metadata.description = [variant.description, fm.stop_reason].filter(Boolean).join(' ')
      try {
        const csv = parseResultFile(await read(`${path}/result.csv`), `${path}/result.csv`)
        const params = Object.fromEntries(
          csv.rows
            .filter((row) => row.path.startsWith('params.') && !row.stat)
            .map((row) => {
              const column = old.columns.find((column) => column.path === row.path)
              const parsed = interpretResultText(
                row.value,
                column?.type ?? 'string',
                column?.options,
              )
              return [row.path.slice(7), parsed.ok ? parsed.value : row.value]
            }),
        )
        if (Object.keys(params).length) metadata.params = params
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      runs.push({ from: path, to, metadata })
    }
    if (
      !smoke &&
      runs.filter(
        (run) => run.to.startsWith(`logs/${experiment.slice(0, 5)}/${id}/`) && run.metadata.active,
      ).length > 1
    )
      throw new Error(
        `${id} has multiple eligible Runs; select inputs or define aggregate_variant.py explicitly before migration`,
      )
  }
  if (doc.frontMatter.runs.some((path) => !assigned.has(path)))
    throw new Error('Experiment has Runs without a Variant; assign them before migration')
  for (const [id, path] of await listExperimentPaths(root)) {
    if (id === experiment) continue
    const other = parseExperimentReadme(await fs.readFile(await contained(root, path), 'utf8'), id)
    if (other.frontMatter.runs.some((path) => assigned.has(path)))
      throw new Error(`Shared Run ownership with ${id}; copy or resolve the evidence first`)
  }
  for (const file of ['implementation.yaml', 'investigation.yaml']) {
    try {
      await read(`${directory}/${file}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return {
    experiment,
    created_at: formatIsoLocal(new Date()),
    sources,
    readme: patchRunFrontMatter(original, { runs: null }),
    description: {
      format: 'lightweight',
      groups: sourceDescription.groups ?? {},
      columns: sourceDescription.columns ?? [],
      variants,
    },
    runs,
    remove: [],
  }
}

/** Explicit reviewed plan application; source changes roll back on a failed step. */
export async function applyLightweightMigration(
  projectRoot: string,
  input: unknown,
): Promise<{ experiment: string; runs: number; backup: string }> {
  const plan = PlanSchema.parse(input)
  const root = await fs.realpath(projectRoot)
  return withFileWriterLock(root, async () => {
    const directory = `docs/experiments/${plan.experiment}`
    const description = parseExperimentDescription(JSON.stringify(plan.description)).data
    if (description?.format !== 'lightweight')
      throw new Error('Plan must contain a valid lightweight declaration')
    const before = new Map<string, string>()
    for (const [path, hash] of Object.entries(plan.sources)) {
      if (
        !path.startsWith(`${directory}/`) &&
        !plan.runs.some(
          (run) => path === `${run.from}/README.md` || path === `${run.from}/result.csv`,
        )
      )
        throw new Error('Unscoped plan source')
      const content = await fs.readFile(await contained(root, path), 'utf8')
      if (sha1(content) !== hash) throw new Error(`CONFLICT: ${path} changed after planning`)
      before.set(path, content)
    }
    for (const path of [`${directory}/README.md`, `${directory}/experiment.json`])
      if (!before.has(path)) throw new Error(`Missing source fingerprint: ${path}`)
    for (const path of plan.remove)
      if (
        !before.has(path) ||
        ![`${directory}/implementation.yaml`, `${directory}/investigation.yaml`].includes(path)
      )
        throw new Error('Only fingerprinted optional phase documents may be removed')
    const targets = new Set<string>()
    for (const run of plan.runs) {
      if (run.from !== null && !before.has(`${run.from}/README.md`))
        throw new Error('Missing Run source fingerprint')
      const original = run.from === null ? null : parseReadme(before.get(`${run.from}/README.md`)!)
      if (original && ['RUNNING', 'QUEUED', 'PENDING'].includes(original.frontMatter.status))
        throw new Error('Refusing to move running or queued work')
      const match = /^logs\/(E\d{4})\/(V\d{4}|smoke)\/([^/]+)$/.exec(run.to)
      if (
        !match ||
        match[1] !== plan.experiment.slice(0, 5) ||
        match[2] === 'V0000' ||
        (run.from !== null && match[3] !== basename(run.from)) ||
        targets.has(run.to)
      )
        throw new Error('Invalid or duplicate Run destination')
      targets.add(run.to)
      const metadata = parseRunMetadata(JSON.stringify(run.metadata))
      if (
        !metadata.data ||
        metadata.data.id !== match[3] ||
        typeof metadata.data.active !== 'boolean' ||
        (run.from === null && metadata.data.status !== 'READY')
      )
        throw new Error('Invalid Run metadata in plan')
      if (run.from !== null) await contained(root, run.from)
      await contained(root, run.to, true)
      try {
        await fs.lstat(join(root, run.to))
        throw new Error(`Destination exists: ${run.to}`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    const backup = `.memon/migrations/lightweight-${plan.experiment}-${Date.now()}`
    await fs.mkdir(await contained(root, backup, true), { recursive: true })
    await fs.writeFile(join(root, '.memon/migrations/.gitignore'), '*\n')
    await fs.writeFile(join(root, backup, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`)
    await fs.writeFile(
      join(root, backup, 'before.json'),
      `${JSON.stringify(Object.fromEntries(before))}\n`,
    )
    const moved: LightweightMigrationPlan['runs'] = []
    try {
      for (const run of plan.runs) {
        await fs.mkdir(dirname(join(root, run.to)), { recursive: true })
        if (run.from === null) await fs.mkdir(join(root, run.to))
        else await fs.rename(join(root, run.from), join(root, run.to))
        moved.push(run)
        await fs.writeFile(
          join(root, run.to, 'run.json'),
          serializeRunMetadata(parseRunMetadata(JSON.stringify(run.metadata)).data!),
        )
        if (run.from !== null) await fs.rm(join(root, run.to, 'README.md'))
        const csv = before.get(`${run.from}/result.csv`)
        if (csv !== undefined)
          await fs.writeFile(
            join(root, run.to, 'result.csv'),
            csv.replace(/^\$experiment_schema_version,[^\r\n]*\r?\n/m, ''),
          )
        if (run.from !== null)
          await fs.symlink(
            relative(dirname(join(root, run.from)), join(root, run.to)),
            join(root, run.from),
            'dir',
          )
      }
      await fs.writeFile(join(root, directory, 'README.md'), plan.readme)
      await fs.writeFile(
        join(root, directory, 'experiment.json'),
        `${JSON.stringify(plan.description, null, 2)}\n`,
      )
      for (const path of plan.remove) await fs.rm(join(root, path))
      return { experiment: plan.experiment, runs: moved.length, backup }
    } catch (error) {
      for (const run of moved.reverse()) {
        if (run.from === null) {
          await fs.rm(join(root, run.to), { recursive: true })
          continue
        }
        if ((await fs.lstat(join(root, run.from)).catch(() => null))?.isSymbolicLink())
          await fs.unlink(join(root, run.from))
        await fs.rm(join(root, run.to, 'run.json'), { force: true })
        await fs.rename(join(root, run.to), join(root, run.from))
      }
      for (const [path, content] of before) await fs.writeFile(join(root, path), content)
      throw error
    }
  })
}
