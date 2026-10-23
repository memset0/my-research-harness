// Web-entry configuration checks. Unguarded (no `server-only`) because the
// tsx-run custom server imports it before Next starts.

import type { Config } from '@memon/core'

/**
 * The Web app serves only Host-qualified Projects: every page lives under
 * `/<host>/<project>`. Standalone (hostless) Web serving was removed; CLI
 * commands on a project root are unaffected.
 */
export function assertHostQualifiedWebConfig(config: Pick<Config, 'projects'>): void {
  const hostless = config.projects.filter((project) => project.host === undefined)
  if (!hostless.length) return
  const names = hostless.map((project) => JSON.stringify(project.name)).join(', ')
  throw new Error(
    `memon: standalone Web serving was removed; give Project ${names} a \`host:\` in the instance config`,
  )
}
