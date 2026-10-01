// Legacy run URL `/p/<project>/r/<run-dir>` redirects to the new
// experiment-detail route with `?run=<run-dir>` so the corresponding
// run panel is auto-expanded. The parent is derived from Experiment
// `runs[]` declarations (FS v7), never from the Run README. A Run that no
// Experiment declares redirects to the project list page.

import { join } from 'node:path'
import { permanentRedirect } from 'next/navigation'
import { getRuntime } from '../../../../../lib/server/runtime'

export default async function LegacyRunRedirect({
  params,
}: {
  params: Promise<{ project: string; id: string }>
}) {
  const { project, id } = await params
  const decodedProject = decodeURIComponent(project)
  const decodedId = decodeURIComponent(id)

  // CAUTION: `permanentRedirect` throws a Next.js redirect error to perform
  // the redirect; do NOT call it inside a try/catch, otherwise the throw is
  // swallowed and the function falls through to the orphan path.
  let expId: string | null = null
  try {
    const rt = await getRuntime()
    const root = rt.config.projects.find((candidate) => candidate.name === decodedProject)?.root
    const runs = rt.index.list({ project: decodedProject, includeDeprecated: true })
    // A path addresses exactly one Run; a bare Run ID only when unique, so two
    // directories sharing a base name never redirect to a guessed parent.
    const candidates = decodedId.includes('/')
      ? runs.filter((candidate) => root !== undefined && candidate.path === join(root, decodedId))
      : runs.filter((candidate) => candidate.id === decodedId)
    expId = candidates.length === 1 ? rt.withDeclaredParent(candidates[0]!) : null
  } catch {
    // runtime init failed → fall through to project list
  }
  if (expId) {
    permanentRedirect(
      `/p/${encodeURIComponent(decodedProject)}/e/${encodeURIComponent(expId)}?run=${encodeURIComponent(decodedId)}`,
    )
  }
  permanentRedirect(`/p/${encodeURIComponent(decodedProject)}`)
}
