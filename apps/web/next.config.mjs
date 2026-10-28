import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Release builds may skip Next's own type check and lint: the commit already
// passed the repository-wide typecheck and Biome hooks.
const skipBuildChecks = process.env.MEMON_SKIP_BUILD_CHECKS === '1'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Trace from the monorepo root, never from a stray lockfile further up.
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), '../..'),
  typescript: { ignoreBuildErrors: skipBuildChecks },
  eslint: { ignoreDuringBuilds: skipBuildChecks },
  // Production browser artifacts must not expose server-only registry/config
  // source through source maps.
  productionBrowserSourceMaps: false,
  transpilePackages: ['@memon/core'],
  // A dev server reached through a public preview hostname must allow that
  // origin for HMR and dev assets; the hostnames stay in the machine's env.
  allowedDevOrigins: (process.env.MEMON_ALLOWED_DEV_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  // Externalize Node-only packages so webpack doesn't try to bundle them
  // (fast-glob → @nodelib/fs.scandir → require('fs') would otherwise fail
  // when traced for non-Node compilation contexts).
  serverExternalPackages: ['fast-glob', '@nodelib/fs.walk', '@nodelib/fs.scandir', 'sqlite3'],
}

export default nextConfig
