// Build a fully-populated ExperimentIndex from a Config — this is what
// every read-only CLI command (list/show/search) calls before answering.
//
// The same logic is used by the web backend, but the web backend layers a
// Poller on top to keep the index fresh in long-running mode. CLI commands
// are short-lived and just snapshot the filesystem.

import {
  ExperimentIndex,
  discoverExperiments,
  readExperimentDir,
  type Config,
} from '@memon/core'

export interface BuildIndexOptions {
  /** Restrict to a single project by name. */
  project?: string
}

export async function buildIndex(
  config: Config,
  opts: BuildIndexOptions = {},
): Promise<ExperimentIndex> {
  const idx = new ExperimentIndex()
  for (const project of config.projects) {
    if (opts.project && project.name !== opts.project) continue
    const dirs = await discoverExperiments(project)
    await Promise.all(
      dirs.map(async (dir) => {
        try {
          const exp = await readExperimentDir(dir, project.name)
          idx.set(exp)
        } catch {
          // Skip unreadable directories silently — they show up in the index
          // as missing rather than crashing the whole listing.
        }
      }),
    )
  }
  return idx
}
