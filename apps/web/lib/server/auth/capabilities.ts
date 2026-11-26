// Account levels → capabilities, and which paths need which capability.
// Pure and client-safe: no server-only imports.

export type AccountLevel = 'super_admin' | 'admin' | 'user' | 'guest'

export type Capability =
  | 'manage_accounts'
  | 'configure_instance'
  | 'access_clusters'
  | 'manage_project_grants'

export const CAPABILITIES_BY_LEVEL: Readonly<Record<AccountLevel, readonly Capability[]>> = {
  super_admin: [
    'manage_accounts',
    'configure_instance',
    'access_clusters',
    'manage_project_grants',
  ],
  // On the Projects the super admin granted them; they read those and nothing else.
  admin: ['access_clusters', 'manage_project_grants'],
  user: [],
  guest: [],
}

/** Only the super admin keeps today's unscoped owner reach over every Project. */
export function isOwnerLevel(level: AccountLevel): boolean {
  return level === 'super_admin'
}

export function capabilitiesOf(level: AccountLevel | null | undefined): readonly Capability[] {
  return level ? CAPABILITIES_BY_LEVEL[level] : []
}

export function levelCan(level: AccountLevel | null | undefined, capability: Capability): boolean {
  return capabilitiesOf(level).includes(capability)
}

const under = (prefix: string) => (pathname: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`)

/** First match wins. `any` means at least one of the listed capabilities. */
const PATH_RULES: ReadonlyArray<{
  match: (pathname: string) => boolean
  any: readonly Capability[]
}> = [
  { match: under('/manage/users'), any: ['manage_accounts'] },
  { match: under('/api/admin'), any: ['manage_accounts'] },
  { match: under('/manage/projects'), any: ['manage_project_grants'] },
  { match: under('/api/project-access'), any: ['manage_project_grants'] },
  { match: under('/manage/shares'), any: ['manage_project_grants'] },
  { match: under('/api/shares'), any: ['manage_project_grants'] },
  { match: under('/manage/file-access'), any: ['configure_instance'] },
  { match: under('/api/file-access'), any: ['configure_instance'] },
  { match: under('/manage/clusters'), any: ['access_clusters'] },
  { match: under('/api/clusters'), any: ['access_clusters'] },
  { match: under('/manage/gpu-pool'), any: ['access_clusters'] },
  { match: under('/api/gpu-pool'), any: ['access_clusters'] },
  {
    match: under('/manage'),
    any: ['access_clusters', 'configure_instance', 'manage_project_grants'],
  },
]

/** The capabilities of which one is required for `pathname`, or null when none is. */
export function requiredCapabilities(pathname: string): readonly Capability[] | null {
  return PATH_RULES.find((rule) => rule.match(pathname))?.any ?? null
}

export function levelMayReach(level: AccountLevel | null | undefined, pathname: string): boolean {
  const required = requiredCapabilities(pathname)
  return required === null || required.some((capability) => levelCan(level, capability))
}

export interface AdminSection {
  key: string
  label: string
  href: string
  capability: Capability
}

/** The admin navbar, in order. Further cluster sections join with `access_clusters`. */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { key: 'clusters', label: 'Clusters', href: '/manage/clusters', capability: 'access_clusters' },
  { key: 'users', label: 'Users', href: '/manage/users', capability: 'manage_accounts' },
  {
    key: 'projects',
    label: 'Projects',
    href: '/manage/projects',
    capability: 'manage_project_grants',
  },
  { key: 'shares', label: 'Shares', href: '/manage/shares', capability: 'manage_project_grants' },
  {
    key: 'file-access',
    label: 'File access',
    href: '/manage/file-access',
    capability: 'configure_instance',
  },
]

export function adminSectionsFor(level: AccountLevel | null | undefined): AdminSection[] {
  return ADMIN_SECTIONS.filter((section) => levelCan(level, section.capability))
}

export function hasAdminArea(level: AccountLevel | null | undefined): boolean {
  return levelMayReach(level, '/manage')
}
