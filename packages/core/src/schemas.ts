// Zod schemas for runtime validation.
//
// These validate raw front matter (snake_case as it appears in YAML) and config
// shapes. Conversion to camelCase happens after validation in the parsers.

import { z } from 'zod'

// ---------- Run README front matter (snake_case) ----------
//
// The schema name is preserved as `RunFrontMatterRawSchema` for v2
// back-compat (~100 internal references). User-facing terminology calls
// these "run READMEs" in v3.

/**
 * Permissive schema: `id` is the only hard requirement, and the schema does
 * NOT enforce the status enum (we apply our own normalization in
 * normalizeStatus to produce parse warnings/errors instead of throwing).
 *
 * v6 minimal Run record: a new Run README carries execution identity,
 * state, timestamps, association, and its own execution facts — nothing
 * inherited from the parent Experiment. Every key except `id` is therefore
 * optional at the schema level; the parser fills defaults (and `name` /
 * `created_at` are backfilled from the run directory name downstream).
 * Legacy v2/v3 keys (`project`, `hypotheses`, `tags`) still validate so old
 * rich READMEs keep parsing losslessly.
 */
export const RunFrontMatterRawSchema = z.object({
  id: z.string().min(1),
  // v6: optional — falls back to the run directory name's slug.
  name: z.string().optional(),
  // Legacy v2 sub-project label. Ignored by the v3+ parser; kept on the
  // schema so existing v2 READMEs still validate.
  project: z.string().optional(),
  status: z.unknown(), // checked by normalizeStatus
  created_at: z.string().optional(), // v3: defaults from dir-name parse when missing
  // v3-added: bumped on every web/CLI edit; defaults to created_at when missing.
  updated_at: z.string().optional(),
  // v3-added: parent experiment doc's id (`E<NNNN>-<slug>`).
  experiment: z.union([z.string(), z.null()]).optional(),
  finished_at: z.union([z.string(), z.null()]).optional(),
  host: z.union([z.string(), z.null()]).optional(),
  pid: z.union([z.number().int(), z.null()]).optional(),
  gpus: z.array(z.number().int()).optional(),
  // v6: optional — a run may be launched without a tracked entry/command.
  entry: z.string().optional(),
  command: z.string().optional(),
  wandb: z.union([z.string(), z.null()]).optional(),
  hypotheses: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  // v4-added: human-managed archive flag. Optional; absence means false
  // (the parser reports the declared-key set so the migration-window
  // sidecar fallback can still detect "field never written").
  archived: z.boolean().optional(),
  // v6-added: research-eligibility flag, orthogonal to status/archived.
  // Absence means false; new minimal records omit it unless true.
  deprecated: z.boolean().optional(),
})

export type RunFrontMatterRaw = z.infer<typeof RunFrontMatterRawSchema>

// ---------- Run Doc front matter (v3) ----------

/**
 * Snake_case schema for the `docs/experiments/E<NNNN>-<slug>.md` front
 * matter. `runs[]`, `hypotheses[]`, `tags[]` are all optional with `[]`
 * defaults applied at the parse boundary.
 */
export const ExperimentFrontMatterRawSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  // v4-added: manual lifecycle status. Optional at the schema level so the
  // parser can distinguish "missing entirely" (MISSING_EXP_STATUS warning)
  // from "explicitly set." Validated through normalizeExperimentStatus.
  status: z.unknown().optional(),
  // v4-added: human-managed archive flag. Optional for the same reason as
  // run-side `archived`.
  archived: z.boolean().optional(),
  runs: z.array(z.string()).optional(),
  hypotheses: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
})

export type ExperimentFrontMatterRaw = z.infer<typeof ExperimentFrontMatterRawSchema>

// ---------- Journal frontmatter ----------

export const JournalFrontMatterSchema = z.object({
  last_digest_at: z.union([z.string(), z.null()]).optional(),
})

export type JournalFrontMatterRaw = z.infer<typeof JournalFrontMatterSchema>

// ---------- Code-review doc frontmatter (snake_case) ----------
//
// Lenient on read: every field has a default so a hand-edited or
// partially-written doc still validates (only malformed YAML fails, in which
// case the DirCache skips the file). The authoring skill writes the full,
// canonical shape.

