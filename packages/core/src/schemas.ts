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
 * Permissive schema: every required field is checked, but the schema does NOT
 * enforce the status enum (we apply our own normalization in normalizeStatus
 * to produce parse warnings/errors instead of throwing).
 */
export const RunFrontMatterRawSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  // Legacy v2 sub-project label. Ignored by the v3 parser; kept on the
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
  entry: z.string().min(1),
  command: z.string().min(1),
  wandb: z.union([z.string(), z.null()]).optional(),
  hypotheses: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  // v4-added: human-managed archive flag. Optional at the schema level so
  // the parser can distinguish "missing entirely" from "explicitly false"
  // for the MISSING_ARCHIVED_FIELD parse warning + sidecar fallback.
  archived: z.boolean().optional(),
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

export const ProjectConfigRawSchema = z.object({
  // Project names appear in tmux session names (per browser-terminal /
  // tmux-session-rework) and in URL paths. Restrict to letters, digits,
  // and hyphens.
  name: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9-]+$/, 'must match [A-Za-z0-9-]+'),
  root: z.string().min(1),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
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

// Per-agent tmux argv. `none` may be empty (preserves the legacy
// "no trailing command — just shell" semantics); every other agent kind
// must be a non-empty array of non-empty strings.
const NonEmptyArgvSchema = z.array(z.string().min(1)).min(1)
const NoneArgvSchema = z.array(z.string().min(1))

// `.strict()` causes unknown agent keys (e.g. `commands.aider`) to fail
// parsing with Zod's default `Unrecognized key(s)` message. The closed
// set of valid keys mirrors `AGENT_KINDS` in `./types.js`; widen this
// object whenever a new agent kind is added there.
export const TerminalCommandsRawSchema = z
  .object({
    none: NoneArgvSchema.optional(),
    claude: NonEmptyArgvSchema.optional(),
    codex: NonEmptyArgvSchema.optional(),
    opencode: NonEmptyArgvSchema.optional(),
  })
  .strict()

export const TerminalConfigRawSchema = z
  .object({
    tmux_enabled: z.boolean().optional(),
    herdr: z
      .object({
        cli: z.array(z.string().min(1)).min(1),
      })
      .strict()
      .optional(),
    ttyd_max_concurrent: z.number().int().min(1).optional(),
    ttyd_idle_ttl_minutes: z.number().int().min(0).optional(),
    pane_info_active_poll_ms: z.number().int().positive().optional(),
    pane_info_idle_poll_ms: z.number().int().positive().optional(),
    commands: TerminalCommandsRawSchema.optional(),
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

// Telegram bot block for `memon notify`. Block is wholly optional; when
// present, both `bot_token` and `chat_id` are required. `parse_mode`
// defaults to `MarkdownV2` and is restricted to the two modes the
// renderer knows how to escape for.
export const TelegramConfigRawSchema = z
  .object({
    bot_token: z.string().min(1),
    chat_id: z.union([z.string().min(1), z.number().int()]),
    parse_mode: z.enum(['MarkdownV2', 'HTML']).optional(),
    disable_notification: z.boolean().optional(),
  })
  .optional()

// ── hub / node federation (openspec/changes/add-hub-node-split) ──────────
// A process runs as a `hub` (thin broker + frontend) or a `node` (full
// backend dialing OUT to a hub), selected by which block is present.
// Mutually exclusive (enforced in config/load.ts); absent both = standalone.

const NodeNameSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9-]+$/, 'must match [a-z0-9-]+')

export const NodeCapabilitiesRawSchema = z.object({
  tmux: z.boolean().optional(),
  projects: z.boolean().optional(),
})

export const NodeConfigRawSchema = z
  .object({
    name: NodeNameSchema,
    auth_token: z.string().min(1),
    // ws:// (localhost) or wss:// (remote). Non-empty string here; the loader
    // does no URL-shape check beyond this for now.
    hub_url: z.string().min(1),
    capabilities: NodeCapabilitiesRawSchema.optional(),
  })
  .optional()

export const HubNodeEntryRawSchema = z.object({
  name: NodeNameSchema,
  auth_token: z.string().min(1),
})

export const HubConfigRawSchema = z
  .object({
    bind_addr: z.string().min(1).optional(),
    bind_port: z.number().int().min(1).max(65535).optional(),
    public_url: z.string().min(1).optional(),
    nodes: z.array(HubNodeEntryRawSchema).default([]),
  })
  .optional()

export const ConfigRawSchema = z.object({
  // `.min(1)` relaxed to allow a project-less hub; config/load.ts enforces
  // ">= 1 project unless hub mode".
  projects: z.array(ProjectConfigRawSchema).default([]),
  poll: PollConfigRawSchema,
  auth: AuthConfigRawSchema,
  terminal: TerminalConfigRawSchema,
  slurm: SlurmConfigRawSchema,
  git_status: GitStatusConfigRawSchema,
  telegram: TelegramConfigRawSchema,
  hub: HubConfigRawSchema,
  node: NodeConfigRawSchema,
})

export type ConfigRaw = z.infer<typeof ConfigRawSchema>
