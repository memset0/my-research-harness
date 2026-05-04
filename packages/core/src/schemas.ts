// Zod schemas for runtime validation.
//
// These validate raw front matter (snake_case as it appears in YAML) and config
// shapes. Conversion to camelCase happens after validation in the parsers.

import { z } from 'zod'

// ---------- Experiment front matter (snake_case) ----------

/**
 * Permissive schema: every required field is checked, but the schema does NOT
 * enforce the status enum (we apply our own normalization in normalizeStatus
 * to produce parse warnings/errors instead of throwing).
 */
export const ExperimentFrontMatterRawSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  project: z.string().min(1),
  status: z.unknown(), // checked by normalizeStatus
  created_at: z.string().min(1),
  finished_at: z.union([z.string(), z.null()]).optional(),
  host: z.union([z.string(), z.null()]).optional(),
  pid: z.union([z.number().int(), z.null()]).optional(),
  gpus: z.array(z.number().int()).optional(),
  entry: z.string().min(1),
  command: z.string().min(1),
  wandb: z.union([z.string(), z.null()]).optional(),
  hypotheses: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
})

export type ExperimentFrontMatterRaw = z.infer<typeof ExperimentFrontMatterRawSchema>

// ---------- Journal frontmatter ----------

export const JournalFrontMatterSchema = z.object({
  last_digest_at: z.union([z.string(), z.null()]).optional(),
})

export type JournalFrontMatterRaw = z.infer<typeof JournalFrontMatterSchema>

// ---------- Config (camelCase keys after YAML parse normalize) ----------

export const ProjectConfigRawSchema = z.object({
  name: z.string().min(1),
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
  })
  .optional()

export const ConfigRawSchema = z.object({
  projects: z.array(ProjectConfigRawSchema).min(1),
  poll: PollConfigRawSchema,
  auth: AuthConfigRawSchema,
})

export type ConfigRaw = z.infer<typeof ConfigRawSchema>
