// `memon project init|lint` — create and check the tracked project
// declaration `.memon/project.yml` (FS v8).
//
// The declaration states where Run directories live (`run_dirs`) once, for
// the CLI and central alike. Nothing writes it automatically: `init` creates
// it once (exclusive create; default patterns or the global `--run-dir`
// patterns), the user reviews, edits and commits it. Neither command reads
// the FS marker, needs central or is journaled.
//
// Exit codes: `init` 0 created, 9 `CONFLICT` when the file exists (left
// byte-identical); `lint` 0 valid or absent, 1 on any
// `PROJECT_DECLARATION_INVALID`.

import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import {
  DEFAULT_RUN_DIRS,
  lintProjectDeclaration,
  PROJECT_DECLARATION_RELPATH,
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
}

/** The YAML `memon project init` writes for `patterns`. */
export function projectDeclarationContent(patterns: readonly string[]): string {
  return [
    '# memon project declaration (tracked). Review, edit and commit it yourself.',
    '# run_dirs: where Run directories live, one glob per entry (`*` matches one',
    '# path segment, first segment logs/, outputs/ or experiments/).',
    'schema_version: 1',
    'run_dirs:',
    ...patterns.map((pattern) => `  - '${pattern.replace(/'/g, "''")}'`),
    '',
  ].join('\n')
}

export async function runProjectInit(input: ProjectCommandInput): Promise<void> {
  const root = singleProjectRoot(await resolveContext(input))
  const { declarationAbs } = resolveProjectDeclarationPath(root)
  const patterns = cliRunDirs() ?? [...DEFAULT_RUN_DIRS]
  const content = projectDeclarationContent(patterns)
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
      `created ${PROJECT_DECLARATION_RELPATH} (run_dirs: ${patterns.join(', ')}); review it and commit it yourself`,
    )
  } else {
    emitJson({
      ok: true,
      created: true,
      path: declarationAbs,
      relativePath: PROJECT_DECLARATION_RELPATH,
      runDirs: patterns,
      committed: false,
    })
  }
}

export async function runProjectLint(input: ProjectCommandInput): Promise<void> {
  const root = singleProjectRoot(await resolveContext(input))
  const cli = cliRunDirs()
  const lint = await lintProjectDeclaration(root, cli === undefined ? {} : { cliRunDirs: cli })
  const errors = lint.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length
  if (input.format === 'human') {
    const lines = [
      `${PROJECT_DECLARATION_RELPATH}: ${lint.present ? (errors > 0 ? 'invalid' : 'valid') : 'absent'}`,
      lint.effective
        ? `effective run_dirs: ${lint.effective.patterns.join(', ')} (${lint.effective.source})`
        : 'effective run_dirs: - (declaration invalid; walks fail closed)',
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
      diagnostics: lint.diagnostics,
    })
  }
  if (errors > 0) process.exitCode = 1
}
