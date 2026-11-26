'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { ScopedShareRow } from '@/lib/dto/shares'
import { fetchAdminShares, revokeAdminShare } from '../lib/api'
import { queryKeys } from '../lib/query-keys'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

function scopeText(row: ScopedShareRow): string {
  if (row.scope.kind === 'project') return 'Project'
  return `${row.scope.kind} ${row.scope.id}`
}

function expired(row: ScopedShareRow): boolean {
  return row.expires_at !== null && Date.parse(row.expires_at) <= Date.now()
}

/** Admin area → Shares: the super admin sees every share and its creator; an admin only its own. */
export function AdminSharesPanel({ superAdmin }: { superAdmin: boolean }) {
  const client = useQueryClient()
  const shares = useQuery({ queryKey: queryKeys.adminShares(), queryFn: fetchAdminShares })
  const revoke = useMutation({
    mutationFn: revokeAdminShare,
    onSuccess: () => {
      toast.success('Share revoked')
      client.invalidateQueries({ queryKey: queryKeys.adminShares() })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })
  const rows = shares.data?.shares ?? []
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
      data-slot="admin-shares"
    >
      <h1 className="text-sm font-medium">Shares</h1>
      {shares.isError && (
        <p className="text-xs text-destructive">
          {shares.error instanceof Error ? shares.error.message : String(shares.error)}
        </p>
      )}
      {shares.isSuccess && rows.length === 0 && (
        <p className="text-xs text-muted-foreground">No shares.</p>
      )}
      {rows.length > 0 && (
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="h-8">Label</TableHead>
              <TableHead className="h-8">Project</TableHead>
              <TableHead className="h-8">Scope</TableHead>
              <TableHead className="h-8">Created</TableHead>
              <TableHead className="h-8">Expires</TableHead>
              {superAdmin && <TableHead className="h-8">Creator</TableHead>}
              <TableHead className="h-8">Status</TableHead>
              <TableHead className="h-8 w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} data-share={row.id}>
                <TableCell className="py-1">{row.label ?? '—'}</TableCell>
                <TableCell className="py-1 font-mono">
                  {row.host ? `${row.host}/` : ''}
                  {row.project}
                </TableCell>
                <TableCell className="py-1">
                  <span className="flex flex-wrap items-center gap-1">
                    {scopeText(row)}
                    {row.public && <Badge variant="outline">Public</Badge>}
                    {row.service && <Badge variant="outline">Service</Badge>}
                  </span>
                </TableCell>
                <TableCell className="py-1 text-muted-foreground">
                  {row.created_at.slice(0, 16)}
                </TableCell>
                <TableCell className="py-1 text-muted-foreground">
                  {row.expires_at ? row.expires_at.slice(0, 16) : 'Never'}
                </TableCell>
                {superAdmin && (
                  <TableCell className="py-1">
                    <span className="flex items-center gap-1">
                      {row.created_by}
                      {row.legacy && <Badge variant="outline">Legacy</Badge>}
                    </span>
                  </TableCell>
                )}
                <TableCell className="py-1">
                  <Badge variant={expired(row) ? 'outline' : 'secondary'}>
                    {expired(row) ? 'Expired' : 'Active'}
                  </Badge>
                </TableCell>
                <TableCell className="py-1 text-right">
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(row.id)}
                  >
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
