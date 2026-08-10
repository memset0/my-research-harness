export const WARNING_CLI_DEPRECATION =
  '[deprecated] warning CLI operations are deprecated; maintain the Experiment Warnings section through `memon-write-experiment-doc`.\n'

/** Permanent, non-suppressible compatibility notice for every warning CLI call. */
export function emitWarningDeprecationBanner(): void {
  process.stderr.write(WARNING_CLI_DEPRECATION)
}
