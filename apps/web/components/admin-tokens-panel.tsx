'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import type { ApiTokenDto } from '@/lib/dto/tokens'
import { createApiToken, fetchApiTokens, revokeApiToken } from '../lib/api'
import { queryKeys } from '../lib/query-keys'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

const EXPIRY_DAYS = { never: null, '30': 30, '90': 90, '365': 365 } as const
type Expiry = keyof typeof EXPIRY_DAYS

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function when(ms: number | null): string {
  return ms === null ? '—' : new Date(ms).toLocaleString()
}

/** Admin area → API tokens: the caller's tokens (every account's for the super admin). */
export function AdminTokensPanel({ superAdmin }: { superAdmin: boolean }) {
  const client = useQueryClient()
  const tokens = useQuery({ queryKey: queryKeys.apiTokens(), queryFn: fetchApiTokens })
  const [created, setCreated] = useState<{ name: string; value: string } | null>(null)
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.apiTokens() })
  const create = useMutation({
    mutationFn: createApiToken,
    onSuccess: (result) => {
      setCreated({ name: result.token.name, value: result.value })
      void refresh()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const revoke = useMutation({
    mutationFn: revokeApiToken,
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  })
  const rows = tokens.data?.tokens ?? []
  return (
    <Card size="sm" id="tokens" className="scroll-mt-3" data-slot="admin-tokens">
      <CardHeader>
        <CardTitle>API tokens</CardTitle>
        <CardDescription>
          For the memon CLI on other machines (<code>memon login</code>). A token acts as its
          account.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <CreateForm
          pending={create.isPending}
          onSubmit={(name, expiry) => {
            const days = EXPIRY_DAYS[expiry]
            create.mutate({
              name,
              ...(days === null
                ? {}
                : { expires_at: new Date(Date.now() + days * 86_400_000).toISOString() }),
            })
          }}
        />
        {tokens.isError && <p className="text-xs text-destructive">{errorMessage(tokens.error)}</p>}
        {rows.length > 0 && (
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="h-8">Name</TableHead>
                {superAdmin && <TableHead className="h-8">Account</TableHead>}
                <TableHead className="h-8">Token</TableHead>
                <TableHead className="h-8">Created</TableHead>
                <TableHead className="h-8">Expires</TableHead>
                <TableHead className="h-8">Last used</TableHead>
                <TableHead className="h-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((token: ApiTokenDto) => (
                <TableRow key={token.id} data-token={token.id}>
                  <TableCell className="py-1">{token.name}</TableCell>
                  {superAdmin && <TableCell className="py-1">{token.username}</TableCell>}
                  <TableCell className="py-1 font-mono">{token.prefix}…</TableCell>
                  <TableCell className="py-1 text-muted-foreground">
                    {when(token.created_at)}
                  </TableCell>
                  <TableCell className="py-1 text-muted-foreground">
                    {token.expires_at === null ? 'Never' : when(token.expires_at)}
                  </TableCell>
                  <TableCell className="py-1 text-muted-foreground">
                    {token.last_used_at === null ? 'Never' : when(token.last_used_at)}
                  </TableCell>
                  <TableCell className="py-1 text-right">
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(token.id)}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={created !== null} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token “{created?.name}” created</DialogTitle>
            <DialogDescription>
              Copy it now: it is not shown again. On another machine run{' '}
              <code>memon login &lt;this site&gt;</code> and paste it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-1">
            <Input
              readOnly
              value={created?.value ?? ''}
              className="font-mono text-xs"
              aria-label="Token value"
              data-slot="token-value"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              size="sm"
              variant="outline"
              aria-label="Copy token"
              onClick={() =>
                navigator.clipboard
                  .writeText(created?.value ?? '')
                  .then(() => toast.success('Copied'))
                  .catch((error) => toast.error(errorMessage(error)))
              }
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
          <DialogFooter>
            <Button size="sm" onClick={() => setCreated(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function CreateForm({
  pending,
  onSubmit,
}: {
  pending: boolean
  onSubmit: (name: string, expiry: Expiry) => void
}) {
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState<Expiry>('90')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    onSubmit(name.trim(), expiry)
    setName('')
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-1">
      <Input
        className="h-7 w-48 text-xs"
        aria-label="Token name"
        placeholder="token name, e.g. laptop"
        value={name}
        maxLength={64}
        onChange={(e) => setName(e.target.value)}
        autoComplete="off"
      />
      <Select value={expiry} onValueChange={(v) => setExpiry(v as Expiry)}>
        <SelectTrigger size="sm" className="w-32" aria-label="Expiry">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="30">30 days</SelectItem>
          <SelectItem value="90">90 days</SelectItem>
          <SelectItem value="365">1 year</SelectItem>
          <SelectItem value="never">No expiry</SelectItem>
        </SelectContent>
      </Select>
      <Button type="submit" size="sm" variant="outline" disabled={pending || !name.trim()}>
        Create token
      </Button>
    </form>
  )
}
