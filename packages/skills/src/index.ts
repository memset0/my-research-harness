// @memon/skills — bundled Claude Code skill markdown files.
//
// This package's only job is to expose the absolute path to the directory
// holding `memon-*/SKILL.md`. The CLI's `install-skills` command copies that
// tree into the user's `~/.claude/skills/`.

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const here = fileURLToPath(import.meta.url)
// dist/index.js → resolve up to package root → siblings of dist/ are the
// `memon-*` skill directories.
export const SKILLS_DIR: string = resolve(here, '..', '..')

export const SKILL_NAMES = [
  'memon-write-script',
  'memon-run-experiment',
  'memon-append-journal',
  'memon-append-warning',
  'memon-digest-journal',
  'memon-write-report',
  'memon-propose',
  'memon-migrate-fs',
] as const

export type SkillName = (typeof SKILL_NAMES)[number]
