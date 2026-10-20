import { join } from 'node:path'
import {
  advanceExperimentResearchVersion,
  createLightweightVariant,
  importExperimentResearchRun,
  linkExperimentRun,
  nodeMutationFs,
  parseExperimentDescription,
  projectRunPath,
  publishMutationEvent,
  readDocumentState,
  readExperimentDoc,
  resolveExperimentId,
  resolveRunTarget,
  setExperimentVariantDeprecation,
} from '@memon/core'
import type { Command } from 'commander'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { cliIndexSink, indexWarningFields } from '../lib/index-sink.js'
import { withCliWriterLock } from '../lib/invocation.js'
import { publishLightweightWrite } from '../lib/lightweight-publication.js'
import { cliMutation } from '../lib/mutation-error.js'
import { emitJson } from '../lib/output.js'
import type { ResultsCommandGlobals } from './results-commands.js'

interface Input extends ResultsCommandGlobals {
  idOrSlug: string
}
interface LockOptions {
  expectedMtime: string
  expectedHash: string
  reason: string
}
async function target(input: Input) {
  const context = await resolveContext(input)
  const projectRoot = singleProjectRoot(context)
  const experimentId = await resolveExperimentId(projectRoot, input.idOrSlug)
  if (!experimentId) emitErrorAndExit('NOT_FOUND', `Experiment ${input.idOrSlug} not found`)
  const doc = await readExperimentDoc(projectRoot, context.config.projects[0]!.name, experimentId)
  if (!doc) emitErrorAndExit('NOT_FOUND', `Experiment ${experimentId} not found`)
  return { projectRoot, experimentId, readmePath: doc.path }
}
function lock(opts: LockOptions) {
  const expectedMtime = Number(opts.expectedMtime)
  if (!Number.isFinite(expectedMtime) || !opts.expectedHash || !opts.reason.trim())
    emitErrorAndExit('BAD_REQUEST', 'Expected mtime, hash and a nonempty reason are required')
  return { expectedMtime, expectedHash: opts.expectedHash, reason: opts.reason }
}
export async function runResearchShow(input: Input): Promise<void> {
  const t = await target(input)
  const state = await readDocumentState(nodeMutationFs, join(t.readmePath, '..', 'experiment.json'))
  const description = parseExperimentDescription(state.content).data
  if (!description) emitErrorAndExit('BAD_STATE', 'Invalid experiment.json')
  emitJson({
    experimentId: t.experimentId,
    mode:
      description.format === 'lightweight'
        ? 'lightweight'
        : description.research
          ? 'research'
          : 'legacy-fs9',
    research: description.research ?? null,
    mtime: state.mtime,
    hash: state.hash,
  })
}
export async function runResearchMutation(
  input: Input,
  operation: 'advance' | 'import' | 'deprecate' | 'restore',
  opts: LockOptions & {
    expectedVersion?: string
    version?: string
    run?: string
    variant?: string
    successor?: string
  },
): Promise<void> {
  const t = await target(input)
  return withCliWriterLock(t.projectRoot, async () => {
    const path = join(t.readmePath, '..', 'experiment.json')
    let run: Awaited<ReturnType<typeof resolveRunTarget>> = null
    if (operation === 'import') {
      run = await resolveRunTarget(t.projectRoot, opts.run!)
      if (!run)
        emitErrorAndExit('NOT_FOUND', 'Run must already exist; import never invents an execution')
      if (run.frontMatter.experiment && run.frontMatter.experiment !== t.experimentId)
        emitErrorAndExit('BAD_STATE', 'Run belongs to another Experiment')
    }
    const result = await cliMutation(() =>
      operation === 'advance'
        ? advanceExperimentResearchVersion(nodeMutationFs, t, {
            ...lock(opts),
            expectedVersion: Number(opts.expectedVersion),
          })
        : operation === 'import'
          ? importExperimentResearchRun(nodeMutationFs, t, {
              ...lock(opts),
              run: projectRunPath(t.projectRoot, run!.path),
              version: Number(opts.version),
              ...(opts.variant ? { variantId: opts.variant } : {}),
            })
          : setExperimentVariantDeprecation(nodeMutationFs, t, {
              ...lock(opts),
              variantId: opts.variant!,
              deprecated: operation === 'deprecate',
              ...(opts.successor ? { successor: opts.successor } : {}),
            }),
    )
    if (run)
      await cliMutation(() =>
        linkExperimentRun({
          fs: nodeMutationFs,
          index: cliIndexSink(t.projectRoot),
          projectRoot: t.projectRoot,
          experiment: { id: t.experimentId, path: t.readmePath },
          run: run!,
        }),
      )
    const warnings = await publishMutationEvent(
      cliIndexSink(t.projectRoot),
      `experiment.${operation}`,
      [{ path, after: result.content }],
    )
    emitJson({
      ok: true,
      experimentId: t.experimentId,
      research: result.description.research,
      previousVersion: result.previousVersion,
      currentVersion: result.currentVersion,
      mtime: result.mtime,
      hash: result.hash,
      warnings,
    })
  })
}
function locked(command: Command): Command {
  return command
    .requiredOption('--expected-mtime <number>', 'experiment.json mtime from version show')
    .requiredOption('--expected-hash <sha256>', 'experiment.json hash from version show')
    .requiredOption('--reason <text>', 'why this research decision is being made')
}
export function registerExperimentResearchCommands(
  experiment: Command,
  globals: () => ResultsCommandGlobals,
): void {
  const version = experiment
    .command('version', { hidden: true })
    .description('research versions, independent of result schema versions')
  version
    .command('show <id-or-slug>')
    .action(async (idOrSlug: string) => runResearchShow({ ...globals(), idOrSlug }))
  locked(version.command('advance <id-or-slug>'))
    .requiredOption('--expected-version <number>', 'current research version')
    .action(async (idOrSlug: string, opts) =>
      runResearchMutation({ ...globals(), idOrSlug }, 'advance', opts),
    )
  locked(version.command('import <id-or-slug> <run>'))
    .requiredOption('--version <number>', 'historical version; never current after advance')
    .option(
      '--variant <id>',
      'associate with a Variant that existed in the selected historical snapshot',
    )
    .action(async (idOrSlug: string, run: string, opts) =>
      runResearchMutation({ ...globals(), idOrSlug }, 'import', { ...opts, run }),
    )
  const variant = experiment
    .command('variant', { hidden: true })
    .description('compatibility helpers; run create now allocates a new Variant by default')
  variant
    .command('create <id-or-slug>')
    .description('prepare the first READY Run in a new Variant directory')
    .option('--id <id>', 'explicit V number (default: next available)')
    .option('--name <name>', 'short research name')
    .option('--draft <text>', 'optional explanation on the prepared Run')
    .option('--params <json>', 'partial planned parameters for the READY Run')
    .action(
      async (
        idOrSlug: string,
        opts: { id?: string; name?: string; draft?: string; params?: string },
      ) => {
        const t = await target({ ...globals(), idOrSlug })
        return withCliWriterLock(t.projectRoot, async () => {
          try {
            const result = await createLightweightVariant({
              projectRoot: t.projectRoot,
              experimentId: t.experimentId,
              ...opts,
              params: opts.params === undefined ? undefined : JSON.parse(opts.params),
            })
            const event = await publishLightweightWrite(
              t.projectRoot,
              `logs/${t.experimentId.slice(0, 5)}/${result.id}/${result.runId}`,
              result.changes,
            )
            emitJson({
              ok: true,
              id: result.id,
              runId: result.runId,
              path: `logs/${t.experimentId.slice(0, 5)}/${result.id}/${result.runId}`,
              ...indexWarningFields({ indexWarnings: event }),
            })
          } catch (error) {
            emitErrorAndExit(
              (error as { code?: string }).code === 'CONFLICT' ? 'CONFLICT' : 'BAD_REQUEST',
              (error as Error).message,
            )
          }
        })
      },
    )
  locked(variant.command('deprecate <id-or-slug> <variant>', { hidden: true }))
    .option('--successor <id>', 'replacement Variant in the same Experiment')
    .action(async (idOrSlug: string, variant: string, opts) =>
      runResearchMutation({ ...globals(), idOrSlug }, 'deprecate', { ...opts, variant }),
    )
  locked(variant.command('restore <id-or-slug> <variant>', { hidden: true })).action(
    async (idOrSlug: string, variant: string, opts) =>
      runResearchMutation({ ...globals(), idOrSlug }, 'restore', { ...opts, variant }),
  )
}
