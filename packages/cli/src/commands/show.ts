// `memon show <id> [--format json|human]`
//
// In `human` mode (default for terminal use) we emit the raw README markdown
// — that's the most useful thing for a person reading on the command line.
// In `json` mode we emit a structured `{ frontMatter, body, sections }`.

import { readRunDir, resolveRunReference, serializeRunMetadata } from '@memon/core'
import { runWalkOptions } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitHuman, emitJson, type OutputFormat } from '../lib/output.js'
import { resolveConfig } from '../lib/resolver.js'

export interface ShowOptions {
  id: string
  format: OutputFormat
  projectRoot?: string
  cwd: string
}

export async function runShow(opts: ShowOptions): Promise<void> {
  const config = await resolveConfig({
    projectRoot: opts.projectRoot,
    cwd: opts.cwd,
  })
  const matches: Array<{ path: string; project: string }> = []
  for (const project of config.projects) {
    const path = await resolveRunReference({ ...project, ...runWalkOptions() }, opts.id)
    if (path) matches.push({ path, project: project.name })
  }
  if (matches.length === 0) emitErrorAndExit('NOT_FOUND', `Run "${opts.id}" not found`)
  if (matches.length > 1)
    emitErrorAndExit('BAD_REQUEST', `Run "${opts.id}" is ambiguous; select --project-root`, {
      paths: matches.map((match) => match.path),
    })
  const target = matches[0]!
  const exp = await readRunDir(target.path, target.project)

  if (opts.format === 'human') {
    if (exp.recordFormat === 'json' && exp.metadata) {
      emitHuman(serializeRunMetadata(exp.metadata).trimEnd())
      return
    }
    if (!exp.hasReadme) {
      emitHuman(`(no README.md at ${exp.path})`)
      return
    }
    // Emit the raw body with reconstructed front matter so the human can copy
    // out a file. Easiest: re-derive front matter from in-memory and emit body.
    // To keep things simple, just dump the body — front matter is shown by
    // `memon list --format json` if the user wants structured access.
    emitHuman(exp.body.trimEnd())
    return
  }

  emitJson({
    id: exp.id,
    path: exp.path,
    mtime: exp.mtime,
    hasReadme: exp.hasReadme,
    recordFormat: exp.recordFormat,
    recordPath: exp.recordPath,
    recordMtime: exp.recordMtime,
    metadata: exp.metadata,
    frontMatter: exp.frontMatter,
    sections: exp.sections,
    body: exp.body,
    parseErrors: exp.parseErrors,
    parseWarnings: exp.parseWarnings,
  })
}
