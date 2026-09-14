import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/migrate.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  noExternal: ['@openstaff/shared', 'ulid'],
})
