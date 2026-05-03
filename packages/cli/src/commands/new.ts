// `memon new <name> [--project NAME]`
//
// Thin wrapper around `createExperimentScaffold()` from @memon/core.

import { ExperimentExistsError, createExperimentScaffold } from '@memon/core'
import { resolveConfig } from '../lib/resolver.js'
import { emitError, emitHuman, emitJson } from '../lib/output.js'

export interface NewOptions {
  name: string
  project?: string
  configPath?: string
  cwd: string
  format: 'json' | 'human'
}

export async function runNew(opts: NewOptions): Promise<void> {
  const config = await resolveConfig({
    configPath: opts.configPath,
    cwd: opts.cwd,
    requireExplicit: false,
  })

  const project =
    opts.project !== undefined
      ? config.projects.find((p) => p.name === opts.project)
      : config.projects[0]
  if (!project) {
    emitError(`project "${opts.project ?? '(default)'}" not found in config`)
  }

  try {
    const result = await createExperimentScaffold({
      projectRoot: project.root,
      projectName: project.name,
      name: opts.name,
    })

    if (opts.format === 'json') {
      emitJson({ created: { id: result.id, path: result.path, project: project.name } })
    } else {
      emitHuman(`created ${result.path}`)
    }
  } catch (err) {
    if (err instanceof ExperimentExistsError) {
      emitError(err.message, 2)
    }
    throw err
  }
}
