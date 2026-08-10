// @memon/skills — bundled Claude Code skill markdown files.
//
// This package's only job is to expose the absolute path to the directory
// holding `memon-*/SKILL.md`. The CLI's `install-skills` command copies that
// tree into the user's `~/.claude/skills/`.

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(import.meta.url)
// dist/index.js → resolve up to package root → siblings of dist/ are the
// `memon-*` skill directories.
export const SKILLS_DIR: string = resolve(here, '..', '..')

export const SKILL_NAMES = [
  'memon-drive',
  'memon-write-experiment-doc',
  'memon-write-script',
  'memon-run-experiment',
  'memon-append-journal',
  'memon-digest-journal',
  'memon-write-report',
  'memon-write-code-review',
  'memon-propose',
  'memon-migrate-fs',
  'memon-notify',
] as const

export type SkillName = (typeof SKILL_NAMES)[number]
