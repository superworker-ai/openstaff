import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import path from 'node:path'

const apiOrigin = process.env.PUBLIC_API_URL ?? 'http://127.0.0.1:8787'
// Browser harnesses use distinct API origins. Never share generated Nitro runtime
// configuration across simultaneous harness processes in the same workspace.
const testDirectory = process.env.NODE_ENV === 'test' ? process.env.DATA_DIR : undefined

export default defineConfig({
  plugins: [tanstackStart(), viteReact(), tailwindcss(), nitro({
    buildDir: testDirectory ? path.join(testDirectory, 'nitro') : undefined,
    devProxy: {
      '/api/**': { target: apiOrigin, changeOrigin: true, ws: true },
      '/ws': { target: apiOrigin, changeOrigin: true, ws: true },
    },
  })],
  server: {
    port: 3000,
    proxy: {
      '/api': { target: apiOrigin, changeOrigin: true, ws: true, xfwd: true },
      '/ws': { target: apiOrigin.replace('http', 'ws'), ws: true, xfwd: true },
    },
  },
})
