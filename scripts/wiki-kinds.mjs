import { readFile, writeFile } from 'node:fs/promises'
import { parseWikiKindRegistry } from '../packages/core/dist/wiki/kind-registry.js'
import { renderWikiKindGuidance } from '../packages/core/dist/wiki/kind-guidance.js'

const source = new URL('../packages/core/src/wiki/kinds.json', import.meta.url)
const target = new URL('../packages/skills/memon-wiki/references/page-kinds.md', import.meta.url)
const registry = parseWikiKindRegistry(JSON.parse(await readFile(source, 'utf8')))
const expected = renderWikiKindGuidance(registry)
const mode = process.argv[2]
if (mode === '--write') {
  await writeFile(target, expected)
  console.log('Generated Wiki kind reference.')
} else if (mode === '--check') {
  if ((await readFile(target, 'utf8')) !== expected) {
    throw new Error('Wiki kind guidance has drifted. Run pnpm wiki:kinds:generate.')
  }
  console.log('Wiki kind registry and generated guidance are valid.')
} else {
  throw new Error('Usage: node scripts/wiki-kinds.mjs --write|--check')
}
