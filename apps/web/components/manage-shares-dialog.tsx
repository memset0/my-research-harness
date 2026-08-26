'use client'

// "Manage share links" dialog — owner-only UI for issuing / revoking
// per-project shares. Backed by /api/projects/<project>/shares.
//
// We GET with `?reveal=true` so each row carries the share token, which lets
// us reconstruct the full URL on demand for the per-row Copy button (and for
// clicking the ID cell). The endpoint is owner-only at the route-class level,
// so revealing tokens here doesn't widen the threat surface.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Plus, Share2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { type ProjectTarget, projectHost, projectName, projectQueryKey } from '../lib/api'
import { useSession } from './session-provider'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

interface ShareRow {
  id: string
  label?: string
  created_at: string
  expires_at: string | null
  /** Present when the GET was made with `?reveal=true` (owner-only). */
  token?: string
}

interface CreatedShare extends ShareRow {
  token: string
  share_url: string
}

interface Props {
  project: ProjectTarget
}

function sharesUrl(project: ProjectTarget, suffix = '', reveal = false): string {
  const params = new URLSearchParams()
  const host = projectHost(project)
  if (host) params.set('host', host)
  if (reveal) params.set('reveal', 'true')
  const query = params.toString()
  return `/api/projects/${encodeURIComponent(projectName(project))}/shares${suffix}${query ? `?${query}` : ''}`
}

async function fetchShares(project: ProjectTarget): Promise<ShareRow[]> {
  const res = await fetch(sharesUrl(project, '', true), { credentials: 'include' })
  if (!res.ok) throw new Error(`failed to list shares (${res.status})`)
  const json = (await res.json()) as { shares: ShareRow[] }
  return json.shares
}

async function createShare(
  project: ProjectTarget,
  body: { label?: string; expires?: string },
): Promise<CreatedShare> {
  const res = await fetch(sharesUrl(project), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(typeof err.error === 'string' ? err.error : 'failed to create share')
  }
  const json = (await res.json()) as { share: CreatedShare }
  return json.share
}

async function deleteShare(project: ProjectTarget, id: string): Promise<void> {
  const res = await fetch(sharesUrl(project, `/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(typeof err.error === 'string' ? err.error : 'failed to delete share')
  }
}

function formatExpires(expires: string | null): string {
  if (expires === null) return 'never'
  const d = new Date(expires)
  if (Number.isNaN(d.getTime())) return expires
  return d.toLocaleDateString()
}

function formatCreated(created: string): string {
  const d = new Date(created)
  if (Number.isNaN(d.getTime())) return created
  return d.toLocaleDateString()
}

function buildShareUrl(origin: string, project: ProjectTarget, token: string): string {
  const host = projectHost(project)
  const prefix = host
    ? `/share/${encodeURIComponent(host)}/${encodeURIComponent(projectName(project))}`
    : `/share/${encodeURIComponent(projectName(project))}`
  return `${origin}${prefix}/${encodeURIComponent(token)}`
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Fallback for non-secure contexts.
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
  }
}

export function ManageSharesDialog({ project }: Props) {
  const { role } = useSession()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [expires, setExpires] = useState('never')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: shares, isLoading } = useQuery({
    queryKey: ['project-shares', ...projectQueryKey(project)],
    queryFn: () => fetchShares(project),
    enabled: open && role === 'owner',
    staleTime: 5_000,
  })

  const copyRowUrl = async (row: ShareRow) => {
    if (!row.token) {
      toast.error('No token available for this share — try refreshing the list.')
      return
    }
    const url = buildShareUrl(window.location.origin, project, row.token)
    await copyToClipboard(url)
    toast.success(`Copied share URL${row.label ? ` (${row.label})` : ''}`)
  }

  const createMutation = useMutation({
    mutationFn: () => createShare(project, { label: label || undefined, expires }),
    onSuccess: async (created) => {
      setLabel('')
      setExpires('never')
      await copyToClipboard(created.share_url)
      toast.success('Share created — URL copied to clipboard')
      queryClient.invalidateQueries({ queryKey: ['project-shares', ...projectQueryKey(project)] })
    },
    onError: (err) => toast.error(`Could not create share: ${(err as Error).message}`),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteShare(project, id),
    onSuccess: () => {
      toast.success('Share revoked')
      queryClient.invalidateQueries({ queryKey: ['project-shares', ...projectQueryKey(project)] })
      setConfirmId(null)
    },
    onError: (err) => toast.error(`Could not revoke: ${(err as Error).message}`),
  })

  if (role !== 'owner') return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="bg-white hover:bg-white/90">
          <Share2 className="size-3.5" />
          Share
        </Button>
      </DialogTrigger>
      {/* The DialogContent primitive defaults to `sm:max-w-sm` (24rem) at
          the sm+ breakpoint. `max-w-2xl` alone loses CSS-order tie-breaking
          to that. Force the wider cap at sm+ explicitly. */}
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Share links for {projectHost(project) ? `${projectHost(project)}/` : ''}
            {projectName(project)}
          </DialogTitle>
          <DialogDescription>
            Each link grants read-only access to this project only. Revoke any link to terminate
            that viewer&apos;s access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !shares || shares.length === 0 ? (
            <p className="rounded border border-dashed p-4 text-center text-sm text-muted-foreground">
              No share links yet. Create one below.
            </p>
          ) : (
            <div className="overflow-x-auto rounded border text-sm">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-1.5">ID</th>
                    <th className="px-3 py-1.5">Label</th>
                    <th className="px-3 py-1.5">Created</th>
                    <th className="px-3 py-1.5">Expires</th>
                    <th className="px-3 py-1.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shares.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => copyRowUrl(s)}
                          aria-label={`Copy share URL for ${s.id}`}
                          title="Click to copy share URL"
                          className="cursor-pointer font-mono text-xs text-left hover:text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        >
                          {s.id}
                        </button>
                      </td>
                      <td className="px-3 py-2">{s.label ?? '-'}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {formatCreated(s.created_at)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {formatExpires(s.expires_at)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Copy share URL for ${s.id}`}
                          onClick={() => copyRowUrl(s)}
                        >
                          <Copy className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Revoke ${s.id}`}
                          onClick={() => setConfirmId(s.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="space-y-3 rounded border bg-muted/30 p-4">
            <h3 className="text-sm font-medium">Issue a new share</h3>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div className="space-y-1">
                <Label htmlFor="new-share-label" className="text-xs">
                  Label (optional)
                </Label>
                <Input
                  id="new-share-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Reviewer Alice"
                  maxLength={64}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-share-expires" className="text-xs">
                  Expires
                </Label>
                <Select value={expires} onValueChange={setExpires}>
                  <SelectTrigger id="new-share-expires" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">Never</SelectItem>
                    <SelectItem value="7d">7 days</SelectItem>
                    <SelectItem value="30d">30 days</SelectItem>
                    <SelectItem value="90d">90 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              size="sm"
            >
              <Plus className="size-3.5" />
              {createMutation.isPending ? 'Creating…' : 'Create share'}
            </Button>
          </div>
        </div>

        {confirmId ? (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <p className="mb-2">
              Revoke share <code className="font-mono text-xs">{confirmId}</code>? Anyone currently
              holding this link will lose access immediately.
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deleteMutation.mutate(confirmId)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Revoking…' : 'Confirm revoke'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmId(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
