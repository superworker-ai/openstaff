import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/.context/**', '**/data/**', '**/data-test-*/**', '**/dist/**', '**/.output/**', '**/.tanstack/**', '**/routeTree.gen.ts', '**/coverage/**', 'deploy/cloudflare/worker-configuration.d.ts'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
)
