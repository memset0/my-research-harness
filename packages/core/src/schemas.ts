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

export type ExperimentFrontMatterRaw = z.infer<
  typeof ExperimentFrontMatterRawSchema
>

// ---------- Journal frontmatter ----------

export const JournalFrontMatterSchema = z.object({
  last_digest_at: z.union([z.string(), z.null()]).optional(),
})

export type JournalFrontMatterRaw = z.infer<typeof JournalFrontMatterSchema>

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

export const TerminalConfigRawSchema = z
  .object({
    ttyd_max_concurrent: z.number().int().min(1).optional(),
    ttyd_idle_ttl_minutes: z.number().int().min(0).optional(),
  })
  .optional()

export const ConfigRawSchema = z.object({
  projects: z.array(ProjectConfigRawSchema).min(1),
  poll: PollConfigRawSchema,
  auth: AuthConfigRawSchema,
  terminal: TerminalConfigRawSchema,
})

export type ConfigRaw = z.infer<typeof ConfigRawSchema>
