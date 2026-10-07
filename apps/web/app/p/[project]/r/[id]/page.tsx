// Legacy run URL `/p/<project>/r/<run-dir>` redirects to the new
// experiment-detail route with `?run=<run-dir>` so the corresponding
// run panel is auto-expanded. The parent is derived from Experiment
// `runs[]` declarations (FS v7), never from the Run README. A Run that no
// Experiment declares redirects to the project list page.

import { BackendRunResponseSchema } from '@memon/core'
import { permanentRedirect } from 'next/navigation'
import { getRuntime } from '../../../../../lib/server/runtime'
import { standaloneServices } from '../../../../../lib/server/standalone-services'

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
    const run = BackendRunResponseSchema.parse(
      await standaloneServices(rt.config).projects.getRun(decodedProject, decodedId),
    )
    expId = run.frontMatter.experiment ?? null
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
