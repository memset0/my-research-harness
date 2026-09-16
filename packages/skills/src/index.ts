// @memon/skills — bundled agent skill markdown files.
//
// This package exposes the absolute path to the directory holding
// `memon-*/SKILL.md` and the list of currently shipped skill names. The CLI's
// `install-skills` command copies that tree into a project's per-agent skill
// directories.

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(import.meta.url)
// dist/index.js → resolve up to package root → siblings of dist/ are the
// `memon-*` skill directories.
export const SKILLS_DIR: string = resolve(here, '..', '..')

export const SKILL_NAMES = [
  'memon-drive',
  'memon-read-results',
  'memon-write-experiment-doc',
  'memon-write-script',
  'memon-run-experiment',
  'memon-write-report',
  'memon-wiki',
  'memon-write-code-review',
  'memon-components',
  'memon-propose',
  'memon-migrate-fs',
] as const

export type SkillName = (typeof SKILL_NAMES)[number]

// `retired-skills.json` sits beside the skill dirs and PREFLIGHT.md. It lists
// every `memon-*` name this harness used to ship and no longer does, plus the
// deposit digest of each file tree released under that name. `install-skills`
// reads it out of the resolved source tree (same as PREFLIGHT.md) and deletes
// a no-longer-shipped installed directory only when its tree matches one of
// those digests, so a locally customized copy survives.
