import type { HostAvailability, ProjectRef } from '@memon/core'
import { HostStatusBadge } from './host-status-badge'

export function CentralProjectUnavailable({
  project,
  availability,
}: {
  project: ProjectRef
  availability: HostAvailability
}) {
  return (
    <section className="flex max-w-lg flex-col items-center gap-3 text-center">
      <h1 className="font-mono text-base font-semibold">
        {project.host}/{project.project}
      </h1>
      <HostStatusBadge availability={availability} />
      <p className="text-sm text-muted-foreground">
        This Host is currently unavailable. No stale Project data is being shown.
      </p>
    </section>
  )
}
