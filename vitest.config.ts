import { defineConfig } from 'vitest/config'
import path from 'node:path'

const root = import.meta.dirname

export default defineConfig({
  root,
  test: {
    env: { COMPOSIO_API_KEY: '', COMPUTER_DRIVER: '', TYPESAFE_API_KEY: '', PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(root, 'data/playwright') },
    include: ['apps/server/src/**/*.test.ts', 'apps/web/src/**/*.test.ts', 'packages/shared/src/**/*.test.ts'],
    // Browser suites each boot Vite + Chromium; running files in parallel starves them.
    fileParallelism: false,
    testTimeout: 40_000,
    hookTimeout: 40_000,
  }
})
