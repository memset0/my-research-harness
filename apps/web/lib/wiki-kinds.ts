import type { WikiKindDefinition } from '@memon/core'
import configuration from '@memon/core/wiki-kinds.json'

export const wikiKinds: WikiKindDefinition[] = [...configuration.kinds]
  .sort((left, right) => left.order - right.order)
  .map((kind) => ({ ...kind, policy: { ...kind.policy, requiredHeadings: [] } }))

export const wikiKindOrder = wikiKinds.map((kind) => kind.id)
