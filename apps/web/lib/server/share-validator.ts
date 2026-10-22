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
        let match: ReturnType<typeof matchShare>
        try {
          records ??= shareRegistryFor(configPath).read()
          match = matchShare(await records, host ?? null, project, token)
        } catch {
          return false
        }
        if (match) {
          const { scope } = match
          if (scope.kind === 'project') return true
          return match.service ? { document: scope, service: true } : { document: scope }
        }
      }
      return legacy.validate(project, token, host)
    },
  }
}
