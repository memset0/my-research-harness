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
          return summary && (summary.run.hasReadme || summary.run.recordFormat === 'json')
            ? {
                path,
                status: summary.run.frontMatter.status,
                deprecated: summary.run.frontMatter.deprecated,
                active: summary.run.metadata?.active ?? false,
                assessment: summary.run.metadata?.assessment,
              }
            : null
        }),
      )),
    )
  if (description?.format === 'lightweight') {
    const known = members.filter((run) => run !== null)
    const runningRunCount = known.filter((run) => run.status === 'RUNNING').length
    const prefix = `logs/${frontMatter.id.slice(0, 5)}/`
    const variants = [
      ...new Set(
        known
          .filter((item) => item.active && item.path.startsWith(prefix))
          .map((item) => item.path.slice(prefix.length).split('/')[0]!),
      ),
    ].filter(
      (id) =>
        id !== 'smoke' &&
        id !== 'V0000' &&
        !description.variants.find((variant) => variant.id === id)?.deprecated,
    )
    const selected = known.filter((item) => item.active && !item.deprecated)
    const currentRunningRunCount = selected.filter(
      (item) => item.status === 'RUNNING' && !item.path.includes('/smoke/'),
    ).length
    const completed =
      variants.length > 0 &&
      variants.every((id) => {
        const runs = selected.filter((item) => item.path.startsWith(`${prefix}${id}/`))
        return (
          runs.length > 0 &&
          runs.every((item) => item.status === 'FINISHED' && item.assessment?.kind !== 'INVALID')
        )
      })
    return {
      displayStatus:
        frontMatter.status === 'ACTIVE'
          ? runningRunCount
            ? ('RUNNING' as const)
            : completed
              ? ('COMPLETED' as const)
              : ('ACTIVE' as const)
          : frontMatter.status,
      runningRunCount,
      currentRunningRunCount,
      requiredVariantCount: variants.length,
    }
  }
  const valid = description && !researchDescriptionProblem(description, frontMatter.runs)
  const { lifecycle: _, ...projection } = projectExperimentLifecycle(
    frontMatter.status,
    valid ? description : null,
    members.filter((run) => run !== null),
  )
  return projection
}
