import type { ClusterOverviewDto } from './dto/clusters'

export class ClustersApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export async function fetchClusterOverview(refresh = false): Promise<ClusterOverviewDto> {
  const response = await fetch(refresh ? '/api/clusters?refresh=1' : '/api/clusters', {
    cache: 'no-store',
  })
  const body = (await response.json().catch(() => null)) as
    | (ClusterOverviewDto & { error?: { code?: string; message?: string } })
    | null
  if (!response.ok || !body || body.error) {
    throw new ClustersApiError(
      response.status,
      body?.error?.code ?? `HTTP_${response.status}`,
      body?.error?.message ?? 'cluster overview is unavailable',
    )
  }
  return body
}
