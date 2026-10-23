import { artifactIdPrefix } from '@/lib/project-routes'

/** Repair error: two Experiment directories share the number in the URL. */
export function DuplicateExperimentNumber({ number, ids }: { number: number; ids: string[] }) {
  return (
    <main className="mx-auto max-w-2xl p-8" data-duplicate-experiment-number={number}>
      <h1 className="text-xl font-semibold">Experiment number {number} is ambiguous</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        These directories all carry {artifactIdPrefix('E', number)}. Give each Experiment its own
        number, then refresh the project index:
      </p>
      <ul className="mt-3 list-disc pl-6 font-mono text-sm">
        {ids.map((id) => (
          <li key={id}>docs/experiments/{id}</li>
        ))}
      </ul>
    </main>
  )
}

/** The Experiment catalog could not be read, so the number cannot be resolved yet. */
export function ExperimentCatalogUnavailable({ number }: { number: number }) {
  return (
    <main className="mx-auto max-w-2xl p-8" data-experiment-catalog-unavailable={number}>
      <h1 className="text-xl font-semibold">Experiment {number} is temporarily unavailable</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The project's Experiment catalog could not be read from its source. Reload the page once the
        source is reachable again.
      </p>
    </main>
  )
}
