/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@memon/core'],
  // Externalize Node-only packages so webpack doesn't try to bundle them
  // (fast-glob → @nodelib/fs.scandir → require('fs') would otherwise fail
  // when traced for non-Node compilation contexts after instrumentation.ts
  // brought lib/runtime into a wider bundle graph).
  serverExternalPackages: ['fast-glob', '@nodelib/fs.walk', '@nodelib/fs.scandir'],
  experimental: {
    // Required so middleware.ts can use `runtime: 'nodejs'` and call
    // node:crypto for scrypt password verification. Edge runtime can't run
    // scrypt, and proxying middleware → /api/auth/check internally per
    // request would just relocate the same Node-only work.
    nodeMiddleware: true,
  },
}

export default nextConfig
