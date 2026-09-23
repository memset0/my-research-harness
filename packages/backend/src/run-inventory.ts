// Shared Run-directory inventory for the wiki projections.
//
// Resolving bare Run citations and `@` mentions needs every Run directory of
// the Project, and on a network filesystem that walk costs seconds. Opening a
// page must not pay for it each time, nor race the rail's list for it: every
// projection of a Project shares one walk, and once an inventory exists it is
// served immediately while an age-gated walk refreshes it in the background.
// Only directory existence lives here; cited Runs are still read per request.

export const RUN_INVENTORY_REFRESH_MS = 15_000

export type RunInventoryWalk = (project: string) => Promise<readonly string[]>

interface Entry {
  paths: readonly string[] | null
  builtAt: number
  inFlight: Promise<readonly string[]> | null
}

export class RunInventory {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly walk: RunInventoryWalk,
    private readonly options: { refreshMs?: number; now?: () => number } = {},
  ) {}

  /**
   * The Project's Run directories: the cached inventory when one exists
   * (refreshing it in the background once it is older than the refresh age),
   * otherwise the one walk in flight for this Project.
   */
  get(project: string): Promise<readonly string[]> {
    const entry = this.entry(project)
    if (entry.paths === null) return entry.inFlight ?? this.refresh(project, entry)
    const refreshMs = this.options.refreshMs ?? RUN_INVENTORY_REFRESH_MS
    if (entry.inFlight === null && this.now() - entry.builtAt >= refreshMs) {
      // A failed background walk keeps the last inventory; the next request
      // after the refresh age tries again.
      this.refresh(project, entry).catch(() => undefined)
    }
    return Promise.resolve(entry.paths)
  }

  private refresh(project: string, entry: Entry): Promise<readonly string[]> {
    const walk = this.walk(project).then(
      (paths) => {
        entry.paths = paths
        entry.builtAt = this.now()
        entry.inFlight = null
        return paths
      },
      (error: unknown) => {
        entry.inFlight = null
        throw error
      },
    )
    entry.inFlight = walk
    return walk
  }

  private entry(project: string): Entry {
    let entry = this.entries.get(project)
    if (!entry) {
      entry = { paths: null, builtAt: 0, inFlight: null }
      this.entries.set(project, entry)
    }
    return entry
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}
