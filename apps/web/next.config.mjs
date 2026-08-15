/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@memon/core'],
  // Externalize Node-only packages so webpack doesn't try to bundle them
  // (fast-glob → @nodelib/fs.scandir → require('fs') would otherwise fail
  // when traced for non-Node compilation contexts).
  serverExternalPackages: ['fast-glob', '@nodelib/fs.walk', '@nodelib/fs.scandir', 'sqlite3'],
}

export default nextConfig