const CodeReviewCommitRawSchema = z.object({
  repo: z.string().min(1),
  sha: z.string().min(1),
  url: z.string().min(1),
  subject: z.string().optional(),
  reviewed: z.boolean().default(false),
})

const CodeReviewTodoRawSchema = z.object({
  item: z.string().min(1),
  done: z.boolean().default(false),
})

export const CodeReviewFrontMatterRawSchema = z.object({
  title: z.string().default(''),
  description: z.string().default(''),
  experiment: z.union([z.string(), z.null()]).default(null),
  created_at: z.string().default(''),
  updated_at: z.string().default(''),
  commits: z.array(CodeReviewCommitRawSchema).default([]),
  review_todolist: z.array(CodeReviewTodoRawSchema).default([]),
})

export type CodeReviewFrontMatterRaw = z.infer<typeof CodeReviewFrontMatterRawSchema>

// ---------- Config (camelCase keys after YAML parse normalize) ----------

// ── shared identity / execution primitives ───────────────────────────
// Declared before the Project schema because a Project may name its Host
// namespace and its own SSH execution target.

export const HostIdRawSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'must match [a-z0-9][a-z0-9-]*')

const SafeSshTargetRawSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !value.startsWith('-') && !/\s/.test(value), {
    message: 'must not start with "-" or contain whitespace',
  })

export const ProjectExecutionRawSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('local'),
      /** Interpreter used for executable component payloads. */
      python: z.string().min(1).optional(),
      component_timeout_ms: z.number().int().min(1_000).max(3_600_000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('ssh'),
      target: SafeSshTargetRawSchema,
      remote_root: z.string().min(1),
      port: z.number().int().min(1).max(65535).optional(),
      identity_file: z.string().min(1).optional(),
      known_hosts_file: z.string().min(1).optional(),
    })
    .strict(),
])

const StorageGroupRawSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'must be a safe storage-group name')

export const ProjectConfigRawSchema = z
  .object({
    // Project names appear in URL paths and Host-qualified identifiers.
    // Restrict to letters, digits, and hyphens.
    name: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9-]+$/, 'must match [A-Za-z0-9-]+'),
    root: z.string().min(1),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    // Deepest level below a Run entry directory at which the Run walk looks
    // for Run directories (1 = `logs/<run>`, 2 = `logs/<group>/<run>`).
    // Absent keeps the unbounded walk.
    run_depth: z.union([z.literal(1), z.literal(2)]).optional(),
    // Per-project GitHub owner/repo -> local path mappings, for code-preview.
    // `path` is relative to the project root ('.' = main repo, else a submodule).
    github: z
      .array(
        z.object({
          owner: z.string().min(1),
          repo: z.string().min(1),
          path: z.string().min(1),
        }),
      )
      .optional(),
    /**
     * Host namespace for host-qualified `{host, project}` identity. Validated
     * with the same rule as `central.hosts[].id` so one instance can serve a
     * namespace directly and another can register it as a peer without any
     * identity migration.
     */
    host: HostIdRawSchema.optional(),
    /**
     * Physical storage class. Absent means `local`: the Project's files are
     * read directly. `sshfs` opts into the scheduler, observation cache and
     * isolated worker, and is the only mode where `storage_group` and
     * `persistent_cache` are meaningful.
     */
    storage: z.enum(['local', 'sshfs']).optional(),
    /**
     * `storage_group` / `read_only` are the canonical snake_case spellings used
     * by every other Project key. The camelCase aliases are accepted because
     * these two fields also appear camelCased in the settings/API payloads, and
     * silently ignoring a misspelled `readOnly` would turn a read-only mount
     * into a writable one. Supplying both spellings is an error.
     */
    storage_group: StorageGroupRawSchema.optional(),
    storageGroup: StorageGroupRawSchema.optional(),
    read_only: z.boolean().optional(),
    readOnly: z.boolean().optional(),
    persistent_cache: z.boolean().optional(),
    execution: ProjectExecutionRawSchema.optional(),
  })
  .superRefine((project, ctx) => {
    for (const [snake, camel] of [
      ['storage_group', 'storageGroup'],
      ['read_only', 'readOnly'],
    ] as const) {
      if (project[snake] !== undefined && project[camel] !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [camel],
          message: `duplicates \`${snake}\`; keep exactly one spelling`,
        })
      }
    }
  })

