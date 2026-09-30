import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
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
