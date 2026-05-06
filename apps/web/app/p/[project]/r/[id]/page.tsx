// Legacy run URL `/p/<project>/r/<run-dir>` redirects to the new
// experiment-detail route with `?run=<run-dir>` so the corresponding
// run panel is auto-expanded. If the run is orphan (no parent
// experiment), redirect to the project list page.

import { permanentRedirect } from 'next/navigation'
import { getRuntime } from '../../../../../lib/runtime'

export default async function LegacyRunRedirect({
  params,
}: {
  params: Promise<{ project: string; id: string }>
}) {
  const { project, id } = await params
  const decodedProject = decodeURIComponent(project)
  const decodedId = decodeURIComponent(id)

  try {
    const rt = await getRuntime()
    const run = rt.index.get(decodedId)
    const expId = run?.frontMatter.experiment ?? null
    if (expId) {
      permanentRedirect(
        `/p/${encodeURIComponent(decodedProject)}/e/${encodeURIComponent(expId)}?run=${encodeURIComponent(decodedId)}`,
      )
    }
  } catch {
    // fall through to project list
  }
  permanentRedirect(`/p/${encodeURIComponent(decodedProject)}`)
}
