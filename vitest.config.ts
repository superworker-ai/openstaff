import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    env: { COMPOSIO_API_KEY: '', COMPUTER_DRIVER: '', PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.resolve('data/playwright') },
    include: ['apps/server/src/**/*.test.ts', 'apps/web/src/**/*.test.ts', 'packages/shared/src/**/*.test.ts'],
    // Browser suites each boot Vite + Chromium; running files in parallel starves them.
    fileParallelism: false,
    testTimeout: 40_000,
    hookTimeout: 40_000,
  }
})
