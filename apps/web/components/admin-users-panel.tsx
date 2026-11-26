'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import type { AccountDto, AccountGrantDto, AccountLevelDto } from '@/lib/dto/accounts'
import type { ProjectSummary } from '@/lib/dto/projects'
import {
  createAdminAccount,
  fetchAdminAccounts,
  fetchProjects,
  replaceAdminGrants,
  updateAdminAccount,
} from '../lib/api'
import { queryKeys } from '../lib/query-keys'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

type Assignable = Exclude<AccountLevelDto, 'super_admin'>
const LEVEL_LABEL: Record<AccountLevelDto, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  user: 'User',
  guest: 'Guest',
}
const ASSIGNABLE: Assignable[] = ['admin', 'user', 'guest']

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function grantLabel(grant: AccountGrantDto): string {
  const base = `${grant.host}/${grant.project}`
  return grant.document ? `${base} · ${grant.document.id}` : base
}

function LevelSelect({
  value,
  onChange,
  disabled,
}: {
  value: Assignable
  onChange: (level: Assignable) => void
  disabled?: boolean
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Assignable)} disabled={disabled}>
      <SelectTrigger size="sm" className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ASSIGNABLE.map((level) => (
          <SelectItem key={level} value={level}>
            {LEVEL_LABEL[level]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function AdminUsersPanel() {
  const client = useQueryClient()
  const accounts = useQuery({ queryKey: queryKeys.adminAccounts(), queryFn: fetchAdminAccounts })
  const [creating, setCreating] = useState(false)
  const [resetting, setResetting] = useState<AccountDto | null>(null)
  const [granting, setGranting] = useState<AccountDto | null>(null)

  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.adminAccounts() })
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Parameters<typeof updateAdminAccount>[1] }) =>
      updateAdminAccount(id, patch),
    onSuccess: () => refresh(),
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3" data-slot="admin-users">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-medium">Users</h1>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus data-icon="inline-start" />
          New account
        </Button>
      </div>
      {accounts.isError && (
        <p className="text-xs text-destructive">{errorMessage(accounts.error)}</p>
      )}
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="h-8">Username</TableHead>
            <TableHead className="h-8">Level</TableHead>
            <TableHead className="h-8">Status</TableHead>
            <TableHead className="h-8">Access</TableHead>
            <TableHead className="h-8 w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(accounts.data?.accounts ?? []).map((account) => (
            <TableRow key={account.id} data-account={account.username}>
              <TableCell className="py-1 font-medium">{account.username}</TableCell>
              <TableCell className="py-1">
                {account.managed_by_config ? (
                  <Badge variant="secondary">{LEVEL_LABEL[account.level]}</Badge>
                ) : (
                  <LevelSelect
                    value={account.level as Assignable}
                    disabled={update.isPending}
                    onChange={(level) => update.mutate({ id: account.id, patch: { level } })}
                  />
                )}
              </TableCell>
              <TableCell className="py-1">
                <Badge variant={account.disabled ? 'outline' : 'secondary'}>
                  {account.disabled ? 'Disabled' : 'Active'}
                </Badge>
              </TableCell>
              <TableCell className="py-1 text-muted-foreground">
                {account.level === 'user'
                  ? account.grants.length === 0
                    ? 'No grants'
                    : account.grants.map(grantLabel).join(', ')
                  : account.level === 'guest'
                    ? 'Share links only'
                    : account.level === 'admin'
                      ? account.admin_projects.length === 0
                        ? 'No projects (grant under Projects)'
                        : `Manages ${account.admin_projects.map((p) => `${p.host}/${p.project}`).join(', ')}`
                      : 'All projects'}
              </TableCell>
              <TableCell className="py-1">
                {!account.managed_by_config && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for ${account.username}`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {account.level === 'user' && (
                        <DropdownMenuItem onSelect={() => setGranting(account)}>
                          Edit access
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => setResetting(account)}>
                        Reset password
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          update.mutate({ id: account.id, patch: { disabled: !account.disabled } })
                        }
                      >
                        {account.disabled ? 'Enable' : 'Disable'}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <CreateAccountDialog open={creating} onOpenChange={setCreating} onCreated={refresh} />
      <ResetPasswordDialog account={resetting} onClose={() => setResetting(null)} />
      <GrantsDialog account={granting} onClose={() => setGranting(null)} onSaved={refresh} />
    </div>
  )
}

function CreateAccountDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [level, setLevel] = useState<Assignable>('user')
  const create = useMutation({
    mutationFn: () => createAdminAccount({ username, password, level }),
    onSuccess: () => {
      toast.success(`Created ${username}`)
      setUsername('')
      setPassword('')
      onCreated()
      onOpenChange(false)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    create.mutate()
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="grid gap-3">
          <DialogHeader>
            <DialogTitle>New account</DialogTitle>
            <DialogDescription>Users start with no access; grant it afterwards.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="new-username">Username</Label>
            <Input
              id="new-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-password">Initial password</Label>
            <Input
              id="new-password"
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Level</Label>
            <LevelSelect value={level} onChange={setLevel} />
          </div>
          <DialogFooter>
            <Button type="submit" size="sm" disabled={create.isPending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResetPasswordDialog({
  account,
  onClose,
}: {
  account: AccountDto | null
  onClose: () => void
}) {
  const [password, setPassword] = useState('')
  const reset = useMutation({
    mutationFn: () => updateAdminAccount((account as AccountDto).id, { password }),
    onSuccess: () => {
      toast.success('Password reset')
      setPassword('')
      onClose()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <Dialog open={account !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            reset.mutate()
          }}
          className="grid gap-3"
        >
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>{account?.username}</DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            aria-label="New password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <DialogFooter>
            <Button type="submit" size="sm" disabled={reset.isPending}>
              Reset
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function projectRefs(
  projects: ProjectSummary[] | undefined,
): Array<{ host: string; project: string }> {
  return (projects ?? []).flatMap((project) =>
    project.mode === 'central' ? [{ host: project.host, project: project.project }] : [],
  )
}

function GrantsDialog({
  account,
  onClose,
  onSaved,
}: {
  account: AccountDto | null
  onClose: () => void
  onSaved: () => void
}) {
  const projects = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: fetchProjects,
    enabled: account !== null,
  })
  const [grants, setGrants] = useState<AccountGrantDto[] | null>(null)
  const [target, setTarget] = useState('')
  const [scope, setScope] = useState<'project' | 'report' | 'wiki'>('project')
  const [docId, setDocId] = useState('')
  const current = grants ?? account?.grants ?? []
  const save = useMutation({
    mutationFn: () => replaceAdminGrants((account as AccountDto).id, { grants: current }),
    onSuccess: () => {
      toast.success('Access saved')
      onSaved()
      close()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  function close() {
    setGrants(null)
    setTarget('')
    setDocId('')
    setScope('project')
    onClose()
  }
  const add = () => {
    const ref = projectRefs(projects.data?.projects).find(
      (p) => `${p.host}/${p.project}` === target,
    )
    if (!ref) return
    const grant: AccountGrantDto =
      scope === 'project'
        ? ref
        : { ...ref, document: { kind: scope, id: docId.trim().toUpperCase() } }
    if (!current.some((existing) => grantLabel(existing) === grantLabel(grant)))
      setGrants([...current, grant])
    setDocId('')
  }
  return (
    <Dialog open={account !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Access for {account?.username}</DialogTitle>
          <DialogDescription>
            Read-only access to whole projects or single Reports/Wikis.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1 text-xs" data-slot="grant-list">
          {current.length === 0 && <li className="text-muted-foreground">No grants.</li>}
          {current.map((grant, index) => (
            <li key={grantLabel(grant)} className="flex items-center justify-between gap-2">
              <span className="truncate font-mono">{grantLabel(grant)}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${grantLabel(grant)}`}
                onClick={() => setGrants(current.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-1.5">
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger size="sm" className="min-w-40 flex-1">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              {projectRefs(projects.data?.projects).map((p) => (
                <SelectItem key={`${p.host}/${p.project}`} value={`${p.host}/${p.project}`}>
                  {p.host}/{p.project}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
            <SelectTrigger size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="project">Whole project</SelectItem>
              <SelectItem value="report">One Report</SelectItem>
              <SelectItem value="wiki">One Wiki</SelectItem>
            </SelectContent>
          </Select>
          {scope !== 'project' && (
            <Input
              className="h-7 w-24"
              aria-label="Document id"
              placeholder={scope === 'report' ? 'R0001' : 'W0001'}
              value={docId}
              onChange={(e) => setDocId(e.target.value)}
            />
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={add}
            disabled={!target || (scope !== 'project' && !docId)}
          >
            Add
          </Button>
        </div>
        <DialogFooter>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
