// Parse the `## Artifacts` section body into structured entries.
//
// Format (per spec):
//   - `./checkpoints/` — 训练 checkpoint
//   - `./outputs/loss.csv` — 每步 loss
//
// Separators accepted: em dash (—), en dash (–), hyphen (-).
// Lines that don't match are skipped silently (they may be prose or sub-bullets).

import type { ArtifactEntry } from '../types.js'

const ARTIFACT_LINE_REGEX = /^-\s+`([^`]+)`\s*[—–-]\s*(.+)$/

export function parseArtifacts(sectionBody: string): ArtifactEntry[] {
  const entries: ArtifactEntry[] = []
  for (const line of sectionBody.split('\n')) {
    const match = ARTIFACT_LINE_REGEX.exec(line.trim())
    if (match) {
      entries.push({
        path: match[1]!.trim(),
        description: match[2]!.trim(),
      })
    }
  }
  return entries
}
