import { redirect } from 'next/navigation'
import { readIdentityFromHeaders } from '../lib/auth/request-context'
import { aggregateCentralProjects } from '../lib/central/central-projects'
import { getCentralFleet } from '../lib/central/fleet-runtime'
import { getRuntime } from '../lib/runtime'

export const dynamic = 'force-dynamic'

export default async function Home() {
  let firstProject: { host: string | null; project: string } | null = null
  let centralMode = false
  let configError: string | null = null
  try {
    const rt = await getRuntime()
    centralMode = rt.config.central !== undefined
    if (centralMode) {
      const identity = await readIdentityFromHeaders()
      const fleet = await getCentralFleet()
      const payload = await aggregateCentralProjects({
        registry: fleet.registry,
        actor:
          identity.role === 'viewer'
            ? { role: 'viewer', scopes: identity.scopeProjectRefs }
            : { role: 'owner' },
      })
      const first = payload.projects[0]
      firstProject = first ? { host: first.host, project: first.project } : null
    } else {
      const first = rt.config.projects[0]
      firstProject = first ? { host: null, project: first.name } : null
    }
  } catch (err) {
    configError = (err as Error).message
  }

  // Note: redirect() throws — call it outside the try/catch so it isn't swallowed.
  if (firstProject?.host) {
    redirect(
      `/h/${encodeURIComponent(firstProject.host)}/p/${encodeURIComponent(firstProject.project)}`,
    )
  }
  if (firstProject) redirect(`/p/${encodeURIComponent(firstProject.project)}`)

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold">memon</h1>
      {configError ? (
        <>
          <p className="mt-2 text-sm text-destructive">
            Could not load configuration: {configError}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Copy <code className="font-mono">config.example.yml</code> to{' '}
            <code className="font-mono">config.yml</code> and adjust the paths, then refresh.
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {centralMode ? 'No online projects available.' : 'No projects configured.'}
        </p>
      )}
    </main>
  )
}
