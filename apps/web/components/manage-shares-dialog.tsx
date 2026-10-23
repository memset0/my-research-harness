'use client'

// "Share" dialog — owner-only UI for issuing / revoking share links, backed by
// the central share registry at /api/shares.
//
// On an Experiment, Report or Wiki page a new link may open only that page
// (the default) or the whole Project; elsewhere links are Project-scoped. A
// link is the page's own URL with `?share=<token>`; a listed whole-Project link
// is copied for the page currently open. Report and Wiki pages can
// also be made public (readable by anyone with the plain page URL). A service
// Report or Wiki page additionally offers a service link, the only kind of
// link whose token also reaches the page's live application. The list
// shows every link of this Project with what it can reach, and copies or
// revokes it.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Plus, Share2, Trash2 } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  fetchExperimentsInventory,
  fetchReport,
  fetchWikiPage,
  type ProjectTarget,
  projectHost,
  projectName,
} from '../lib/api'
import type {
  ScopedShareCreatedResponse,
  ScopedShareRow,
  ScopedSharesResponse,
  ShareScopeDto,
} from '../lib/dto/shares'
import { artifactIdPrefix, parseProjectPath } from '../lib/project-routes'
import { queryKeys } from '../lib/query-keys'
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
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

interface Props {
  project: ProjectTarget
}

type DocumentScope = Exclude<ShareScopeDto, { kind: 'project' }>

const KIND_LABEL = { wiki: 'Wiki', report: 'Report', experiment: 'Experiment' } as const

/** The document a page shows; an Experiment page names only its number. */
export type PageDocument = DocumentScope | { kind: 'experiment'; number: number }

/** The document the current page shows, when it is an Experiment, Report or Wiki page. */
export function pageDocument(pathname: string): PageDocument | null {
  const page = parseProjectPath(pathname)?.page
  if (page?.kind === 'wiki') return { kind: 'wiki', id: artifactIdPrefix('W', page.number) }
  if (page?.kind === 'report') return { kind: 'report', id: artifactIdPrefix('R', page.number) }
  if (page?.kind === 'experiment') return { kind: 'experiment', number: page.number }
  return null
}

/** The page's document with a full id, resolving an Experiment number against the inventory. */
export function resolvedPageDocument(
  page: PageDocument | null,
  experimentIds: readonly string[] | undefined,
): DocumentScope | null {
  if (!page || 'id' in page) return page
  const prefix = `${artifactIdPrefix('E', page.number)}-`
  const matches = (experimentIds ?? []).filter((id) => id.startsWith(prefix))
  return matches.length === 1 ? { kind: 'experiment', id: matches[0]! } : null
}

export function scopeLabel(scope: ShareScopeDto): string {
  return scope.kind === 'project' ? 'Whole project' : `${KIND_LABEL[scope.kind]} ${scope.id}`
}

function rowLabel(row: ScopedShareRow): string {
  if (row.public) return `Public · ${scopeLabel(row.scope)}`
  return row.service ? `Service · ${scopeLabel(row.scope)}` : scopeLabel(row.scope)
}

/**
 * The URL to copy for a listed link: a whole-Project token link points at the
 * page currently open (query kept, old `share` dropped, no fragment) on the
 * link's own origin; other links copy their record URL.
 */
export function copyUrlFor(row: ScopedShareRow, current: string): string {
  if (row.public || row.scope.kind !== 'project') return row.share_url
  const url = new URL(current)
  const target = new URL(`${url.pathname}${url.search}`, new URL(row.share_url).origin)
  target.searchParams.delete('share')
  target.searchParams.append('share', row.token)
  return target.toString()
}

function sameScope(a: ShareScopeDto, b: ShareScopeDto): boolean {
  return a.kind === b.kind && (a.kind === 'project' || a.id === (b as { id: string }).id)
}

function errorMessage(body: unknown, fallback: string): string {
  const error = (body as { error?: string | { message?: string } } | null)?.error
  if (typeof error === 'string') return error
  if (typeof error?.message === 'string') return error.message
  return fallback
}

