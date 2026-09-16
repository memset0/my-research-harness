// `memon components run` — execute a document's executable component blocks
// and cache each result beside the document (`<stem>__assets/<id>.json`).
//
// Entirely local: the runtime lives in `@memon/core`, no central dashboard is
// contacted, and no component schema is compiled into the CLI artifact. The
// CLI only checks that the function returned a JSON object; field validation
// stays with the dashboard registry.
//
// Exit codes: 0 every requested block succeeded, 1 at least one failed,
// 2 BAD_REQUEST (unknown id, no executable blocks when ids were named, a
// block that cannot be addressed), 4 the document does not exist.

import { promises as fs } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

import { ComponentRunError, runDocumentComponents, type ComponentRunResult } from '@memon/core'

import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { EXIT } from '../lib/exit-codes.js'

export interface ComponentsRunInput {
  /** Project-relative, or absolute inside the project root. */
  document: string
  ids?: string[]
  projectRoot?: string
  cwd: string
  format?: string
}

export async function runComponentsRun(input: ComponentsRunInput): Promise<void> {
  const format = input.format ?? 'json'
  if (format !== 'json' && format !== 'human') {
    emitErrorAndExit('BAD_REQUEST', `--format must be one of json, human; got "${format}"`)
  }

  const ctx = await resolveContext(input)
  const projectRoot = singleProjectRoot(ctx)
  const project = ctx.config.projects.find((candidate) => candidate.root === projectRoot)
  const execution = project?.execution
  if (execution !== undefined && execution.kind !== 'local') {
    emitErrorAndExit(
      'BAD_REQUEST',
      `project execution is \`${execution.kind}\`; component blocks run only on a project whose execution is local`,
    )
  }

  let root: string
  try {
    root = await fs.realpath(resolve(projectRoot))
  } catch {
    emitErrorAndExit('NOT_FOUND', `project root does not exist: ${projectRoot}`)
  }
  const absolute = isAbsolute(input.document)
    ? resolve(input.document)
    : resolve(root, input.document)
  const documentPath = relative(root, absolute).split(/[/\\]/).join('/')
  if (documentPath === '' || documentPath.startsWith('..') || isAbsolute(documentPath)) {
    emitErrorAndExit('BAD_REQUEST', `document is outside the project root: ${input.document}`)
  }

  let results: ComponentRunResult[]
  try {
    results = await runDocumentComponents({
      root,
      documentPath,
      ...(input.ids && input.ids.length > 0 ? { ids: input.ids } : {}),
      ...(execution?.python === undefined ? {} : { pythonCommand: execution.python }),
      ...(execution?.component_timeout_ms === undefined
        ? {}
        : { timeoutMs: execution.component_timeout_ms }),
    })
  } catch (err) {
    if (!(err instanceof ComponentRunError)) throw err
    if (err.code === 'DOCUMENT_NOT_FOUND') {
      emitErrorAndExit('NOT_FOUND', err.message, undefined, EXIT.NOT_FOUND)
    }
    emitErrorAndExit(
      err.code,
      err.message,
      err.ids === undefined ? undefined : { executableIds: err.ids },
      EXIT.USAGE,
    )
  }

  if (format === 'json') {
    for (const result of results) process.stdout.write(`${JSON.stringify(result)}\n`)
  } else if (results.length === 0) {
    process.stdout.write(`(no executable component blocks in ${documentPath})\n`)
  } else {
    for (const result of results) {
      const error = result.error === undefined ? '' : `  ${result.error}`
      process.stdout.write(
        `${result.status.padEnd(9)} ${result.id.padEnd(24)} ${result.path}${error}\n`,
      )
    }
  }

  if (results.some((result) => result.status === 'failed')) process.exitCode = EXIT.GENERIC
}
