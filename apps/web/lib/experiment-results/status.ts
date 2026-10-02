// Lifecycle order of Variant statuses, used to sort the Status column. The
// type-only core import keeps this module client-safe; typing the ranks as a
// `Record<VariantStatus, number>` makes the Web fail to type-check when core
// adds a status that is not ranked here.

import type { VariantStatus } from '@memon/core'

export const VARIANT_STATUS_RANK: Readonly<Record<VariantStatus, number>> = {
  PLANNED: 0,
  BLOCKED: 1,
  RUNNING: 2,
  COMPLETED: 3,
  FAILED: 4,
  INCONCLUSIVE: 5,
  DROPPED: 6,
}

const UNKNOWN_STATUS_RANK = Object.keys(VARIANT_STATUS_RANK).length

/** Sort key of a status; an unknown status ranks after every known one. */
export function variantStatusRank(status: string): number {
  return Object.hasOwn(VARIANT_STATUS_RANK, status)
    ? VARIANT_STATUS_RANK[status as VariantStatus]
    : UNKNOWN_STATUS_RANK
}