async function fetchShares(project: ProjectTarget): Promise<ScopedShareRow[]> {
  const params = new URLSearchParams({ project: projectName(project) })
  const host = projectHost(project)
  if (host) params.set('host', host)
  const res = await fetch(`/api/shares?${params}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`failed to list shares (${res.status})`)
  return ((await res.json()) as ScopedSharesResponse).shares
}

async function createShare(
  project: ProjectTarget,
  body: {
    scope: ShareScopeDto
    label?: string
    expires: string
    currentPath: string
    public?: boolean
    service?: boolean
  },
): Promise<ScopedShareRow> {
  const res = await fetch('/api/shares', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      project: projectName(project),
      ...(projectHost(project) ? { host: projectHost(project) } : {}),
    }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(errorMessage(json, `failed to create share (HTTP ${res.status})`))
  return (json as ScopedShareCreatedResponse).share
}

async function deleteShare(id: string): Promise<void> {
  const res = await fetch(`/api/shares/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    const json = await res.json().catch(() => null)
    throw new Error(errorMessage(json, `failed to revoke share (HTTP ${res.status})`))
  }
}

function formatDate(value: string | null, empty: string): string {
  if (value === null) return empty
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString()
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
  const pathname = usePathname() ?? ''
  const pageRef = pageDocument(pathname)
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [expires, setExpires] = useState('never')
  const [reach, setReach] = useState<'page' | 'project' | 'service'>('page')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: shares, isLoading } = useQuery({
    queryKey: queryKeys.projectShares(project),
    queryFn: () => fetchShares(project),
    enabled: open && role === 'owner',
    staleTime: 5_000,
  })

  // `/e/<n>` names an Experiment by number; a share scope needs its full id.
  const { data: experiments } = useQuery({
    queryKey: queryKeys.experimentsInventory(project),
    queryFn: () => fetchExperimentsInventory(project),
    enabled: open && role === 'owner' && pageRef !== null && !('id' in pageRef),
  })
  const pageDoc = resolvedPageDocument(
    pageRef,
    experiments?.items.map((item) => item.id),
  )

  // Only Report and Wiki pages can be public or carry a service.
  const publishable = pageDoc && pageDoc.kind !== 'experiment' ? pageDoc : null
  const { data: pageDetail } = useQuery({
    queryKey:
      publishable?.kind === 'wiki'
        ? queryKeys.wikiPage(project, publishable.id)
        : queryKeys.report(project, publishable?.id ?? null),
    queryFn: () =>
      publishable?.kind === 'wiki'
        ? fetchWikiPage(project, publishable.id)
        : fetchReport(project, publishable!.id),
    enabled: open && role === 'owner' && publishable !== null,
  })
  const serviceDoc =
    publishable && (pageDetail as { presentation?: string } | undefined)?.presentation === 'service'
      ? publishable
      : null
  const service = serviceDoc !== null && reach === 'service'
  const scope: ShareScopeDto = pageDoc && reach !== 'project' ? pageDoc : { kind: 'project' }
  const scopeName = service ? `Service · ${scopeLabel(scope)}` : scopeLabel(scope)
  const publicRecord = publishable
    ? (shares ?? []).find((row) => row.public && sameScope(row.scope, publishable))
    : undefined

  const copyRowUrl = async (row: ScopedShareRow) => {
    await copyToClipboard(copyUrlFor(row, window.location.href))
    toast.success(
      `Copied ${row.public ? 'page' : 'share'} URL${row.label ? ` (${row.label})` : ''}`,
    )
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createShare(project, {
        scope,
        ...(label ? { label } : {}),
        expires,
        currentPath: `${window.location.pathname}${window.location.search}`,
        ...(service ? { service: true } : {}),
      }),
    onSuccess: async (created) => {
      setLabel('')
      setExpires('never')
      await copyToClipboard(created.share_url)
      toast.success(`Share created for ${rowLabel(created)} — URL copied to clipboard`)
      queryClient.invalidateQueries({ queryKey: queryKeys.projectShares(project) })
    },
    onError: (err) => toast.error(`Could not create share: ${(err as Error).message}`),
  })

  const publishMutation = useMutation({
    mutationFn: () =>
      createShare(project, {
        scope: publishable as ShareScopeDto,
        expires: 'never',
        currentPath: window.location.pathname,
        public: true,
      }),
    onSuccess: async (created) => {
      await copyToClipboard(created.share_url)
      toast.success(`${scopeLabel(created.scope)} is public — page URL copied to clipboard`)
      queryClient.invalidateQueries({ queryKey: queryKeys.projectShares(project) })
    },
    onError: (err) => toast.error(`Could not make the page public: ${(err as Error).message}`),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteShare(id),
    onSuccess: () => {
      toast.success('Share revoked')
      queryClient.invalidateQueries({ queryKey: queryKeys.projectShares(project) })
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
            Links grant read-only access to one page or to the whole project, and open the page they
            were issued from. Only a service link reaches a live application. Revoke a link to end
            that access.
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
              <table className="w-full" data-share-list="">
                <thead className="bg-muted/50">
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-1.5">Access</th>
                    <th className="px-3 py-1.5">Label</th>
                    <th className="px-3 py-1.5">Created</th>
                    <th className="px-3 py-1.5">Expires</th>
                    <th className="px-3 py-1.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shares.map((s) => (
                    <tr key={s.id} className="border-t" data-share-id={s.id}>
                      <td className="px-3 py-2 whitespace-nowrap" data-share-scope="">
                        {rowLabel(s)}
                      </td>
                      <td className="px-3 py-2">{s.label ?? '-'}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {formatDate(s.created_at, '-')}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {formatDate(s.expires_at, 'never')}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Copy URL for ${rowLabel(s)}`}
                          title={s.path}
                          onClick={() => copyRowUrl(s)}
                        >
                          <Copy className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={
                            s.public ? `Make ${scopeLabel(s.scope)} private` : `Revoke ${s.id}`
                          }
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

          {publishable ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded border bg-muted/30 p-4">
              <div className="space-y-0.5">
                <h3 className="text-sm font-medium">Public page</h3>
                <p className="text-xs text-muted-foreground" data-public-state="">
                  {publicRecord
                    ? `${scopeLabel(publishable)} is public: anyone with the page URL can read it.`
                    : `Make ${scopeLabel(publishable)} readable by anyone with its page URL.`}
                </p>
              </div>
              {publicRecord ? (
                <Button variant="outline" size="sm" onClick={() => setConfirmId(publicRecord.id)}>
                  Make private
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => publishMutation.mutate()}
                  disabled={publishMutation.isPending}
                >
                  {publishMutation.isPending ? 'Publishing…' : 'Make public'}
                </Button>
              )}
            </div>
          ) : null}

          <div className="space-y-3 rounded border bg-muted/30 p-4">
            <h3 className="text-sm font-medium">Issue a new share</h3>
            {pageDoc ? (
              <div className="space-y-1">
                <Label className="text-xs">Recipients can open</Label>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={reach === 'service' && !serviceDoc ? 'page' : reach}
                  onValueChange={(value) => {
                    if (value === 'page' || value === 'project' || value === 'service')
                      setReach(value)
                  }}
                  aria-label="Share scope"
                >
                  <ToggleGroupItem value="page">
                    This page only ({KIND_LABEL[pageDoc.kind]} {pageDoc.id})
                  </ToggleGroupItem>
                  <ToggleGroupItem value="project">Whole project</ToggleGroupItem>
                  {serviceDoc ? <ToggleGroupItem value="service">Service</ToggleGroupItem> : null}
                </ToggleGroup>
                {service ? (
                  <p className="text-xs text-muted-foreground" data-service-warning="">
                    This page plus its live application. Recipients can use the application fully,
                    including any writes it makes.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                The link opens this page and grants the whole project.
              </p>
            )}
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
              {createMutation.isPending ? 'Creating…' : `Create link for ${scopeName}`}
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
