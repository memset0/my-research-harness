import { redirect } from 'next/navigation'
import { getRuntime } from '../lib/runtime'

export const dynamic = 'force-dynamic'

export default async function Home() {
  let firstProject: string | null = null
  let configError: string | null = null
  try {
    const rt = await getRuntime()
    firstProject = rt.config.projects[0]?.name ?? null
  } catch (err) {
    configError = (err as Error).message
  }

  // Note: redirect() throws — call it outside the try/catch so it isn't swallowed.
  if (firstProject) redirect(`/p/${encodeURIComponent(firstProject)}`)

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
        <p className="mt-2 text-sm text-muted-foreground">No projects configured.</p>
      )}
    </main>
  )
}
