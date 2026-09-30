// `memon show <id> [--format json|human]`
//
// In `human` mode (default for terminal use) we emit the raw README markdown
// — that's the most useful thing for a person reading on the command line.
// In `json` mode we emit a structured `{ frontMatter, body, sections }`.

import { emitErrorAndExit } from '../lib/emit-error.js'
import { buildIndex } from '../lib/index-builder.js'
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
  const idx = await buildIndex(config)
  const exp = idx.get(opts.id)
  if (!exp) emitErrorAndExit('NOT_FOUND', `experiment "${opts.id}" not found`)

  if (opts.format === 'human') {
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
    frontMatter: exp.frontMatter,
    sections: exp.sections,
    body: exp.body,
    parseErrors: exp.parseErrors,
    parseWarnings: exp.parseWarnings,
  })
}
