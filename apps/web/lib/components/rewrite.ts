/**
 * In-place payload rewriting for component blocks.
 *
 * A block is addressed either by its `#<id>` or by the 1-based line of its
 * opening fence, and the caller must hand back the payload it rendered: a
 * mismatch means the caller is looking at a stale snapshot, and the write is
 * refused rather than applied to whatever happens to be there now. Only the
 * body lines change — fence characters and length, indentation, and the
 * document's line endings survive byte for byte.
 */

import { parseComponentDeclaration } from './declaration'
import { type FencedBlock, scanFencedBlocks } from './fence'

export class BlockRewriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockRewriteError'
  }
}

export type BlockTarget = { id: string } | { line: number }

/** CR-insensitive comparison: a CRLF document renders LF payloads. */
function withoutCarriageReturns(text: string): string {
  return text.replace(/\r(?=\n|$)/g, '')
}

/** The fenced block a target addresses, or a `BlockRewriteError`. */
export function locateComponentBlock(document: string, target: BlockTarget): FencedBlock {
  const fenced = scanFencedBlocks(document)
  if ('line' in target) {
    const block = fenced.find((candidate) => candidate.line === target.line)
    if (!block) throw new BlockRewriteError(`no fenced block opens at line ${target.line}`)
    return block
  }
  const matches = fenced.filter((candidate) => {
    const parsed = parseComponentDeclaration(candidate.info)
    return parsed.kind === 'component' && parsed.declaration.id === target.id
  })
  if (matches.length === 0)
    throw new BlockRewriteError(`no component block has id \`${target.id}\``)
  if (matches.length > 1) {
    throw new BlockRewriteError(
      `block id \`${target.id}\` is used by ${matches.length} blocks (lines ${matches
        .map((block) => block.line)
        .join(', ')})`,
    )
  }
  return matches[0] as FencedBlock
}

/**
 * Replace the body of one component block. `nextPayload` is indented to the
 * fence's own indentation and re-terminated with the document's line ending.
 */
export function replaceBlockPayload(
  document: string,
  target: BlockTarget,
  expectedPayload: string,
  nextPayload: string,
): string {
  const block = locateComponentBlock(document, target)
  if (withoutCarriageReturns(block.payload) !== withoutCarriageReturns(expectedPayload)) {
    throw new BlockRewriteError('component block changed since it was rendered')
  }
  const lines = document.split('\n')
  if (block.closeIndex >= lines.length) throw new BlockRewriteError('component block is not closed')
  const newline = document.includes('\r\n') ? '\r\n' : '\n'
  const payload = withoutCarriageReturns(nextPayload)
  const body =
    payload.length === 0
      ? []
      : payload
          .split('\n')
          .map((content) => (content.length > 0 ? block.indent + content : content))
          .map((content) => (newline === '\r\n' ? `${content}\r` : content))
  return [...lines.slice(0, block.openIndex + 1), ...body, ...lines.slice(block.closeIndex)].join(
    '\n',
  )
}
