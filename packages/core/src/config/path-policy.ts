import { basename } from '@memon/file-protocol/paths'

/**
 * Committed configuration template maintained by humans and agents.
 * Runtime code must never treat this file as mutable instance configuration.
 */
export const CONFIG_EXAMPLE_BASENAME = 'config.example.yml'

/** Return true only for the canonical protected example-config basename. */
export function isProtectedExampleConfigPath(configPath: string): boolean {
  return basename(configPath) === CONFIG_EXAMPLE_BASENAME
}
