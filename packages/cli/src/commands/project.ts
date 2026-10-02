// `memon project init|lint` — create and check the tracked project
// declaration `.memon/project.yml` (FS v8).
//
// The declaration holds the project layout (`run_dirs`, `include`, `exclude`,
// `github`) once, for the CLI and central alike; central configuration keeps
// only deployment facts. Nothing writes it automatically: `init` creates it
// once (exclusive create; default patterns, the global `--run-dir` patterns,
// or the layout keys of a central Project entry with `--from-central`), the
// user reviews, edits and commits it. Neither command reads the FS marker,
// needs central or is journaled.
//
// Exit codes: `init` 0 created, 2 `BAD_REQUEST` for an unusable
// `--from-central` source, 9 `CONFLICT` when the file exists (left
// byte-identical); `lint` 0 valid or absent (central deprecation warnings do
// not count), 1 on any `PROJECT_DECLARATION_INVALID`.

import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import {
  type CentralLayoutValues,
  type CentralProjectLayout,
  ConfigError,
  DEFAULT_RUN_DIRS,
  lintProjectDeclaration,
  PROJECT_DECLARATION_RELPATH,
  readCentralProjectLayout,
  resolveProjectDeclarationPath,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { cliRunDirs } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitHuman, emitJson, type OutputFormat } from '../lib/output.js'

interface ProjectCommandInput {
  projectRoot?: string
  cwd: string
  format: OutputFormat
  /** Central `config.yml` whose Project entry supplies the layout keys. */
  fromCentral?: string
  /** Project name in the central configuration (with `fromCentral`). */
  centralProject?: string
  /** Host namespace, when the name is ambiguous (with `fromCentral`). */
  centralHost?: string
}

const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`

/** The YAML `memon project init` writes. */
export function projectDeclarationContent(
  patterns: readonly string[],
  layout: Omit<CentralLayoutValues, 'run_dirs'> = {},
  origin?: string,
): string {
  return [
    '# memon project declaration (tracked). Review, edit and commit it yourself.',
    '# It holds the project layout; central config.yml keeps only deployment',
    '# facts (root, host, storage, read_only, execution).',
    ...(origin ? [`# Layout copied from ${origin}.`] : []),
    '# run_dirs: where Run directories live, one glob per entry (`*` matches one',
    '# path segment, first segment logs/, outputs/ or experiments/).',
    'schema_version: 1',
    'run_dirs:',
    ...patterns.map((pattern) => `  - ${quote(pattern)}`),
    ...(layout.include?.length
      ? ['include:', ...layout.include.map((pattern) => `  - ${quote(pattern)}`)]
      : []),
    ...(layout.exclude?.length
      ? ['exclude:', ...layout.exclude.map((pattern) => `  - ${quote(pattern)}`)]
      : []),
    ...(layout.github?.length
      ? [
          'github:',
          ...layout.github.flatMap((mapping) => [
            `  - owner: ${quote(mapping.owner)}`,
            `    repo: ${quote(mapping.repo)}`,
            `    path: ${quote(mapping.path)}`,
          ]),
        ]
      : []),
    '',
  ].join('\n')
}

/** The central entry named by `--from-central`/`--project`/`--host`, or undefined. */
async function centralSource(
  input: ProjectCommandInput,
): Promise<CentralProjectLayout | undefined> {
  if (input.fromCentral === undefined) {
    if (input.centralProject !== undefined || input.centralHost !== undefined) {
      emitErrorAndExit('BAD_REQUEST', '--project and --host require --from-central <config>')
    }
    return undefined
  }
  if (input.centralProject === undefined) {
    emitErrorAndExit('BAD_REQUEST', '--from-central requires --project <name>')
  }
  try {
    return await readCentralProjectLayout({
      configPath: input.fromCentral,
      cwd: input.cwd,
      project: input.centralProject,
      host: input.centralHost,
    })
  } catch (error) {
    if (error instanceof ConfigError) {
      emitErrorAndExit('BAD_REQUEST', `--from-central: ${error.message}`, {
        ...(error.path ? { path: error.path } : {}),
      })
    }
    throw error
  }
}

