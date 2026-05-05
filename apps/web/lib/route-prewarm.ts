// Dev-only route prewarmer.
//
// In dev, every Next route pays a cold webpack-compile tax (4–18s) on its
// first request. This module fires authenticated GETs against the common
// dashboard routes from the listen callback so the compile happens during
// boot instead of at the user's first click. Production: not called.
//
// Fire-and-forget by contract: errors are logged, never thrown. The boot
// path (server.ts) calls this WITHOUT await.

interface PrewarmOpts {
  host: string
  port: number
  projects: ReadonlyArray<{ name: string }>
  auth: { username: string; password: string }
}

const SUB_PAGES = ['', '/hypotheses', '/journal', '/reports', '/digests'] as const

function buildPaths(projects: ReadonlyArray<{ name: string }>): string[] {
  const paths: string[] = ['/api/projects']
  for (const p of projects) {
    const enc = encodeURIComponent(p.name)
    for (const sub of SUB_PAGES) {
      paths.push(`/p/${enc}${sub}`)
    }
  }
  return paths
}

function basicAuth(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64')
  return `Basic ${token}`
}

export async function prewarmRoutes(opts: PrewarmOpts): Promise<void> {
  const { host, port, projects, auth } = opts
  const authHeader = basicAuth(auth.username, auth.password)
  const base = `http://${host}:${port}`
  const paths = buildPaths(projects)

  await Promise.all(
    paths.map(async (path) => {
      const start = Date.now()
      try {
        const res = await fetch(`${base}${path}`, {
          method: 'GET',
          headers: { authorization: authHeader },
          // Drain & discard the body to free the socket promptly.
          redirect: 'manual',
        })
        // Drain the body without holding it in memory.
        await res.arrayBuffer().catch(() => {})
        const ms = Date.now() - start
        console.log(`[prewarm] GET ${path} -> ${res.status} in ${ms}ms`)
      } catch (err) {
        const ms = Date.now() - start
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[prewarm] GET ${path} -> error: ${msg} in ${ms}ms`)
      }
    }),
  )
}
