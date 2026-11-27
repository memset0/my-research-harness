// Wire shapes of `/api/admin/accounts*` (super admin only). Password material
// never appears.

export type AccountLevelDto = 'super_admin' | 'admin' | 'user' | 'guest'

export interface AccountGrantDto {
  host: string
  project: string
  document?: { kind: 'report' | 'wiki'; id: string }
}

export interface AccountDto {
  id: number
  username: string
  level: AccountLevelDto
  disabled: boolean
  /** Account #1 mirrors config.yml and cannot be edited here. */
  managed_by_config: boolean
  created_at: number
  updated_at: number
  grants: AccountGrantDto[]
}

export interface AccountListResponse {
  accounts: AccountDto[]
}

export interface AccountResponse {
  account: AccountDto
}

export interface CreateAccountRequest {
  username: string
  password: string
  level: Exclude<AccountLevelDto, 'super_admin'>
}

export interface UpdateAccountRequest {
  level?: Exclude<AccountLevelDto, 'super_admin'>
  disabled?: boolean
  password?: string
}

export interface ReplaceGrantsRequest {
  grants: AccountGrantDto[]
}

export interface ProjectAccessGrantDto {
  username: string
  document?: { kind: 'report' | 'wiki'; id: string }
}

export interface ProjectAccessDto {
  host: string
  project: string
  grants: ProjectAccessGrantDto[]
}

export interface ProjectAccessResponse {
  projects: ProjectAccessDto[]
}

export interface ProjectAccessChange {
  host: string
  project: string
  username: string
  document?: { kind: 'report' | 'wiki'; id: string }
}