export async function runProjectInit(input: ProjectCommandInput): Promise<void> {
  const root = singleProjectRoot(
    await resolveContext({ projectRoot: input.projectRoot, cwd: input.cwd }),
  )
  const central = await centralSource(input)
  const { declarationAbs } = resolveProjectDeclarationPath(root)
  const { run_dirs: centralRunDirs, ...layout } = central?.layout ?? {}
  const patterns = centralRunDirs ?? cliRunDirs() ?? [...DEFAULT_RUN_DIRS]
  const content = projectDeclarationContent(
    patterns,
    layout,
    // No machine path in a tracked file: name the entry, not the config location.
    central ? `the central configuration of project ${JSON.stringify(central.name)}` : undefined,
  )
  await fs.mkdir(dirname(declarationAbs), { recursive: true })
  try {
    await fs.writeFile(declarationAbs, content, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      emitErrorAndExit(
        'CONFLICT',
        `${PROJECT_DECLARATION_RELPATH} already exists; edit it by hand instead`,
        { path: declarationAbs },
      )
    }
    throw error
  }
  if (input.format === 'human') {
    emitHuman(
      [
        `created ${PROJECT_DECLARATION_RELPATH} (run_dirs: ${patterns.join(', ')}${Object.keys(layout).length > 0 ? `; also ${Object.keys(layout).join(', ')}` : ''}); review it and commit it yourself`,
        ...(central
          ? [
              `then delete the moved keys from project ${JSON.stringify(central.name)} in ${central.configPath} (until then the central values keep winning)`,
            ]
          : []),
      ].join('\n'),
    )
  } else {
    emitJson({
      ok: true,
      created: true,
      path: declarationAbs,
      relativePath: PROJECT_DECLARATION_RELPATH,
      runDirs: patterns,
      layout,
      ...(central
        ? {
            fromCentral: {
              configPath: central.configPath,
              project: central.name,
              ...(central.host ? { host: central.host } : {}),
              root: central.root,
              keys: Object.keys(central.layout),
            },
          }
        : {}),
      committed: false,
    })
  }
}

export async function runProjectLint(input: ProjectCommandInput): Promise<void> {
  const root = singleProjectRoot(
    await resolveContext({ projectRoot: input.projectRoot, cwd: input.cwd }),
  )
  const central = await centralSource(input)
  const cli = cliRunDirs()
  const lint = await lintProjectDeclaration(root, {
    ...(cli === undefined ? {} : { cliRunDirs: cli }),
    ...(central ? { central: central.layout, centralConfigPath: central.configPath } : {}),
  })
  const errors = lint.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length
  if (input.format === 'human') {
    const lines = [
      `${PROJECT_DECLARATION_RELPATH}: ${lint.present ? (errors > 0 ? 'invalid' : 'valid') : 'absent'}`,
      lint.effective
        ? `effective run_dirs: ${lint.effective.patterns.join(', ')} (${lint.effective.source})`
        : 'effective run_dirs: - (declaration invalid; walks fail closed)',
      ...(lint.layout
        ? (['include', 'exclude'] as const).map(
            (key) =>
              `effective ${key}: ${lint.layout![key].join(', ') || '-'} (${lint.layout!.sources[key]})`,
          )
        : []),
      ...(lint.layout
        ? [
            `effective github: ${lint.layout.github.map((g) => `${g.owner}/${g.repo}`).join(', ') || '-'} (${lint.layout.sources.github})`,
          ]
        : []),
      ...lint.diagnostics.flatMap((diagnostic) => [
        `[${diagnostic.severity.toUpperCase()}] ${diagnostic.code} (${diagnostic.file}${diagnostic.field ? `:${diagnostic.field}` : ''})`,
        `  ${diagnostic.message}`,
      ]),
    ]
    emitHuman(lines.join('\n'))
  } else {
    emitJson({
      ok: errors === 0,
      present: lint.present,
      path: PROJECT_DECLARATION_RELPATH,
      declaration: lint.declaration,
      effective: lint.effective,
      layout: lint.layout,
      diagnostics: lint.diagnostics,
    })
  }
  if (errors > 0) process.exitCode = 1
}