export const PollConfigRawSchema = z
  .object({
    min_interval_ms: z.number().int().positive().optional(),
    max_interval_ms: z.number().int().positive().optional(),
    backoff_factor: z.number().positive().optional(),
  })
  .optional()

export const AuthConfigRawSchema = z
  .object({
    username: z.string().min(1).optional(),
    password: z.string().min(1),
    // HMAC signing key for memon-session and memon-shares cookies. Plaintext
    // base64url-encoded 32 random bytes (44 chars). Auto-generated on first
    // start when absent — see openspec/specs/auth-system/spec.md
    // "HMAC signing key cfg.auth.session_secret auto-generated on first run".
    session_secret: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9_-]+$/, 'must be base64url')
      .optional(),
  })
  .optional()

export const SlurmConfigRawSchema = z
  .object({
    total_nodes: z.number().int(),
  })
  .optional()

export const GitStatusConfigRawSchema = z
  .object({
    interval_ms: z.number().int(),
  })
  .optional()

// ── central / Backend deployment roles ───────────────────────────────
// One role block selects a split deployment; neither preserves standalone.
// Mutual exclusion and cross-field role constraints live in config/load.ts.

const ServiceTokenRawSchema = z
  .string()
  .min(32, 'must contain at least 32 base64url characters')
  .regex(/^[A-Za-z0-9_-]+$/, 'must be base64url')

export const BackendServiceTokensRawSchema = z
  .object({
    current: ServiceTokenRawSchema,
    next: ServiceTokenRawSchema.optional(),
  })
  .strict()

export const CentralUrlTransportRawSchema = z
  .object({
    kind: z.literal('url'),
    base_url: z.string().url(),
    allow_insecure_http: z.boolean().optional(),
  })
  .strict()

export const CentralSshTransportRawSchema = z
  .object({
    kind: z.literal('ssh'),
    executable: z.string().min(1).optional(),
    target: SafeSshTargetRawSchema,
    known_hosts_file: z.string().min(1),
    identity_file: z.string().min(1).optional(),
    local_port: z.number().int().min(1).max(65535),
    remote_host: z.string().min(1).optional(),
    remote_port: z.number().int().min(1).max(65535),
  })
  .strict()

export const CentralTransportRawSchema = z.discriminatedUnion('kind', [
  CentralUrlTransportRawSchema,
  CentralSshTransportRawSchema,
])

const RoleArgvRawSchema = z.array(z.string().min(1)).min(1)

export const CentralOperationsHintsRawSchema = z
  .object({
    ssh_target: SafeSshTargetRawSchema.optional(),
    checkout_path: z.string().min(1).optional(),
    config_path: z.string().min(1).optional(),
    runtime_bootstrap: RoleArgvRawSchema.optional(),
    supervisor_mode: z.enum(['supervised', 'foreground', 'external']).optional(),
  })
  .strict()

export const CentralHostRawSchema = z
  .object({
    id: HostIdRawSchema,
    label: z.string().min(1).max(128).optional(),
    tokens: BackendServiceTokensRawSchema,
    transport: CentralTransportRawSchema,
    operations: CentralOperationsHintsRawSchema.optional(),
  })
  .strict()

export const CentralConfigRawSchema = z
  .object({
    bind_addr: z.string().min(1).optional(),
    bind_port: z.number().int().min(1).max(65535).optional(),
    public_url: z.string().url().optional(),
    legacy_share_host: HostIdRawSchema.optional(),
    hosts: z.array(CentralHostRawSchema).default([]),
  })
  .strict()
  .optional()

const HostnameGuardPatternRawSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.*?-]+$/, 'must contain only hostname and glob characters')

const EnvironmentNameRawSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be an environment-variable name')

export const BackendStartGuardsRawSchema = z
  .object({
    allowed_hostnames: z.array(HostnameGuardPatternRawSchema).min(1).optional(),
    forbidden_env: z.array(EnvironmentNameRawSchema).min(1).optional(),
  })
  .strict()

