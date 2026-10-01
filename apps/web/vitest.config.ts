import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      // Modules under lib/server import Next's `server-only` guard, which is
      // resolved by the Next bundler only; tests load it as an empty module.
      'server-only': path.resolve(__dirname, './test/server-only-stub.ts'),
    },
  },
  // React 19's automatic JSX runtime — no `import React from 'react'` needed.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**', 'dist/**'],
    // Tailwind/PostCSS pipeline isn't needed for component tests — class-name
    // assertions don't require real styles.
    css: false,
  },
})
