/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