export const BackendDaemonRawSchema = z
  .object({
    mode: z.enum(['supervised', 'foreground', 'external']).optional(),
    state_dir: z.string().min(1),
    release_dir: z.string().min(1),
    runtime_dir: z.string().min(1),
    guards: BackendStartGuardsRawSchema.optional(),
    restart_argv: RoleArgvRawSchema.optional(),
  })
  .strict()
  .superRefine((daemon, ctx) => {
    if (daemon.restart_argv && daemon.mode !== 'external') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['restart_argv'],
        message: 'is valid only when daemon.mode is external',
      })
    }
  })

export const BackendConfigRawSchema = z
  .object({
    host_id: HostIdRawSchema,
    access_mode: z.enum(['read_write', 'read_only']).optional(),
    bind_addr: z.string().min(1).optional(),
    bind_port: z.number().int().min(1).max(65535).optional(),
    tokens: BackendServiceTokensRawSchema,
    daemon: BackendDaemonRawSchema,
  })
  .strict()
  .optional()

/**
 * Project-file-store scheduler overrides. camelCase by deliberate exception:
 * these keys are written back by the owner-only settings surface and mirror
 * `FileAccessOptions` field-for-field, so one spelling avoids a mapping table
 * between the API payload and the file.
 */
const PositiveMsRawSchema = z.number().int().min(1).max(86_400_000)

export const FileAccessRawSchema = z
  .object({
    concurrency: z.number().int().min(1).max(1024).optional(),
    heartbeatMs: PositiveMsRawSchema.optional(),
    leaseMs: PositiveMsRawSchema.optional(),
    fileMinMs: PositiveMsRawSchema.optional(),
    fileMaxMs: PositiveMsRawSchema.optional(),
    directoryMinMs: PositiveMsRawSchema.optional(),
    directoryMaxMs: PositiveMsRawSchema.optional(),
    maintenanceMinMs: PositiveMsRawSchema.optional(),
    maintenanceMaxMs: PositiveMsRawSchema.optional(),
    failureMinMs: PositiveMsRawSchema.optional(),
    failureMaxMs: PositiveMsRawSchema.optional(),
    backoffFactor: z.number().min(1.01).max(100).optional(),
  })
  .strict()
  .optional()

const MAX_NODE_TIMER_SECONDS = 2_147_483.647

const FileCacheRawSchema = z
  .object({
    dump_path: z
      .string()
      .trim()
      .min(1)
      .refine((path) => !path.includes('\0'), 'Invalid dump path'),
    dump_interval_seconds: z.number().finite().positive().max(MAX_NODE_TIMER_SECONDS).default(30),
    wiki_ttl_seconds: z.number().int().positive().max(2_592_000).default(30),
    default_ttl_seconds: z.number().int().positive().max(2_592_000).default(1800),
  })
  .strict()
  .refine(
    (cache) => cache.wiki_ttl_seconds <= cache.default_ttl_seconds,
    'Wiki cache period must not exceed the default cache period',
  )

const MediaRawSchema = z
  .object({
    ffmpeg: z
      .string()
      .trim()
      .min(1)
      .refine((value) => !value.includes('\0'), 'Invalid ffmpeg path'),
  })
  .strict()

export const ConfigRawSchema = z.object({
  // Project count is role-dependent and enforced by config/load.ts.
  projects: z.array(ProjectConfigRawSchema).default([]),
  poll: PollConfigRawSchema,
  auth: AuthConfigRawSchema,
  // Accepted without validation for startup compatibility; loadConfig warns and ignores it.
  terminal: z.unknown().optional(),
  tmux: z.unknown().optional(),
  herdr: z.unknown().optional(),
  slurm: SlurmConfigRawSchema,
  git_status: GitStatusConfigRawSchema,
  central: CentralConfigRawSchema,
  backend: BackendConfigRawSchema,
  fileAccess: FileAccessRawSchema,
  file_cache: FileCacheRawSchema.optional(),
  media: MediaRawSchema.optional(),
  fileAccessRestart: RoleArgvRawSchema.optional(),
})

export type ConfigRaw = z.infer<typeof ConfigRawSchema>
