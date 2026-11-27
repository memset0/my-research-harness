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
  // Owner reach on every Project (GPU nodes give no isolation between Projects).
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
  { match: under('/manage/access'), any: ['manage_accounts', 'manage_project_grants'] },
  { match: under('/api/admin'), any: ['manage_accounts'] },
  { match: under('/manage/projects'), any: ['manage_project_grants'] },
  { match: under('/api/project-access'), any: ['manage_project_grants'] },
  { match: under('/manage/shares'), any: ['manage_project_grants'] },
  { match: under('/api/shares'), any: ['manage_project_grants'] },
  { match: under('/manage/file-access'), any: ['configure_instance'] },
  { match: under('/api/file-access'), any: ['configure_instance'] },
  { match: under('/manage/traffic'), any: ['configure_instance'] },
  { match: under('/api/traffic'), any: ['configure_instance'] },
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
  /** At least one of these opens the section. */
  any: readonly Capability[]
}

/**
 * The admin navbar, in order. Access control holds the Users, Projects and
 * Shares cards, each gated again by its own capability; the old section URLs
 * redirect to their anchors. Further cluster sections join with `access_clusters`.
 */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { key: 'clusters', label: 'Clusters', href: '/manage/clusters', any: ['access_clusters'] },
  {
    key: 'access',
    label: 'Access control',
    href: '/manage/access',
    any: ['manage_accounts', 'manage_project_grants'],
  },
  {
    key: 'traffic',
    label: 'Traffic control',
    href: '/manage/traffic',
    any: ['configure_instance'],
  },
]

export function adminSectionsFor(level: AccountLevel | null | undefined): AdminSection[] {
  return ADMIN_SECTIONS.filter((section) => section.any.some((c) => levelCan(level, c)))
}

export function hasAdminArea(level: AccountLevel | null | undefined): boolean {
  return levelMayReach(level, '/manage')
}
