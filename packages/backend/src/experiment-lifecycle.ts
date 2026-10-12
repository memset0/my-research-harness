import {
  type ExperimentFrontMatter,
  isExperimentLifecycle,
  parseExperimentDescription,
  projectExperimentLifecycle,
  researchDescriptionProblem,
} from '@memon/core'
import { dirname, join } from '@memon/file-protocol/paths'
import { resolveContained } from './containment.js'
import { projectReadIndex } from './read-index.js'
import type { DeclaredRunLookup } from './results-summary.js'

/** Only description + cached member READMEs; never Results CSV or a project Run walk. */
export async function experimentLifecycle(
  root: string,
  readmePath: string,
  frontMatter: ExperimentFrontMatter,
  lookup: DeclaredRunLookup,
  maxAgeMs: number,
) {
  if (!isExperimentLifecycle(frontMatter.status)) return {}
  const path = await resolveContained(root, join(dirname(readmePath), 'experiment.json'), {
    allowMissing: true,
  })
  const description = path
    ? await projectReadIndex(root).file(
        path,
        'experiment-lifecycle-description',
        maxAgeMs,
        (content) => parseExperimentDescription(content).data,
      )
    : null
  const members = []
  const paths = [...new Set(frontMatter.runs)]
  for (let start = 0; start < paths.length; start += 16)
    members.push(
      ...(await Promise.all(
        paths.slice(start, start + 16).map(async (path) => {
          const summary = await lookup(path)
          return summary?.run.hasReadme
            ? {
                path,
                status: summary.run.frontMatter.status,
                deprecated: summary.run.frontMatter.deprecated,
              }
            : null
        }),
      )),
    )
  const valid = description && !researchDescriptionProblem(description, frontMatter.runs)
  const { lifecycle: _, ...projection } = projectExperimentLifecycle(
    frontMatter.status,
    valid ? description : null,
    members.filter((run) => run !== null),
  )
  return projection
}
