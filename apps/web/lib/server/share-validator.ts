// Share validation shared by the Next middleware and the custom-server central
// gateway: the central share registry first (read once per validator, an
// unreadable registry fails closed), then the caller's legacy validator for
// project-file shares issued before the registry existed.

import type { ShareValidator } from './auth/identity'
import { matchShare, type ShareRegistryRecord, shareRegistryFor } from './share-registry'

export function withShareRegistry(
  configPath: string | undefined,
  legacy: ShareValidator,
): ShareValidator {
  let records: Promise<ShareRegistryRecord[]> | null = null
  return {
    validate: async (project, token, host) => {
      if (configPath) {
        let scope: ReturnType<typeof matchShare>
        try {
          records ??= shareRegistryFor(configPath).read()
          scope = matchShare(await records, host ?? null, project, token)
        } catch {
          return false
        }
        if (scope) return scope.kind === 'project' ? true : { document: scope }
      }
      return legacy.validate(project, token, host)
    },
  }
}
