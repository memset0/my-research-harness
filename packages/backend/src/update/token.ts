import { randomBytes } from 'node:crypto'
export function generateBackendServiceToken(
  random: (size: number) => Buffer = randomBytes,
): string {
  return random(32).toString('base64url')
}
